"""Authentication service: login, token issuance, session management."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from core import database as db
from core.config import settings
from core.security import (
    AuthError,
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_token,
    needs_rehash,
    verify_password,
)
from services import audit_service
from services.permission_service import permissions_for_user, user_roles


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def authenticate(username: str, password: str) -> Dict[str, Any]:
    user = db.query_one(
        "SELECT * FROM users WHERE username=? OR email=?", (username, username)
    )
    if not user:
        raise AuthError("نام کاربری یا رمز عبور اشتباه است.", status_code=401)

    locked_until = _parse_dt(user["locked_until"])
    if locked_until and locked_until > _now():
        raise AuthError("حساب کاربری موقتاً قفل است. بعداً تلاش کنید.", status_code=423)

    if not user["is_active"]:
        raise AuthError("حساب کاربری غیرفعال است.", status_code=403)

    if not verify_password(password, user["password_hash"]):
        failed = (user["failed_login_count"] or 0) + 1
        locked_until_val = None
        if failed >= settings.max_login_attempts:
            locked_until_val = (
                _now() + timedelta(minutes=settings.lockout_minutes)
            ).isoformat()
        db.execute(
            "UPDATE users SET failed_login_count=?, locked_until=? WHERE id=?",
            (failed, locked_until_val, user["id"]),
        )
        raise AuthError("نام کاربری یا رمز عبور اشتباه است.", status_code=401)

    # Successful login.
    if needs_rehash(user["password_hash"]):
        db.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (hash_password(password), user["id"]),
        )
    db.execute(
        "UPDATE users SET failed_login_count=0, locked_until=NULL, last_login=datetime('now') WHERE id=?",
        (user["id"],),
    )

    return _issue_tokens(dict(user))


def _issue_tokens(user: Dict[str, Any]) -> Dict[str, Any]:
    access = create_access_token(user["id"], {"name": user["name"], "username": user["username"]})
    refresh = create_refresh_token(user["id"])
    expires = _now() + timedelta(days=settings.jwt_refresh_days)
    db.execute(
        "INSERT INTO sessions (user_id, refresh_token_hash, expires_at) VALUES (?,?,?)",
        (user["id"], hash_token(refresh), expires.isoformat()),
    )
    perms = permissions_for_user(user["id"], bool(user.get("is_superadmin")))
    roles = user_roles(user["id"])
    audit_service.log(
        "auth.login",
        actor_id=user["id"],
        actor_name=user["name"],
        resource_type="user",
        resource_id=user["id"],
    )
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": settings.jwt_expiry_minutes * 60,
        "user": _user_profile(user, perms, roles),
    }


def _user_profile(user: Dict[str, Any], perms, roles) -> Dict[str, Any]:
    import json

    dept = None
    if user.get("department_id"):
        d = db.query_one("SELECT id, name FROM departments WHERE id=?", (user["department_id"],))
        if d:
            dept = {"id": d["id"], "name": d["name"]}
    org = None
    if user.get("organization_id"):
        o = db.query_one("SELECT id, name FROM organizations WHERE id=?", (user["organization_id"],))
        if o:
            org = {"id": o["id"], "name": o["name"]}
    prefs = {}
    try:
        prefs = json.loads(user.get("preferences") or "{}")
    except json.JSONDecodeError:
        prefs = {}
    return {
        "id": user["id"],
        "name": user["name"],
        "username": user["username"],
        "email": user["email"],
        "avatar_url": user.get("avatar_path"),
        "is_superadmin": bool(user.get("is_superadmin")),
        "roles": [r["name"] for r in roles],
        "department": dept,
        "organization": org,
        "permissions": perms,
        "preferences": prefs,
        "last_login": user.get("last_login"),
    }


def profile(user: Dict[str, Any]) -> Dict[str, Any]:
    perms = permissions_for_user(user["id"], bool(user.get("is_superadmin")))
    return _user_profile(user, perms, user_roles(user["id"]))


def refresh_tokens(refresh_token: str) -> Dict[str, Any]:
    from core.security import decode_token

    try:
        payload = decode_token(refresh_token, refresh=True)
    except Exception as exc:
        raise AuthError("توکن تجدید نامعتبر است.", status_code=401) from exc
    if payload.get("type") != "refresh":
        raise AuthError("نوع توکن اشتباه است.", status_code=401)

    token_hash = hash_token(refresh_token)
    session = db.query_one(
        "SELECT * FROM sessions WHERE refresh_token_hash=?", (token_hash,)
    )
    if not session:
        raise AuthError("نشست یافت نشد.", status_code=401)
    expires = _parse_dt(session["expires_at"])
    if expires and expires < _now():
        db.execute("DELETE FROM sessions WHERE id=?", (session["id"],))
        raise AuthError("توکن منقضی شده است.", status_code=401)

    user = db.query_one("SELECT * FROM users WHERE id=?", (payload["sub"],))
    if not user or not user["is_active"]:
        raise AuthError("کاربر مجاز نیست.", status_code=401)

    # Rotate refresh token.
    db.execute("DELETE FROM sessions WHERE id=?", (session["id"],))
    return _issue_tokens(dict(user))


def logout(refresh_token: Optional[str], access_user_id: str) -> None:
    if refresh_token:
        db.execute(
            "DELETE FROM sessions WHERE refresh_token_hash=?",
            (hash_token(refresh_token),),
        )
    audit_service.log(
        "auth.logout",
        actor_id=access_user_id,
        resource_type="user",
        resource_id=access_user_id,
    )


def change_password(user_id: str, current: str, new: str) -> None:
    user = db.query_one("SELECT * FROM users WHERE id=?", (user_id,))
    if not user or not verify_password(current, user["password_hash"]):
        raise AuthError("رمز عبور فعلی اشتباه است.", status_code=400)
    db.execute(
        "UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?",
        (hash_password(new), user_id),
    )
    db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
    audit_service.log(
        "auth.password_change", actor_id=user_id, resource_type="user", resource_id=user_id
    )
