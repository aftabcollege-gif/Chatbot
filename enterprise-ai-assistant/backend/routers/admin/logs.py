"""Admin: audit logs with a natural-language query helper."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, APIRouter
from fastapi.responses import StreamingResponse

from core import database as db
from core.dependencies import require_admin
from models.schemas import LogQuery
from utils.persian import tokenize

router = APIRouter(prefix="/api/admin/logs", tags=["admin-logs"])


@router.get("")
def list_logs(
    page: int = 1,
    limit: int = 50,
    event_type: Optional[str] = None,
    user_id: Optional[str] = None,
    resource_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to: Optional[str] = None,
    admin: dict = Depends(require_admin),
):
    clauses = []
    params: list = []
    if event_type:
        clauses.append("event_code LIKE ?")
        params.append(f"%{event_type}%")
    if user_id:
        clauses.append("actor_id=?")
        params.append(user_id)
    if resource_id:
        clauses.append("resource_id=?")
        params.append(resource_id)
    if from_date:
        clauses.append("created_at >= ?")
        params.append(from_date)
    if to:
        clauses.append("created_at <= ?")
        params.append(to)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    total = db.query_one(f"SELECT COUNT(*) AS c FROM audit_logs{where}", params)["c"]
    rows = db.query_all(
        f"SELECT * FROM audit_logs{where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [*params, limit, (page - 1) * limit],
    )
    return {"logs": [dict(r) for r in rows], "total": total, "page": page, "limit": limit}


@router.get("/export")
def export_logs(format: str = "csv", admin: dict = Depends(require_admin)):
    rows = db.query_all("SELECT * FROM audit_logs ORDER BY created_at DESC")

    def csv_iter():
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["id", "event_code", "actor_name", "resource_type", "resource_id", "created_at", "metadata"])
        yield out.getvalue()
        out.seek(0)
        out.truncate(0)
        for r in rows:
            writer.writerow([
                r["id"], r["event_code"], r["actor_name"], r["resource_type"],
                r["resource_id"], r["created_at"], r["metadata"],
            ])
            yield out.getvalue()
            out.seek(0)
            out.truncate(0)

    if format == "json":
        payload = json.dumps([dict(r) for r in rows], ensure_ascii=False, indent=2)

        async def json_iter():
            yield payload

        return StreamingResponse(
            json_iter(),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="audit-logs.json"'},
        )
    return StreamingResponse(
        csv_iter(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit-logs.csv"'},
    )


@router.post("/query")
def query_logs(payload: LogQuery, admin: dict = Depends(require_admin)):
    """Translate a short natural-language question into a SQL filter and return
    a compact answer. This is a deterministic, offline helper (no LLM needed).
    """
    q = payload.question.lower()
    tokens = set(tokenize(payload.question))
    clauses = []
    params: list = []
    description = "نمایش ۵۰ رخداد اخید."

    if "ورود" in q or "login" in q:
        clauses.append("event_code LIKE 'auth.login%'")
        description = "رویدادهای ورود کاربران."
    elif "خطا" in q or "error" in q:
        clauses.append("event_code LIKE '%error%' OR event_code LIKE '%reject%'")
        description = "رویدادهای خطا یا رد."
    elif "سند" in q or "document" in q or "آپلود" in q or "بارگذاری" in q:
        clauses.append("resource_type='document'")
        description = "فعالیت‌های مربوط به اسناد."
    elif "دانش" in q or "knowledge" in q or "تجربه" in q:
        clauses.append("resource_type='knowledge'")
        description = "فعالیت‌های پایگاه دانش."
    elif "کاربر" in q or "user" in q:
        clauses.append("resource_type='user' OR event_code LIKE 'admin.user%'")
        description = "فعالیت‌های کاربری."

    # Date words.
    today = datetime.utcnow().date()
    if "امروز" in tokens or "today" in q:
        clauses.append("date(created_at)=date('now')")
    elif "دیروز" in q or "yesterday" in q:
        clauses.append("date(created_at)=date('now','-1 day')")
    elif "هفته" in q or "week" in q:
        week_ago = (today - timedelta(days=7)).isoformat()
        clauses.append("date(created_at) >= ?")
        params.append(week_ago)

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = db.query_all(
        f"SELECT * FROM audit_logs{where} ORDER BY created_at DESC LIMIT 50",
        params,
    )
    data = [dict(r) for r in rows]

    counts: dict[str, int] = {}
    for r in data:
        counts[r["event_code"]] = counts.get(r["event_code"], 0) + 1
    answer = f"{description} مجموع {len(data)} رخداد یافت شد."
    if counts:
        top = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:3]
        answer += " پرتکرارترین: " + "، ".join(f"{k} ({v})" for k, v in top) + "."

    return {"answer": answer, "data": data, "query_used": where.strip() or "SELECT * FROM audit_logs"}
