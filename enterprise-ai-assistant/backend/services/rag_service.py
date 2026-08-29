"""Retrieval-Augmented Generation pipeline.

Hybrid retrieval:
  1. Vector search (sqlite-vec) on document chunks and knowledge items.
  2. Full-text search (FTS5 / BM25) on the same content.
  3. Permission / scope filtering.
  4. Reciprocal Rank Fusion (RRF) merge.
  5. Cross-encoder / lexical rerank.
  6. Context assembly + streaming answer.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional

from core import database as db
from core.config import settings
from services.embedding_service import get_embedding_service
from services.reranker_service import get_reranker_service
from services import llm_service
from utils.persian import detect_language, normalize_persian, tokenize


@dataclass
class RetrievedChunk:
    source_type: str  # 'document' | 'knowledge'
    source_id: str
    chunk_id: Optional[str]
    title: str
    content: str
    page_number: Optional[int]
    section: Optional[str]
    heading: Optional[str]
    visibility: str
    owner_id: Optional[str]
    department_id: Optional[str]
    organization_id: Optional[str]
    score: float = 0.0
    rank_positions: List[int] = field(default_factory=list)

    def is_visible_to(self, user: Dict[str, Any]) -> bool:
        if user.get("is_superadmin"):
            return True
        vis = self.visibility
        if vis == "public":
            return True
        if vis == "private":
            return self.owner_id == user["id"]
        if vis in ("department", "org", "organization"):
            if self.organization_id and self.organization_id != user.get("organization_id"):
                return False
            if vis == "department":
                return self.department_id == user.get("department_id")
            return True
        return True


def _vec_search(
    query_vec: List[float], table: str, id_col: str, k: int, filters: str, params: List[Any]
) -> List[Dict[str, Any]]:
    conn = db.get_conn()
    blob = get_embedding_service().to_blob(query_vec)
    # Parameter binding for vec0 MATCH uses a blob and a k value.
    sql = f"""
        SELECT {id_col} AS hit_id, distance
        FROM {table}
        WHERE embedding MATCH ? AND k = ?
        {filters}
    """
    try:
        rows = conn.execute(sql, [blob, k, *params]).fetchall()
        return [{"id": r["hit_id"], "distance": float(r["distance"])} for r in rows]
    except Exception:
        return []


def _fts_chunks(query: str, k: int, filters: str, params: List[Any]) -> List[Dict[str, Any]]:
    conn = db.get_conn()
    match_q = " OR ".join(tokenize(query))[:1000] or query
    # Visibility/ownership/department live on the documents table; chunks carry
    # organization_id for partitioning but inherit the rest from the document.
    sql = f"""
        SELECT c.id, c.document_id, c.content, c.content_normalized, c.heading,
               c.section, c.page_number, c.organization_id,
               d.title AS doc_title, d.visibility, d.owner_id,
               d.department_id,
               bm25(chunks_fts) AS rank_score
        FROM chunks_fts
        JOIN document_chunks c ON c.rowid = chunks_fts.rowid
        JOIN documents d ON d.id = c.document_id
        WHERE chunks_fts MATCH ? AND d.status='READY' {filters}
        ORDER BY rank_score LIMIT ?
    """
    try:
        return [dict(r) for r in conn.execute(sql, [match_q, *params, k]).fetchall()]
    except Exception as exc:
        print(f"[rag] fts_chunks error: {exc}")
        return []


def _fts_knowledge(query: str, k: int, filters: str, params: List[Any]) -> List[Dict[str, Any]]:
    conn = db.get_conn()
    match_q = " OR ".join(tokenize(query))[:1000] or query
    sql = f"""
        SELECT ki.id, ki.title, ki.lesson_learned AS content, ki.visibility,
               ki.owner_id, ki.department_id, ki.organization_id,
               bm25(knowledge_fts) AS rank_score
        FROM knowledge_fts
        JOIN knowledge_items ki ON ki.rowid = knowledge_fts.rowid
        WHERE knowledge_fts MATCH ? AND ki.status='PUBLISHED' {filters}
        ORDER BY rank_score LIMIT ?
    """
    try:
        return [dict(r) for r in conn.execute(sql, [match_q, *params, k]).fetchall()]
    except Exception:
        return []


def _scope_clause(
    scope: str, scope_id: Optional[str], user: Dict[str, Any]
) -> tuple[str, List[Any]]:
    """Build a SQL filter fragment reflecting the chat scope and user access."""
    clauses: List[str] = []
    params: List[Any] = []
    org = user.get("organization_id")
    dept = user.get("department_id")
    uid = user["id"]

    if scope == "document" and scope_id:
        clauses.append("(c.document_id = ?)")
        params.append(scope_id)
    elif scope == "folder" and scope_id:
        clauses.append("(c.document_id IN (SELECT id FROM documents WHERE folder_id=?))")
        params.append(scope_id)
    # document/department/private scopes reference the documents table.
    if scope == "department":
        target = scope_id or dept
        if target:
            clauses.append("(d.department_id = ?)")
            params.append(target)
    elif scope == "private":
        clauses.append("(d.owner_id = ?)")
        params.append(uid)
    # "all" => add implicit visibility filter below.

    # Visibility / access filter (non-superadmin).
    if not user.get("is_superadmin"):
        clauses.append(
            "(d.visibility='public' OR d.owner_id=? "
            "OR (d.visibility IN ('department','org','organization') AND d.organization_id=?) "
            "OR (d.visibility='department' AND d.department_id=?))"
        )
        params.extend([uid, org, dept])
    where = (" AND " + " AND ".join(clauses)) if clauses else ""
    return where, params


def _knowledge_scope_clause(
    scope: str, scope_id: Optional[str], user: Dict[str, Any]
) -> tuple[str, List[Any]]:
    clauses: List[str] = []
    params: List[Any] = []
    org = user.get("organization_id")
    dept = user.get("department_id")
    uid = user["id"]
    if scope == "department":
        target = scope_id or dept
        if target:
            clauses.append("ki.department_id=?")
            params.append(target)
    elif scope == "private":
        clauses.append("ki.owner_id=?")
        params.append(uid)
    if not user.get("is_superadmin"):
        clauses.append(
            "(ki.visibility='public' OR ki.owner_id=? "
            "OR (ki.visibility IN ('department','org','organization') AND ki.organization_id=?) "
            "OR (ki.visibility='department' AND ki.department_id=?))"
        )
        params.extend([uid, org, dept])
    return (" AND " + " AND ".join(clauses)) if clauses else "", params


def _rrf_merge(*ranked_lists: List[List[Any]], k: int = 60) -> Dict[Any, float]:
    scores: Dict[Any, float] = {}
    for lst in ranked_lists:
        for rank, item in enumerate(lst):
            key = item if not isinstance(item, dict) else item.get("key")
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank + 1)
    return scores


def retrieve(
    question: str,
    user: Dict[str, Any],
    scope: str = "all",
    scope_id: Optional[str] = None,
    top_k: Optional[int] = None,
) -> List[RetrievedChunk]:
    start = time.time()
    top_k = top_k or settings.rag_retrieval_top_k
    embedder = get_embedding_service()
    q_vec = embedder.embed_one(normalize_persian(question))

    chunk_filter, chunk_params = _scope_clause(scope, scope_id, user)
    know_filter, know_params = _knowledge_scope_clause(scope, scope_id, user)

    candidates: Dict[str, RetrievedChunk] = {}

    # 1) FTS on chunks.
    fts_chunks = _fts_chunks(question, top_k, chunk_filter.replace("c.", "c."), chunk_params)
    fts_keys: List[Any] = []
    for i, row in enumerate(fts_chunks):
        key = ("doc", row["id"])
        fts_keys.append(key)
        if key not in candidates:
            candidates[key] = RetrievedChunk(
                source_type="document",
                source_id=row["document_id"],
                chunk_id=row["id"],
                title=row.get("doc_title") or "سند",
                content=row["content"],
                page_number=row["page_number"],
                section=row["section"],
                heading=row["heading"],
                visibility=row["visibility"],
                owner_id=row["owner_id"],
                department_id=row["department_id"],
                organization_id=row["organization_id"],
            )

    # 2) Vector search on chunks (requires sqlite-vec). We need to filter by
    #    visibility; vec0 only supports the embedding MATCH plus k, so we fetch
    #    a larger pool and post-filter.
    if db.vec_available():
        vec_rows = _vec_search(
            q_vec,
            "chunks_vec",
            "chunk_id",
            top_k * 3,
            "",
            [],
        )
        if vec_rows:
            ids = [v["id"] for v in vec_rows]
            placeholders = ",".join("?" for _ in ids)
            rows = db.query_all(
                f"""SELECT c.id, c.document_id, c.content, c.heading, c.section,
                           c.page_number, c.organization_id,
                           d.title AS doc_title, d.visibility, d.owner_id,
                           d.department_id
                    FROM document_chunks c
                    JOIN documents d ON d.id = c.document_id
                    WHERE c.id IN ({placeholders}) AND d.status='READY'""",
                ids,
            )
            vec_keys: List[Any] = []
            for pos, r in enumerate(rows):
                d = dict(r)
                # Apply scope/visibility filter in-process.
                temp = RetrievedChunk(
                    source_type="document",
                    source_id=d["document_id"],
                    chunk_id=d["id"],
                    title=d.get("doc_title") or "",
                    content=d["content"],
                    page_number=d["page_number"],
                    section=d["section"],
                    heading=d["heading"],
                    visibility=d["visibility"],
                    owner_id=d["owner_id"],
                    department_id=d["department_id"],
                    organization_id=d["organization_id"],
                )
                if not temp.is_visible_to(user):
                    continue
                if scope == "document" and scope_id and temp.source_id != scope_id:
                    continue
                if scope == "folder" and scope_id:
                    in_folder = db.query_one(
                        "SELECT 1 FROM documents WHERE id=? AND folder_id=?",
                        (temp.source_id, scope_id),
                    )
                    if not in_folder:
                        continue
                key = ("doc", d["id"])
                vec_keys.append(key)
                if key not in candidates:
                    doc = db.query_one(
                        "SELECT title FROM documents WHERE id=?", (d["document_id"],)
                    )
                    temp.title = doc["title"] if doc else "سند"
                    candidates[key] = temp
        else:
            vec_keys = []
    else:
        vec_keys = []

    # 3) Knowledge base FTS.
    know_rows = _fts_knowledge(question, top_k, know_filter, know_params)
    know_keys: List[Any] = []
    for row in know_rows:
        key = ("know", row["id"])
        know_keys.append(key)
        if key not in candidates:
            candidates[key] = RetrievedChunk(
                source_type="knowledge",
                source_id=row["id"],
                chunk_id=None,
                title=row["title"],
                content=row["content"],
                page_number=None,
                section=None,
                heading=None,
                visibility=row["visibility"],
                owner_id=row["owner_id"],
                department_id=row["department_id"],
                organization_id=row["organization_id"],
            )

    # 4) Vector search knowledge.
    if db.vec_available():
        vec_know = _vec_search(q_vec, "knowledge_vec", "knowledge_id", top_k * 2, "", [])
        vk_keys: List[Any] = []
        if vec_know:
            ids = [v["id"] for v in vec_know]
            placeholders = ",".join("?" for _ in ids)
            rows = db.query_all(
                f"""SELECT id, title, lesson_learned AS content, visibility, owner_id,
                           department_id, organization_id, status
                    FROM knowledge_items WHERE id IN ({placeholders})""",
                ids,
            )
            for r in rows:
                d = dict(r)
                if d["status"] != "PUBLISHED":
                    continue
                temp = RetrievedChunk(
                    source_type="knowledge",
                    source_id=d["id"],
                    chunk_id=None,
                    title=d["title"],
                    content=d["content"],
                    page_number=None,
                    section=None,
                    heading=None,
                    visibility=d["visibility"],
                    owner_id=d["owner_id"],
                    department_id=d["department_id"],
                    organization_id=d["organization_id"],
                )
                if not temp.is_visible_to(user):
                    continue
                key = ("know", d["id"])
                vk_keys.append(key)
                if key not in candidates:
                    candidates[key] = temp
    else:
        vk_keys = []

    # 5) RRF merge.
    rrf = _rrf_merge(fts_keys, vec_keys, know_keys, vk_keys)
    merged: List[RetrievedChunk] = []
    for key, score in sorted(rrf.items(), key=lambda x: x[1], reverse=True):
        chunk = candidates.get(key)
        if chunk is None:
            continue
        chunk.score = round(score, 5)
        merged.append(chunk)
        if len(merged) >= max(top_k, settings.rag_retrieval_top_k):
            break

    # 6) Rerank.
    if merged:
        reranker = get_reranker_service()
        docs = [f"{c.title}\n{c.content}" for c in merged]
        reranked = reranker.rerank(question, docs, top_k=settings.reranker_top_k)
        final = []
        for idx, score in reranked:
            merged[idx].score = round(float(score), 4)
            final.append(merged[idx])
        merged = final

    elapsed = (time.time() - start) * 1000
    return merged


def assemble_context(chunks: List[RetrievedChunk]) -> str:
    lines: List[str] = []
    for i, c in enumerate(chunks, start=1):
        title = c.title or "منبع"
        ref = f"[{i}] ({title}"
        if c.page_number:
            ref += f"، صفحه {c.page_number}"
        ref += ")"
        lines.append(f"{ref}\n{c.content}")
    return "\n\n".join(lines)


def sources_payload(chunks: List[RetrievedChunk]) -> List[Dict[str, Any]]:
    out = []
    for i, c in enumerate(chunks, start=1):
        out.append(
            {
                "citation_index": i,
                "source_type": c.source_type,
                "source_id": c.source_id,
                "chunk_id": c.chunk_id,
                "title": c.title,
                "page_number": c.page_number,
                "section": c.section,
                "heading": c.heading,
                "relevance_score": c.score,
                "snippet": c.content[:280],
            }
        )
    return out


def average_confidence(chunks: List[RetrievedChunk]) -> float:
    if not chunks:
        return 0.0
    return round(sum(c.score for c in chunks) / len(chunks), 4)


async def answer_stream(
    question: str,
    user: Dict[str, Any],
    history: List[Dict[str, str]],
    scope: str = "all",
    scope_id: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Full RAG streaming pipeline. Yields SSE-style event dicts."""
    language = detect_language(question)
    chunks = retrieve(question, user, scope=scope, scope_id=scope_id)
    sources = sources_payload(chunks)
    yield {"type": "sources", "sources": sources}

    confidence = average_confidence(chunks)
    yield {"type": "confidence", "score": confidence}

    system_prompt = _load_system_prompt(language)
    context = assemble_context(chunks)
    messages = llm_service.build_messages(
        system_prompt, history, question, context, language
    )

    llm = llm_service.get_llm_service()
    used_llm = False
    if await llm.is_available():
        try:
            async for token in llm.stream_chat(messages):
                used_llm = True
                yield {"type": "token", "content": token}
        except Exception as exc:
            yield {"type": "error", "message": f"LLM stream error: {exc}"}
            used_llm = False

    if not used_llm:
        # The extractive generator needs full chunk content (the UI-facing
        # ``sources`` payload only carries a short snippet).
        full_sources = [
            {"content": c.content, "title": c.title, "page_number": c.page_number}
            for c in chunks
        ]
        async for token in llm_service.extractive_stream(
            question, full_sources, history, language
        ):
            yield {"type": "token", "content": token}

    yield {"type": "done", "sources": sources, "confidence": confidence}


def _load_system_prompt(language: str) -> str:
    path = settings.system_prompt_path
    if path.exists():
        try:
            return path.read_text(encoding="utf-8")
        except OSError:
            pass
    if language.startswith("fa"):
        return (
            "تو دستیار هوشمند سازمانی هستی. پاسخ‌ها را دقیق، کوتاه و بر پایه منابع "
            "ارائه‌شده بنویس و به شماره منبع استناد کن. اگر منبع کافی نیست، شفاف بگو."
        )
    return (
        "You are an enterprise assistant. Answer concisely and accurately based "
        "only on the provided sources and cite source numbers."
    )
