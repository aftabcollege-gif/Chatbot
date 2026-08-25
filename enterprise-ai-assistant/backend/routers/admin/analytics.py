"""Admin: analytics over RAG usage and activity."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from core import database as db
from core.dependencies import require_admin

router = APIRouter(prefix="/api/admin/analytics", tags=["admin-analytics"])


@router.get("/rag")
def rag_analytics(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    admin: dict = Depends(require_admin),
):
    clauses = ["role='assistant'"]
    params: list = []
    if from_date:
        clauses.append("created_at >= ?")
        params.append(from_date)
    if to_date:
        clauses.append("created_at <= ?")
        params.append(to_date)
    where = " WHERE " + " AND ".join(clauses)
    total = db.query_one(
        f"SELECT COUNT(*) AS c FROM messages{where}", params
    )["c"]
    answered = db.query_one(
        f"SELECT COUNT(*) AS c FROM messages{where} AND confidence_score >= ?",
        [*params, 0.3],
    )["c"]
    avg_conf = db.query_one(
        f"SELECT AVG(confidence_score) AS a FROM messages{where} AND confidence_score IS NOT NULL",
        params,
    )["a"]
    avg_rt = db.query_one(
        f"SELECT AVG(response_time_ms) AS a FROM messages{where} AND response_time_ms IS NOT NULL",
        params,
    )["a"]
    pos = db.query_one(
        f"SELECT COUNT(*) AS c FROM messages{where} AND feedback='positive'", params
    )["c"]
    neg = db.query_one(
        f"SELECT COUNT(*) AS c FROM messages{where} AND feedback='negative'", params
    )["c"]

    top_sources = db.query_all(
        f"""SELECT source_type, source_id, COUNT(*) AS c
            FROM message_sources ms JOIN messages m ON m.id=ms.message_id
            WHERE m.role='assistant'
            GROUP BY source_type, source_id ORDER BY c DESC LIMIT 10"""
    )
    return {
        "total_queries": total,
        "answered": answered,
        "unanswered": max(0, total - answered),
        "avg_retrieval_score": round(float(avg_conf or 0), 4),
        "avg_response_time_ms": int(avg_rt or 0),
        "feedback_positive": pos,
        "feedback_negative": neg,
        "top_sources": [dict(r) for r in top_sources],
    }


@router.get("/activity")
def activity(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    group_by: str = "day",
    admin: dict = Depends(require_admin),
):
    fmt = {
        "day": "%Y-%m-%d",
        "week": "%Y-W%W",
        "month": "%Y-%m",
    }.get(group_by, "%Y-%m-%d")
    clauses = []
    params: list = []
    if from_date:
        clauses.append("created_at >= ?")
        params.append(from_date)
    if to_date:
        clauses.append("created_at <= ?")
        params.append(to_date)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = db.query_all(
        f"""SELECT strftime(?, created_at) AS bucket,
                   COUNT(*) AS total,
                   SUM(CASE WHEN event_code LIKE 'auth.login%' THEN 1 ELSE 0 END) AS logins,
                   SUM(CASE WHEN resource_type='document' THEN 1 ELSE 0 END) AS document_events,
                   SUM(CASE WHEN event_code LIKE 'knowledge%' THEN 1 ELSE 0 END) AS knowledge_events
            FROM audit_logs{where}
            GROUP BY bucket ORDER BY bucket ASC""",
        [fmt, *params],
    )
    return {"data": [dict(r) for r in rows], "group_by": group_by}
