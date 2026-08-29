"""Admin: user management."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import database as db
from core.dependencies import require_admin
from core.security import hash_password
from models.schemas import ResetPasswordRequest, UserCreate, UserUpdate
from services import audit_service, auth_service
from services.permission_service import permissions_for_user

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])


def _user_dict(row) -> dict:
    d = dict(row)
    d.pop("password_hash", None)
    d.pop("failed_login_count", None)
    d.pop("locked_until", None)
    d["permissions"] = permissions_for_user(d["id"], bool(d.get("is_superadmin")))
    roles = db.query_all(
        "SELECT r.id, r.name FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?",
        (d["id"],),
    )
    d["roles"] = [dict(r) for r in roles]
    if d.get("department_id"):
        dept = db.query_one("SELECT name FROM departments WHERE id=?", (d["department_id"],))
        d["department_name"] = dept["name"] if dept else None
    return d


@router.get("")
def list_users(
    page: int = 1,
    limit: int = 25,
    search: Optional[str] = None,
    department_id: Optional[str] = None,
    role: Optional[str] = None,
    status: Optional[str] = None,
    admin: dict = Depends(require_admin),
):
    clauses = []
    params: list = []
    if search:
        clauses.append("(name LIKE ? OR username LIKE ? OR email LIKE ?)")
        params.extend([f"%{search}%"] * 3)
    if department_id:
        clauses.append("department_id=?")
        params.append(department_id)
    if status == "active":
        clauses.append("is_active=1")
    elif status == "inactive":
        clauses.append("is_active=0")
    if role:
        clauses.append(
            "id IN (SELECT user_id FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.name=?)"
        )
        params.append(role)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    total = db.query_one(f"SELECT COUNT(*) AS c FROM users{where}", params)["c"]
    rows = db.query_all(
        f"SELECT * FROM users{where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [*params, limit, (page - 1) * limit],
    )
    return {
        "users": [_user_dict(r) for r in rows],
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.post("")
def create_user(payload: UserCreate, admin: dict = Depends(require_admin)):
    if db.query_one("SELECT 1 FROM users WHERE username=? OR email=?", (payload.username, payload.email)):
        raise HTTPException(400, "نام کاربری یا ایمیل تکراری است.")
    uid = db.insert_and_pk(
        "users",
        {
            "organization_id": admin.get("organization_id"),
            "department_id": payload.department_id,
            "username": payload.username,
            "email": payload.email,
            "name": payload.name,
            "password_hash": hash_password(payload.password),
            "is_active": 1,
        },
    )
    if payload.role_id:
        db.execute(
            "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
            (uid, payload.role_id),
        )
    audit_service.log(
        "admin.user_create", actor_id=admin["id"], resource_type="user",
        resource_id=uid, resource_name=payload.username,
    )
    return _user_dict(db.query_one("SELECT * FROM users WHERE id=?", (uid,)))


@router.get("/{user_id}")
def get_user(user_id: str, admin: dict = Depends(require_admin)):
    row = db.query_one("SELECT * FROM users WHERE id=?", (user_id,))
    if not row:
        raise HTTPException(404, "کاربر یافت نشد.")
    activity = db.query_all(
        "SELECT event_code, resource_type, created_at FROM audit_logs WHERE actor_id=? ORDER BY created_at DESC LIMIT 20",
        (user_id,),
    )
    return {"user": _user_dict(row), "activity": [dict(a) for a in activity]}


@router.patch("/{user_id}")
def update_user(user_id: str, payload: UserUpdate, admin: dict = Depends(require_admin)):
    if not db.query_one("SELECT 1 FROM users WHERE id=?", (user_id,)):
        raise HTTPException(404, "کاربر یافت نشد.")
    sets, params = [], []
    for field in ("name", "email", "department_id"):
        val = getattr(payload, field)
        if val is not None:
            sets.append(f"{field}=?")
            params.append(val)
    if payload.is_active is not None:
        sets.append("is_active=?")
        params.append(1 if payload.is_active else 0)
    if payload.role_id is not None:
        db.execute("DELETE FROM user_roles WHERE user_id=?", (user_id,))
        if payload.role_id:
            db.execute(
                "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
                (user_id, payload.role_id),
            )
    sets.append("updated_at=datetime('now')")
    params.append(user_id)
    db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=?", params)
    audit_service.log("admin.user_update", actor_id=admin["id"], resource_id=user_id)
    return _user_dict(db.query_one("SELECT * FROM users WHERE id=?", (user_id,)))


@router.delete("/{user_id}")
def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(400, "نمی‌توانید حساب خودتان را حذف کنید.")
    if not db.query_one("SELECT 1 FROM users WHERE id=?", (user_id,)):
        raise HTTPException(404, "کاربر یافت نشد.")
    db.execute("DELETE FROM users WHERE id=?", (user_id,))
    audit_service.log("admin.user_delete", actor_id=admin["id"], resource_id=user_id)
    return {"success": True}


@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: str, payload: ResetPasswordRequest, admin: dict = Depends(require_admin)
):
    if not db.query_one("SELECT 1 FROM users WHERE id=?", (user_id,)):
        raise HTTPException(404, "کاربر یافت نشد.")
    db.execute(
        "UPDATE users SET password_hash=?, failed_login_count=0, locked_until=NULL, updated_at=datetime('now') WHERE id=?",
        (hash_password(payload.new_password), user_id),
    )
    db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
    audit_service.log("admin.user_reset_password", actor_id=admin["id"], resource_id=user_id)
    return {"success": True}


@router.post("/{user_id}/toggle-status")
def toggle_status(user_id: str, admin: dict = Depends(require_admin)):
    row = db.query_one("SELECT is_active FROM users WHERE id=?", (user_id,))
    if not row:
        raise HTTPException(404, "کاربر یافت نشد.")
    new_status = 0 if row["is_active"] else 1
    db.execute("UPDATE users SET is_active=?, updated_at=datetime('now') WHERE id=?", (new_status, user_id))
    audit_service.log(
        "admin.user_toggle_status", actor_id=admin["id"], resource_id=user_id,
        metadata={"active": bool(new_status)},
    )
    return _user_dict(db.query_one("SELECT * FROM users WHERE id=?", (user_id,)))
