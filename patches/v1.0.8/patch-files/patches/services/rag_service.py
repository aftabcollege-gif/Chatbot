"""Retrieval-Augmented Generation pipeline.

Hybrid retrieval:
  1. Full-text search (FTS5 / BM25) on chunks and knowledge items — queried with
     the *meaningful* words only (see :func:`utils.persian.content_terms`) and
     ZWNJ-tolerant spellings.
  2. Vector search on the same content (sqlite-vec, or the numpy fallback).
  3. Permission / scope filtering.
  4. Reciprocal Rank Fusion (RRF) merge.
  5. Evidence scoring: lexical coverage (IDF-weighted) + vector similarity +
     reranker, so a chunk is only offered as a source when there is real
     evidence for it — unrelated procedures are no longer cited, and sources
     that only share a stop-word like «فرآیند» are dropped.
  6. Context assembly (deduplicated, token-budgeted) + streaming answer with a
     repetition guard and a graceful extractive fallback.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional, Set, Tuple

from core import database as db
from core.config import settings
from services.answer_guard import RepetitionGuard, dedupe_sentences
from services.embedding_service import get_embedding_service
try:  # the patch bundle may run against a build that lacks this module
    from services.query_context_service import standalone_query
except ImportError:  # pragma: no cover - legacy frozen builds
    standalone_query = None  # type: ignore[assignment]


async def _resolve_or_keep(question: str, history: List[Dict[str, str]], language: str) -> Dict[str, Any]:
    """Follow-up resolution, or the untouched question when unavailable."""
    if standalone_query is None or not history:
        return {"query": question, "rewritten": False, "method": "none"}
    return await standalone_query(question, history)
from services.rag_scoring import (  # noqa: F401 — re-exported for callers/tests
    combine_evidence,
    distinctive_terms,
    inverse_document_frequency,
    jaccard,
    lexical_coverage,
    select_sources,
)
from services.reranker_service import get_reranker_service
from services import llm_service
from utils.persian import (
    approximate_tokens,
    content_terms,
    detect_language,
    fts_query,
    normalize_persian,
    tokenize,
)


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
    #: Signed-off evidence, all in 0..1 (see :func:`score_candidates`).
    lexical_score: float = 0.0
    vector_score: Optional[float] = None
    rerank_score: float = 0.0

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

    def body_text(self) -> str:
        return " ".join(part for part in (self.heading, self.section, self.content) if part)

    def title_text(self) -> str:
        return " ".join(part for part in (self.title, self.heading, self.section) if part)


# --------------------------------------------------------------------------- #
# SQL helpers
# --------------------------------------------------------------------------- #
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


def distance_to_similarity(distance: float) -> float:
    """Convert a vector *distance* into a 0..1 similarity.

    The two backends report different metrics: the numpy fallback returns the
    cosine distance (``1 - cos``), while native ``vec0`` defaults to L2 — for the
    unit-norm vectors we store, ``cos = 1 - L2²/2``.
    """
    try:
        d = max(0.0, float(distance))
    except (TypeError, ValueError):
        return 0.0
    if db.vec_backend() == "numpy":
        similarity = 1.0 - d
    else:
        similarity = 1.0 - (d * d) / 2.0
    return max(0.0, min(1.0, similarity))


def _fts_chunks(query: str, k: int, filters: str, params: List[Any]) -> List[Dict[str, Any]]:
    conn = db.get_conn()
    match_q = fts_query(query)
    if not match_q:
        return []
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
    match_q = fts_query(query)
    if not match_q:
        return []
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


# --------------------------------------------------------------------------- #
# Evidence scoring / selection
# --------------------------------------------------------------------------- #
#: Kept as a thin wrapper so the scoring rules live in exactly one place
#: (:mod:`services.rag_scoring`) while callers/tests can keep using this name.
def score_candidates(
    chunks: List[RetrievedChunk],
    terms: List[str],
    *,
    min_relevance: Optional[float] = None,
    max_per_source: Optional[int] = None,
    duplicate_similarity: Optional[float] = None,
    limit: Optional[int] = None,
) -> List[RetrievedChunk]:
    """Score, gate, deduplicate and rank the candidates (see :mod:`rag_scoring`)."""
    return select_sources(
        chunks,
        terms,
        tokenize,
        min_relevance=_setting("rag_min_relevance", 0.08) if min_relevance is None else min_relevance,
        max_per_source=(
            _setting("rag_max_chunks_per_source", 2) if max_per_source is None else max_per_source
        ),
        duplicate_similarity=(
            _setting("rag_duplicate_similarity", 0.75) if duplicate_similarity is None else duplicate_similarity
        ),
        limit=settings.reranker_top_k if limit is None else limit,
    )


async def resolve_query(
    question: str,
    history: Optional[List[Dict[str, str]]] = None,
    language: str = "fa",
) -> Dict[str, Any]:
    """Make *question* self-contained using the conversation (never raises)."""
    try:
        return await _resolve_or_keep(question, history or [], language)
    except Exception:
        return {"query": question, "rewritten": False, "method": "none"}


# --------------------------------------------------------------------------- #
# Retrieval
# --------------------------------------------------------------------------- #
def retrieve(
    question: str,
    user: Dict[str, Any],
    scope: str = "all",
    scope_id: Optional[str] = None,
    top_k: Optional[int] = None,
) -> List[RetrievedChunk]:
    start = time.time()
    pool_k = top_k or settings.rag_retrieval_top_k
    final_k = settings.reranker_top_k
    terms = content_terms(question) or tokenize(normalize_persian(question))

    embedder = get_embedding_service()
    q_vec = embedder.embed_one(normalize_persian(question))

    chunk_filter, chunk_params = _scope_clause(scope, scope_id, user)
    know_filter, know_params = _knowledge_scope_clause(scope, scope_id, user)

    candidates: Dict[Any, RetrievedChunk] = {}

    # 1) FTS on chunks.
    fts_chunks = _fts_chunks(question, pool_k, chunk_filter, chunk_params)
    fts_keys: List[Any] = []
    for row in fts_chunks:
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

    # 2) Vector search on chunks. We need to filter by visibility; vec0 only
    #    supports the embedding MATCH plus k, so we fetch a larger pool and
    #    post-filter.
    vec_keys: List[Any] = []
    if db.vec_available():
        vec_rows = _vec_search(q_vec, "chunks_vec", "chunk_id", pool_k * 3, "", [])
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
            by_id = {dict(r)["id"]: dict(r) for r in rows}
            for hit in vec_rows:
                d = by_id.get(hit["id"])
                if not d:
                    continue
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
                similarity = distance_to_similarity(hit["distance"])
                if key not in candidates:
                    temp.title = temp.title or "سند"
                    temp.vector_score = similarity
                    candidates[key] = temp
                else:
                    candidates[key].vector_score = max(
                        candidates[key].vector_score or 0.0, similarity
                    )
        else:
            vec_keys = []

    # 3) Knowledge base FTS.
    know_rows = _fts_knowledge(question, pool_k, know_filter, know_params)
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
    vk_keys: List[Any] = []
    if db.vec_available():
        vec_know = _vec_search(q_vec, "knowledge_vec", "knowledge_id", pool_k * 2, "", [])
        if vec_know:
            ids = [v["id"] for v in vec_know]
            placeholders = ",".join("?" for _ in ids)
            rows = db.query_all(
                f"""SELECT id, title, lesson_learned AS content, visibility, owner_id,
                           department_id, organization_id, status
                    FROM knowledge_items WHERE id IN ({placeholders})""",
                ids,
            )
            by_id = {dict(r)["id"]: dict(r) for r in rows}
            for hit in vec_know:
                d = by_id.get(hit["id"])
                if not d or d["status"] != "PUBLISHED":
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
                similarity = distance_to_similarity(hit["distance"])
                if key not in candidates:
                    temp.vector_score = similarity
                    candidates[key] = temp
                else:
                    candidates[key].vector_score = max(
                        candidates[key].vector_score or 0.0, similarity
                    )

    # 5) RRF merge (kept as the recall ordering) …
    rrf = _rrf_merge(fts_keys, vec_keys, know_keys, vk_keys)
    merged: List[RetrievedChunk] = []
    for key, _score in sorted(rrf.items(), key=lambda x: x[1], reverse=True):
        chunk = candidates.get(key)
        if chunk is None:
            continue
        merged.append(chunk)
        if len(merged) >= max(pool_k, settings.rag_retrieval_top_k):
            break

    # 6) … then rerank (absolute 0..1) and score every candidate with the
    #    evidence it actually carries.
    if merged:
        reranker = get_reranker_service()
        docs = [f"{c.title}\n{c.body_text()}" for c in merged]
        for index, score in reranker.rerank(question, docs, top_k=len(merged)):
            merged[index].rerank_score = max(0.0, min(1.0, float(score)))

    result = score_candidates(merged, terms, limit=final_k)
    elapsed = (time.time() - start) * 1000
    if not result:
        print(
            f"[rag] no source passed the evidence gate "
            f"(terms={terms[:6]}, candidates={len(merged)}, {elapsed:.0f} ms)"
        )
    return result


def assemble_context(chunks: List[RetrievedChunk], max_tokens: Optional[int] = None) -> str:
    """Numbered, deduplicated and token-budgeted context for the model.

    Sentences that already appeared in an earlier chunk (overlapping chunks
    repeat them) are not pasted again — otherwise the model restates them.
    """
    budget = max_tokens or settings.rag_context_max_tokens
    parts: List[str] = []
    used = 0
    seen: Set[str] = set()
    for index, chunk in enumerate(chunks, start=1):
        body = dedupe_sentences(chunk.content, seen)
        if not body.strip():
            continue
        title = chunk.title or "منبع"
        ref = f"[{index}] ({title}"
        if chunk.page_number:
            ref += f"، صفحه {chunk.page_number}"
        ref += ")"
        part = f"{ref}\n{body}"
        cost = approximate_tokens(part)
        if parts and used + cost > budget:
            break
        parts.append(part)
        used += cost
    return "\n\n".join(parts)


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


def _setting(name: str, default):
    """Read a config value, tolerating an older ``core.config``.

    Patch builds replace only some modules, so a config key that exists in this
    tree may be missing from the frozen one — a missing key must degrade to its
    default, never raise ``AttributeError`` at request time.
    """
    value = getattr(settings, name, None)
    return default if value is None else value


def prompt_budget(slot_tokens: Optional[int] = None) -> Tuple[int, int, int]:
    """``(max_tokens, context_tokens, history_tokens)`` for one chat request.

    Everything is derived from the model slot — the value llama-server reports
    when it is running, otherwise the configured one — so the request always
    fits and the server never answers with HTTP 400 (the old «LLM stream
    error»).
    """
    slot = int(slot_tokens or _setting("llm_slot_tokens", 0) or 0)
    if not slot:
        context = int(_setting("llm_context_size", 4096))
        slot = max(512, context // max(1, int(_setting("llm_parallel", 1))))
    reserve = int(_setting("llm_reserve_tokens", 320))
    max_tokens = max(256, min(int(_setting("llm_max_tokens", 1024)), slot // 3))
    history_tokens = max(160, min(settings.rag_history_max_tokens, slot // 5))
    context_tokens = max(
        400, min(settings.rag_context_max_tokens, slot - max_tokens - reserve - history_tokens)
    )
    return max_tokens, context_tokens, history_tokens


def no_information_answer(language: str) -> str:
    if language.startswith("fa"):
        return (
            "اطلاعاتی در منابع مجاز سازمان برای پاسخ به این پرسش پیدا نشد. "
            "اگر سند مرتبطی وجود دارد، آن را بارگذاری کنید یا پرسش را دقیق‌تر بپرسید."
        )
    return (
        "I could not find information in the allowed sources to answer this question. "
        "Upload the related document or ask a more specific question."
    )


def search_unavailable_answer(language: str) -> str:
    """Fallback wording when the index itself cannot be queried."""
    if language.startswith("fa"):
        return (
            "در خواندن منابع سازمان خطایی رخ داد و پاسخ‌یابی در این لحظه ممکن نیست. "
            "چند لحظه بعد دوباره تلاش کنید؛ اگر تکرار شد صفحه «سلامت سیستم» را بررسی کنید."
        )
    return (
        "The document index could not be read, so answering is unavailable right now. "
        "Try again shortly; if it repeats, check the System Health page."
    )


async def _stream_text(text: str) -> AsyncIterator[Dict[str, Any]]:
    for index, word in enumerate(text.split()):
        yield {"type": "token", "content": word if index == 0 else " " + word}


async def answer_stream(
    question: str,
    user: Dict[str, Any],
    history: List[Dict[str, str]],
    scope: str = "all",
    scope_id: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Full RAG streaming pipeline. Yields SSE-style event dicts.

    Failure handling: the answer is never replaced by a technical error. If the
    model cannot answer (unreachable, prompt rejected, or it crashed mid-stream)
    the answer degrades to the extractive mode, and the user sees at most a
    short note.
    """
    language = detect_language(question)

    # A follow-up («برای مدیران هم همین‌طور است؟») carries no subject of its own;
    # resolve it against the conversation first, then retrieve with the
    # standalone wording — retrieval and the answer both use it.
    try:
        resolved = await resolve_query(question, history, language)
    except Exception as exc:  # noqa: BLE001 — a broken rewrite must not break the chat
        print(f"[rag] follow-up resolution failed: {exc!r}")
        resolved = {"query": question, "rewritten": False, "method": "none"}
    search_query = resolved["query"] if resolved.get("rewritten") else question
    if resolved.get("rewritten"):
        yield {
            "type": "query",
            "query": resolved["query"],
            "method": resolved["method"],
            "original": question,
        }

    try:
        chunks = retrieve(search_query, user, scope=scope, scope_id=scope_id)
    except Exception as exc:  # noqa: BLE001 — never show a raw traceback as the answer
        print(f"[rag] retrieval failed: {exc!r}")
        async for event in _stream_text(search_unavailable_answer(language)):
            yield event
        yield {"type": "done", "sources": [], "confidence": 0.0, "used_llm": False}
        return
    sources = sources_payload(chunks)
    yield {"type": "sources", "sources": sources}

    confidence = average_confidence(chunks)
    yield {"type": "confidence", "score": confidence}

    if not chunks:
        # Nothing passed the evidence gate: answer honestly instead of asking the
        # model to invent something from an empty context.
        async for event in _stream_text(no_information_answer(language)):
            yield event
        yield {"type": "done", "sources": sources, "confidence": 0.0, "used_llm": False}
        return

    # Probe the model first: the budget below must use the context the server
    # actually has (it may have been started by an older shell with a smaller
    # --ctx-size, which is exactly what used to trigger HTTP 400).
    llm = llm_service.get_llm_service()
    llm_ready = await llm.is_available()

    max_tokens, context_tokens, history_tokens = prompt_budget(llm.slot_tokens)
    system_prompt = _load_system_prompt(language)
    context = assemble_context(chunks, context_tokens)
    messages = llm_service.build_messages(
        system_prompt, history, question, context, language, history_budget_tokens=history_tokens
    )

    guard = RepetitionGuard()
    used_llm = False
    partial = False

    if llm_ready:
        for attempt in (1, 2):
            try:
                async for token in llm.stream_chat(messages, max_tokens=max_tokens):
                    partial = True
                    safe = guard.push(token)
                    if safe:
                        yield {"type": "token", "content": safe}
                used_llm = True
                break
            except llm_service.ContextOverflowError as exc:
                # The prompt did not fit after all: halve the context and retry.
                print(f"[rag] prompt too long ({exc}); retrying with a smaller context")
                context_tokens = max(300, context_tokens // 2)
                context = assemble_context(chunks, context_tokens)
                messages = llm_service.build_messages(
                    system_prompt,
                    history,
                    question,
                    context,
                    language,
                    history_budget_tokens=max(0, history_tokens // 2),
                )
                continue
            except Exception as exc:  # noqa: BLE001 — any model failure degrades
                print(f"[rag] local model failed ({exc.__class__.__name__}: {exc}); using extractive answer")
                break

    tail = guard.flush()
    if tail:
        yield {"type": "token", "content": tail}

    if not used_llm:
        if partial and guard.emitted_chars > 0:
            # The model had already produced a usable beginning; keep it and say
            # that it stopped early instead of silently mixing in another answer.
            note = (
                "\n\n(ادامهٔ پاسخ از سمت مدل محلی ناتمام ماند. برای پاسخ کامل، همین پرسش را دوباره بپرسید.)"
                if language.startswith("fa")
                else "\n\n(The local model stopped early; ask again for the full answer.)"
            )
            yield {"type": "token", "content": note}
        else:
            full_sources = [
                {"content": c.content, "title": c.title, "page_number": c.page_number}
                for c in chunks
            ]
            note = (
                "پاسخ زیر مستقیماً از منابع استخراج شده است (مدل محلی در دسترس نبود):"
                if language.startswith("fa")
                else "The answer below is extracted directly from the sources:"
            )
            async for token in llm_service.extractive_stream(
                search_query, full_sources, history, language, note=note
            ):
                yield {"type": "token", "content": token}

    yield {
        "type": "done",
        "sources": sources,
        "confidence": confidence,
        "used_llm": used_llm,
    }


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
            "ارائه‌شده بنویس و به شماره منبع استناد کن. هر مطلب را یک بار بنویس و "
            "جمله‌ها را تکرار نکن. اگر منبع کافی نیست، شفاف بگو."
        )
    return (
        "You are an enterprise assistant. Answer concisely and accurately based "
        "only on the provided sources and cite source numbers. Never repeat a "
        "sentence. Say so when the sources are insufficient."
    )
