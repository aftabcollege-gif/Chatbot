"""Health and system status endpoints (public + admin)."""
from __future__ import annotations

import time

import httpx
from fastapi import APIRouter, Depends

from core import database as db
from core.config import settings
from core.dependencies import get_current_user, require_admin
from services.embedding_service import get_embedding_service
from services.reranker_service import get_reranker_service

router = APIRouter(prefix="/api", tags=["health"])
_STARTED = time.time()


@router.get("/health")
async def health():
    """Unauthenticated liveness probe used by the desktop shell at startup."""
    services: dict = {}
    db_ok = True
    try:
        db.query_one("SELECT 1")
    except Exception:
        db_ok = False
    services["database"] = "ok" if db_ok else "error"
    services["vector_extension"] = "ok" if db.vec_available() else "degraded"
    services["embedding_backend"] = get_embedding_service().backend
    services["reranker_backend"] = get_reranker_service().backend

    # LLM reachability (non-blocking quick check).
    llm_status = "unknown"
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            r = await client.get(f"{settings.llm_server_url}/models")
            llm_status = "ok" if r.status_code == 200 else "unavailable"
    except Exception:
        llm_status = "unavailable"
    services["llm"] = llm_status

    return {
        "status": "ok" if db_ok else "degraded",
        "services": services,
        "version": settings.app_version,
        "uptime_seconds": int(time.time() - _STARTED),
    }


@router.get("/admin/system/health", dependencies=[Depends(require_admin)])
async def admin_health():
    base = await health()
    # Storage and DB sizes.
    try:
        db_size = settings.db_path.stat().st_size
    except OSError:
        db_size = 0
    storage_used = 0
    for p in (settings.storage_path / "documents").rglob("*"):
        if p.is_file():
            storage_used += p.stat().st_size
    base["database"] = {"status": "ok", "size_mb": round(db_size / 1024 / 1024, 2)}
    base["storage"] = {
        "status": "ok",
        "used_mb": round(storage_used / 1024 / 1024, 2),
    }
    base["embedding"] = {
        "status": "ok",
        "backend": get_embedding_service().backend,
        "dimension": settings.embedding_dim,
    }
    base["reranker"] = {"status": "ok", "backend": get_reranker_service().backend}
    return base


@router.get("/admin/system/stats", dependencies=[Depends(require_admin)])
async def stats():
    def scalar(sql: str) -> int:
        r = db.query_one(sql)
        return int(r[0]) if r else 0

    return {
        "documents": scalar("SELECT COUNT(*) FROM documents"),
        "ready_documents": scalar("SELECT COUNT(*) FROM documents WHERE status='READY'"),
        "chunks": scalar("SELECT COUNT(*) FROM document_chunks"),
        "conversations": scalar("SELECT COUNT(*) FROM conversations"),
        "messages": scalar("SELECT COUNT(*) FROM messages"),
        "users": scalar("SELECT COUNT(*) FROM users"),
        "knowledge": scalar("SELECT COUNT(*) FROM knowledge_items"),
        "published_knowledge": scalar(
            "SELECT COUNT(*) FROM knowledge_items WHERE status='PUBLISHED'"
        ),
    }
