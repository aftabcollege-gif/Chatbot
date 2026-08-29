"""Global search across documents, chunks and knowledge items."""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core import database as db
from services.embedding_service import get_embedding_service
from services.normalizer_service import normalize_for_index
from utils.persian import tokenize


def _access_clause(user: dict, alias: str = "c") -> tuple[str, list]:
    if user.get("is_superadmin"):
        return "", []
    return (
        f" AND ({alias}.visibility='public' OR {alias}.owner_id=? OR "
        f"({alias}.visibility='department' AND {alias}.department_id=?) OR "
        f"({alias}.visibility IN ('org','organization') AND {alias}.organization_id=?))"
    ), [user["id"], user.get("department_id"), user.get("organization_id")]


def global_search(
    q: str,
    user: dict,
    result_type: Optional[str] = None,
    department_id: Optional[str] = None,
    file_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    start = time.time()
    results: List[Dict[str, Any]] = []
    match_q = " OR ".join(tokenize(q))[:1000] or q

    if result_type in (None, "document", "chunk"):
        clauses = []
        params: list = []
        if file_type:
            clauses.append("d.file_type=?")
            params.append(file_type)
        if department_id:
            clauses.append("d.department_id=?")
            params.append(department_id)
        if from_date:
            clauses.append("d.created_at >= ?")
            params.append(from_date)
        if to_date:
            clauses.append("d.created_at <= ?")
            params.append(to_date)
        access_sql, access_params = _access_clause(user, "c")
        sql_filter = (" AND " + " AND ".join(clauses)) if clauses else ""
        sql = f"""
            SELECT c.id AS chunk_id, c.document_id, c.content, c.heading, c.section,
                   c.page_number, d.title, d.file_type, d.organization_id,
                   d.department_id, c.owner_id, c.visibility,
                   bm25(chunks_fts) AS rank_score
            FROM chunks_fts
            JOIN document_chunks c ON c.rowid = chunks_fts.rowid
            JOIN documents d ON d.id = c.document_id
            WHERE chunks_fts MATCH ? {sql_filter} {access_sql}
              AND d.status='READY'
            ORDER BY rank_score LIMIT ? OFFSET ?
        """
        try:
            rows = db.query_all(
                sql, [match_q, *params, *access_params, limit, (page - 1) * limit]
            )
            for r in rows:
                results.append(
                    {
                        "type": "chunk",
                        "id": r["chunk_id"],
                        "document_id": r["document_id"],
                        "title": r["title"],
                        "snippet": (r["content"] or "")[:280],
                        "heading": r["heading"],
                        "section": r["section"],
                        "page_number": r["page_number"],
                        "file_type": r["file_type"],
                    }
                )
        except Exception:
            pass

    if result_type in (None, "knowledge"):
        access_sql, access_params = _access_clause(user, "ki")
        sql = f"""
            SELECT ki.id, ki.title, ki.lesson_learned, ki.subject,
                   bm25(knowledge_fts) AS rank_score
            FROM knowledge_fts
            JOIN knowledge_items ki ON ki.rowid = knowledge_fts.rowid
            WHERE knowledge_fts MATCH ? AND ki.status='PUBLISHED' {access_sql}
            ORDER BY rank_score LIMIT ? OFFSET ?
        """
        try:
            rows = db.query_all(
                sql, [match_q, *access_params, limit, (page - 1) * limit]
            )
            for r in rows:
                results.append(
                    {
                        "type": "knowledge",
                        "id": r["id"],
                        "title": r["title"],
                        "snippet": (r["lesson_learned"] or "")[:280],
                        "subject": r["subject"],
                    }
                )
        except Exception:
            pass

    # Vector-augmented search (semantic) if extension available.
    if db.vec_available() and result_type in (None, "chunk"):
        try:
            embedder = get_embedding_service()
            vec = embedder.embed_one(normalize_for_index(q))
            blob = embedder.to_blob(vec)
            vrows = db.query_all(
                "SELECT chunk_id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = ?",
                [blob, limit],
            )
            existing = {r["id"] for r in results if r["type"] == "chunk"}
            for vr in vrows:
                if vr["chunk_id"] in existing:
                    continue
                row = db.query_one(
                    """SELECT c.*, d.title, d.file_type FROM document_chunks c
                       JOIN documents d ON d.id=c.document_id
                       WHERE c.id=? AND d.status='READY'""",
                    (vr["chunk_id"],),
                )
                if row:
                    results.append(
                        {
                            "type": "chunk",
                            "id": row["id"],
                            "document_id": row["document_id"],
                            "title": row["title"],
                            "snippet": (row["content"] or "")[:280],
                            "heading": row["heading"],
                            "page_number": row["page_number"],
                            "file_type": row["file_type"],
                            "semantic": True,
                        }
                    )
        except Exception:
            pass

    query_time_ms = int((time.time() - start) * 1000)
    return {
        "results": results[:limit],
        "total": len(results),
        "query_time_ms": query_time_ms,
        "suggestions": [],
    }


def suggestions(q: str, limit: int = 8) -> list:
    if not q.strip():
        return []
    match_q = " OR ".join(tokenize(q))[:500] or q
    try:
        rows = db.query_all(
            """SELECT DISTINCT d.title FROM chunks_fts
               JOIN document_chunks c ON c.rowid = chunks_fts.rowid
               JOIN documents d ON d.id = c.document_id
               WHERE chunks_fts MATCH ? AND d.status='READY' LIMIT ?""",
            [match_q, limit],
        )
        return [r["title"] for r in rows]
    except Exception:
        return []
