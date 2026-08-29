"""Admin: system settings."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from core import database as db
from core.dependencies import require_admin
from models.schemas import SettingsUpdate
from services import audit_service

router = APIRouter(prefix="/api/admin", tags=["admin-settings"])


@router.get("/settings")
def get_settings(admin: dict = Depends(require_admin)):
    rows = db.query_all("SELECT key, value, description FROM system_settings")
    return {"settings": {r["key"]: {"value": r["value"], "description": r["description"]} for r in rows}}


@router.patch("/settings")
def update_settings(payload: SettingsUpdate, admin: dict = Depends(require_admin)):
    for key, val in payload.settings.items():
        db.execute(
            """INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')""",
            (key, str(val)),
        )
    audit_service.log("admin.settings_update", actor_id=admin["id"], metadata=payload.settings)
    rows = db.query_all("SELECT key, value, description FROM system_settings")
    return {"settings": {r["key"]: {"value": r["value"], "description": r["description"]} for r in rows}}


@router.get("/models")
def get_models(admin: dict = Depends(require_admin)):
    from core.config import settings as cfg
    from services.embedding_service import get_embedding_service
    from services.reranker_service import get_reranker_service
    import os

    def dir_info(path):
        p = path if isinstance(path, os.PathLike) else path
        size = 0
        exists = False
        try:
            path_obj = path if hasattr(path, "exists") else __import__("pathlib").Path(path)
            exists = path_obj.exists()
            if exists and path_obj.is_dir():
                for f in path_obj.rglob("*"):
                    if f.is_file():
                        size += f.stat().st_size
            elif exists:
                size = path_obj.stat().st_size
        except OSError:
            pass
        return {"exists": exists, "size_mb": round(size / 1024 / 1024, 2)}

    return {
        "llm": {
            "model_name": cfg.llm_model_name,
            "model_path": str(cfg.model_abspath(cfg.get("llm.model_path", "models/llm"))),
            "server_url": cfg.llm_server_url,
            "context_size": cfg.llm_context_size,
            **dir_info(cfg.model_abspath(cfg.get("llm.model_path", "models/llm"))),
        },
        "embedding": {
            "backend": get_embedding_service().backend,
            "dimension": cfg.embedding_dim,
            "model_path": str(cfg.embedding_path),
            **dir_info(cfg.embedding_path),
        },
        "reranker": {
            "backend": get_reranker_service().backend,
            "model_path": str(cfg.reranker_path),
            **dir_info(cfg.reranker_path),
        },
    }
