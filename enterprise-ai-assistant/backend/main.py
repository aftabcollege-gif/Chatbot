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
from fastapi.responses import FileResponse, JSONResponse
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schema and warm up AI services.
    init_db()
    get_embedding_service()
    get_reranker_service()
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
    app.mount(
        "/assets",
        StaticFiles(directory=str(_frontend_dist / "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        # Never shadow /api routes.
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        candidate = _frontend_dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
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
