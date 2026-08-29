"""Security primitives: password hashing (Argon2) and JWT tokens."""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from jose import JWTError, jwt

from .config import settings

_ALGORITHM = "HS256"
_ph = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, ValueError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _ph.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(
    user_id: str,
    extra_claims: Optional[Dict[str, Any]] = None,
    expires_minutes: Optional[int] = None,
) -> str:
    expire = _now() + timedelta(minutes=expires_minutes or settings.jwt_expiry_minutes)
    payload: Dict[str, Any] = {
        "sub": user_id,
        "type": "access",
        "iat": int(_now().timestamp()),
        "exp": expire,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.jwt_secret, algorithm=_ALGORITHM)


def create_refresh_token(user_id: str, expires_days: Optional[int] = None) -> str:
    expire = _now() + timedelta(days=expires_days or settings.jwt_refresh_days)
    payload = {
        "sub": user_id,
        "type": "refresh",
        "iat": int(_now().timestamp()),
        "exp": expire,
    }
    token = jwt.encode(payload, settings.jwt_refresh_secret, algorithm=_ALGORITHM)
    return token


def decode_token(token: str, refresh: bool = False) -> Dict[str, Any]:
    secret = settings.jwt_refresh_secret if refresh else settings.jwt_secret
    return jwt.decode(token, secret, algorithms=[_ALGORITHM])


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 401) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


__all__ = [
    "hash_password",
    "verify_password",
    "needs_rehash",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "hash_token",
    "AuthError",
    "JWTError",
]
