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
    """Model/engine status for the admin "models" page.

    Besides the resolved path, report *where* the app looked and how many files
    it found, because "بارگذاری نشده" with no explanation is what users hit when
    the installation root is not where the backend expects it.
    """
    from pathlib import Path

    from core.config import settings as cfg
    from services.embedding_service import get_embedding_service
    from services.reranker_service import get_reranker_service

    def dir_info(path) -> dict:
        path_obj = Path(path) if not hasattr(path, "exists") else path
        size = 0
        files = 0
        exists = False
        try:
            exists = path_obj.exists()
            if exists and path_obj.is_dir():
                for f in path_obj.rglob("*"):
                    if f.is_file():
                        size += f.stat().st_size
                        files += 1
            elif exists:
                size = path_obj.stat().st_size
                files = 1
        except OSError:
            pass
        return {
            "exists": exists,
            "size_mb": round(size / 1024 / 1024, 2),
            "files": files,
        }

    def candidates(rel: str) -> list:
        return [str(root / rel) for root in cfg._asset_roots()]

    def entry(rel: str, extra: dict | None = None, patterns: tuple = ()) -> dict:
        resolved = cfg.model_abspath(rel)

        # "Not found" used to mean "the folder path in config/default.yaml does
        # not exist", even when the models were sitting right there under a
        # different file/folder name.  Look for the real artefacts first.
        if not resolved.exists() and patterns:
            for root in cfg._asset_roots():
                try:
                    for pattern in patterns:
                        hits = sorted(p for p in root.glob(pattern) if p.exists())
                        if hits:
                            resolved = hits[0]
                            break
                except (OSError, ValueError):
                    continue
                if resolved.exists() and resolved != cfg.model_abspath(rel):
                    break

        info = dir_info(resolved)
        data = {
            "model_path": str(resolved),
            "searched": candidates(rel),
            **info,
        }
        if extra:
            data.update(extra)
        return data

    def _inventory(cfg) -> dict:
        """What model files actually exist, wherever they are."""
        found: dict = {}
        for label, patterns in (
            ("llm", ("models/**/*.gguf", "llm/*.gguf", "*.gguf")),
            ("embedding", ("models/**/*.onnx", "models/**/*.bin", "**/*.onnx")),
        ):
            hits = []
            for root in cfg._asset_roots():
                try:
                    for pattern in patterns:
                        for path in sorted(root.glob(pattern)):
                            if path.is_file() and path.stat().st_size > 1024:
                                if str(path) not in hits:
                                    hits.append(str(path))
                except (OSError, ValueError):
                    continue
            found[label] = hits[:12]
        return found

    llm_rel = cfg.get("llm.model_path", "models/llm")
    llm_server_ok = False
    try:
        import httpx

        llm_server_ok = httpx.get(f"{cfg.llm_server_url}/models", timeout=2.0).status_code == 200
    except Exception:
        llm_server_ok = False

    return {
        "llm": entry(
            llm_rel,
            patterns=("models/llm/*.gguf", "llm/*.gguf", "models/*.gguf"),
            extra={
                "model_name": cfg.llm_model_name,
                "server_url": cfg.llm_server_url,
                "server_ok": llm_server_ok,
                "context_size": cfg.llm_context_size,
            },
        ),
        "embedding": entry(
            cfg.get("embedding.model_path", "models/embedding"),
            patterns=("models/embedding/*.onnx", "models/embedding/*.bin"),
            extra={
                "backend": get_embedding_service().backend,
                "dimension": cfg.embedding_dim,
            },
        ),
        "reranker": entry(
            cfg.get("reranker.model_path", "models/reranker"),
            patterns=("models/reranker/*.onnx", "models/reranker/*.bin"),
            extra={
                "backend": get_reranker_service().backend,
            },
        ),
        "asset_roots": [str(root) for root in cfg._asset_roots()],
        "found": _inventory(cfg),
    }
