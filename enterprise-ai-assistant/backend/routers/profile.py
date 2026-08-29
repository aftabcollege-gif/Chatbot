"""User profile endpoints."""
from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from core import database as db
from core.config import settings
from core.dependencies import get_current_user
from models.schemas import ProfileUpdate
from services import audit_service, auth_service

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("")
def profile(user: dict = Depends(get_current_user)):
    def scalar(sql, *params):
        r = db.query_one(sql, params)
        return int(r[0]) if r else 0

    stats = {
        "conversations": scalar(
            "SELECT COUNT(*) FROM conversations WHERE user_id=?", user["id"]
        ),
        "messages": scalar(
            """SELECT COUNT(*) FROM messages m JOIN conversations c
               ON c.id=m.conversation_id WHERE c.user_id=? AND m.role='user'""",
            user["id"],
        ),
        "documents_uploaded": scalar(
            "SELECT COUNT(*) FROM documents WHERE owner_id=?", user["id"]
        ),
        "knowledge_items": scalar(
            "SELECT COUNT(*) FROM knowledge_items WHERE owner_id=?", user["id"]
        ),
    }
    return {"user": auth_service.profile(user), "stats": stats}


@router.patch("")
def update_profile(
    payload: ProfileUpdate, user: dict = Depends(get_current_user)
):
    sets, params = [], []
    if payload.name is not None:
        sets.append("name=?")
        params.append(payload.name)
    if payload.preferences is not None:
        current = {}
        row = db.query_one("SELECT preferences FROM users WHERE id=?", (user["id"],))
        try:
            current = json.loads(row["preferences"]) if row and row["preferences"] else {}
        except json.JSONDecodeError:
            current = {}
        current.update(payload.preferences)
        sets.append("preferences=?")
        params.append(json.dumps(current, ensure_ascii=False))
    if not sets:
        return {"user": auth_service.profile(user)}
    sets.append("updated_at=datetime('now')")
    params.append(user["id"])
    db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=?", params)
    audit_service.log("profile.update", actor_id=user["id"])
    return {"user": auth_service.profile(
        dict(db.query_one("SELECT * FROM users WHERE id=?", (user["id"],)))
    )}


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...), user: dict = Depends(get_current_user)
):
    allowed = {"image/png", "image/jpeg", "image/webp", "image/gif"}
    if file.content_type not in allowed:
        raise HTTPException(400, "فقط تصویر مجاز است.")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "حداکثر حجم ۵ مگابایت.")
    ext = ".png" if file.content_type == "image/png" else ".jpg"
    avatars_dir = settings.storage_path / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{user['id']}-{uuid.uuid4().hex[:8]}{ext}"
    path = avatars_dir / fname
    with open(path, "wb") as out:
        out.write(data)
    db.execute(
        "UPDATE users SET avatar_path=?, updated_at=datetime('now') WHERE id=?",
        (str(path), user["id"]),
    )
    return {"avatar_url": f"/api/profile/avatar/{fname}"}


@router.get("/avatar/{name}")
def get_avatar(name: str):
    from fastapi.responses import FileResponse

    path = settings.storage_path / "avatars" / name
    if not path.exists():
        raise HTTPException(404, "یافت نشد.")
    return FileResponse(path)
