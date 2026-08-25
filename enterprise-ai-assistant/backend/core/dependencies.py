"""FastAPI dependencies: authentication and authorization."""
from __future__ import annotations

from typing import Optional, Set

from fastapi import Depends, Header, HTTPException, status

from core import database as db
from core.security import AuthError, decode_token
from services.permission_service import permissions_for_user


def _extract_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise AuthError("توکن احراز هویت ارسال نشده است.")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AuthError("قالب توکن نامعتبر است.")
    return parts[1]


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    try:
        token = _extract_token(authorization)
        payload = decode_token(token)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="توکن نامعتبر یا منقضی است."
        )

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="نوع توکن نامعتبر است.")

    user = db.query_one("SELECT * FROM users WHERE id=?", (payload.get("sub"),))
    if not user:
        raise HTTPException(status_code=401, detail="کاربر یافت نشد.")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="حساب کاربری غیرفعال است.")

    u = dict(user)
    u["permissions"] = permissions_for_user(u["id"], bool(u.get("is_superadmin")))
    return u


def require_permission(code: str):
    def _dep(user: dict = Depends(get_current_user)) -> dict:
        perms: Set[str] = set(user.get("permissions") or [])
        if user.get("is_superadmin") or code in perms:
            return user
        raise HTTPException(status_code=403, detail="دسترسی مجاز نیست.")

    return _dep


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_superadmin") and "admin.users" not in (user.get("permissions") or []):
        raise HTTPException(status_code=403, detail="دسترسی مدیر لازم است.")
    return user
