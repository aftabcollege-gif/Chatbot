"""Enterprise AI Assistant — embedded backend API server.

Run directly:  python main.py
The desktop shell (Tauri) launches this executable on 127.0.0.1:8741 and serves
the built frontend from /frontend/dist at the root.
"""
from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

# Ensure the backend package root is importable when frozen / run directly.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.config import settings  # noqa: E402
from core import database as db  # noqa: E402
from core.database import init_db  # noqa: E402
from routers import auth, chat, knowledge, profile, resources, search, setup  # noqa: E402
from routers.admin import (  # noqa: E402
    analytics,
    health as health_router,
    logs,
    roles,
    settings as settings_router,
    users,
    web_sources,
)
from services.embedding_service import get_embedding_service  # noqa: E402
from services.reranker_service import get_reranker_service  # noqa: E402


def _first_run_bootstrap() -> None:
    """Guarantee that a usable admin account exists before the UI opens.

    Without this the packaged application showed a login page with no account
    behind it and no link to the setup wizard — the classic "initial login"
    dead end.
    """
    from core import bootstrap

    try:
        info = bootstrap.bootstrap_info()
        if not info.get("has_admin"):
            result = bootstrap.bootstrap_admin()
            print(
                "[bootstrap] حساب مدیر ساخته شد  |  "
                f"username={result['username']}  password={result['password']}"
            )
            print(f"[bootstrap] credentials file: {bootstrap.credentials_path()}")
        else:
            print("[bootstrap] admin account already present")
    except Exception as exc:  # pragma: no cover - never block startup
        print(f"[bootstrap] skipped: {exc!r}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
    except Exception as exc:  # pragma: no cover
        print(f"[startup] database init failed: {exc!r}")
    _first_run_bootstrap()
    # Documents left mid-processing by a previous session would otherwise stay
    # "in progress" forever on the resources page.
    try:
        from workers.document_processor import requeue_unfinished

        count = requeue_unfinished(log=lambda message: print(message, flush=True))
        if count:
            print(f"[startup] requeued {count} unfinished document(s)")
    except Exception as exc:  # pragma: no cover - never block startup
        print(f"[startup] document requeue skipped: {exc!r}")
    # Warm up AI services (never fatal).
    try:
        get_embedding_service()
    except Exception as exc:  # pragma: no cover
        print(f"[startup] embedding service unavailable: {exc!r}")
    try:
        get_reranker_service()
    except Exception as exc:  # pragma: no cover
        print(f"[startup] reranker unavailable: {exc!r}")
    print(
        f"[startup] vector backend: {db.vec_backend()} "
        f"(sqlite-vec path: {db.vec_loaded_path() or '-'})"
    )
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)

# The frontend is served from the same origin (localhost:8741) by the desktop
# shell; CORS is still enabled narrowly for dev convenience.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8741",
        "http://localhost:8741",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers.
app.include_router(health_router.router)
app.include_router(auth.router)
app.include_router(setup.router)
app.include_router(chat.router)
app.include_router(resources.router)
app.include_router(knowledge.router)
app.include_router(search.router)
app.include_router(profile.router)
app.include_router(users.router)
app.include_router(roles.router)
app.include_router(web_sources.router)
app.include_router(logs.router)
app.include_router(settings_router.router)
app.include_router(analytics.router)


def _setup_done() -> bool:
    try:
        row = db.query_one("SELECT completed FROM setup_status WHERE id=1")
        return bool(row and row["completed"])
    except Exception:
        return True


@app.get("/api/diagnostics", include_in_schema=False)
async def diagnostics():
    """Offline support endpoint: shows what the packaged app resolved."""
    return {
        "version": settings.app_version,
        "frozen": bool(getattr(sys, "frozen", False)),
        "root": str(settings.root),
        "appdata": str(settings.appdata),
        "db_path": str(settings.db_path),
        "db_exists": settings.db_path.exists(),
        "frontend_dist": str(_frontend_dist),
        "frontend_found": _frontend_dist.exists(),
        "models": str(settings.model_abspath("models")),
        "models_found": settings.model_abspath("models").exists(),
        "extensions_dir": str(settings.extensions_dir),
        "vector_backend": db.vec_backend(),
        "vector_available": db.vec_available(),
        "vector_load_error": db.vec_load_error(),
        "vector_loaded_path": db.vec_loaded_path(),
        "embedding_backend": get_embedding_service().backend,
        "setup_completed": _setup_done(),
        "has_admin": db.query_one("SELECT 1 FROM users WHERE is_superadmin=1 LIMIT 1") is not None,
    }


@app.exception_handler(Exception)
async def unhandled_handler(request, exc):  # pragma: no cover
    import traceback

    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": f"خطای داخلی: {exc}"})


# --------------------------------------------------------------------------- #
# Static frontend (production build served by the API server itself).
# --------------------------------------------------------------------------- #
_frontend_dist = settings.frontend_dist
if _frontend_dist.exists():
    # Mount the Vite assets directory only when it exists: a missing/partial
    # frontend build must not prevent the API (and the login screen) from
    # starting.
    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        # Never shadow /api routes.
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        candidate = _frontend_dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        # First run: send the user straight to the setup wizard instead of a
        # login page they cannot possibly pass.
        if full_path in ("", "index.html", "login") and not _setup_done():
            return RedirectResponse(url="/setup", status_code=307)
        return FileResponse(str(_frontend_dist / "index.html"))
else:
    @app.get("/", include_in_schema=False)
    async def root_dev():
        return {
            "name": settings.app_name,
            "version": settings.app_version,
            "status": "backend running (frontend not built)",
            "docs": "see /api/health",
        }


def main() -> None:
    import uvicorn

    # When bundled, stdout/stderr should still be visible for logs.
    host = settings.host
    port = settings.port
    # Validate port is free.
    import socket

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, port))
    except OSError:
        print(f"[fatal] Port {port} is already in use.")
        sys.exit(2)
    finally:
        sock.close()

    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
