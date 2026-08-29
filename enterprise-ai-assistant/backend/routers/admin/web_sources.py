"""Admin: allowed web sources (crawling is offline/no-op unless explicitly run)."""
from __future__ import annotations

import json
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException

from core import database as db
from core.dependencies import require_admin
from models.schemas import WebSourceCreate, WebSourceUpdate
from services import audit_service

router = APIRouter(prefix="/api/admin/web-sources", tags=["admin-web"])


def _domain(value: str) -> str:
    value = value.strip()
    if "://" not in value:
        value = "https://" + value
    parsed = urlparse(value)
    host = parsed.hostname or value
    return host.lower()


@router.get("")
def list_sources(admin: dict = Depends(require_admin)):
    return {"sources": [dict(r) for r in db.query_all(
        "SELECT * FROM web_sources ORDER BY created_at DESC"
    )]}


@router.post("")
def create_source(payload: WebSourceCreate, admin: dict = Depends(require_admin)):
    domain = _domain(payload.domain)
    if not domain:
        raise HTTPException(400, "دامنه نامعتبر است.")
    sid = db.insert_and_pk(
        "web_sources",
        {
            "organization_id": admin.get("organization_id"),
            "domain": domain,
            "allowed_paths": json.dumps(payload.allowed_paths),
            "crawl_depth": payload.crawl_depth,
            "refresh_hours": payload.refresh_hours,
            "created_by": admin["id"],
        },
    )
    audit_service.log("admin.web_create", actor_id=admin["id"], resource_id=sid, resource_name=domain)
    return dict(db.query_one("SELECT * FROM web_sources WHERE id=?", (sid,)))


@router.patch("/{sid}")
def update_source(sid: str, payload: WebSourceUpdate, admin: dict = Depends(require_admin)):
    if not db.query_one("SELECT 1 FROM web_sources WHERE id=?", (sid,)):
        raise HTTPException(404, "یافت نشد.")
    sets, params = [], []
    if payload.allowed_paths is not None:
        sets.append("allowed_paths=?")
        params.append(json.dumps(payload.allowed_paths))
    if payload.crawl_depth is not None:
        sets.append("crawl_depth=?")
        params.append(payload.crawl_depth)
    if payload.refresh_hours is not None:
        sets.append("refresh_hours=?")
        params.append(payload.refresh_hours)
    if payload.is_active is not None:
        sets.append("is_active=?")
        params.append(1 if payload.is_active else 0)
    params.append(sid)
    db.execute(f"UPDATE web_sources SET {', '.join(sets)} WHERE id=?", params)
    return dict(db.query_one("SELECT * FROM web_sources WHERE id=?", (sid,)))


@router.delete("/{sid}")
def delete_source(sid: str, admin: dict = Depends(require_admin)):
    db.execute("DELETE FROM web_sources WHERE id=?", (sid,))
    return {"success": True}


@router.post("/{sid}/crawl")
def crawl_source(sid: str, admin: dict = Depends(require_admin)):
    row = db.query_one("SELECT * FROM web_sources WHERE id=?", (sid,))
    if not row:
        raise HTTPException(404, "منبع یافت نشد.")
    # In a fully offline build we record the request but do not reach the network.
    job_id = db.insert_and_pk(
        "processing_jobs",
        {
            "job_type": "crawl",
            "status": "PENDING",
            "payload": json.dumps({"web_source_id": sid, "domain": row["domain"]}),
            "created_by": admin["id"],
        },
    )
    audit_service.log("admin.web_crawl", actor_id=admin["id"], resource_id=sid)
    return {"job_id": job_id, "note": "کراول در حالت آفلاین فقط صف می‌شود و هنگام اتصال اجرا می‌گردد."}
