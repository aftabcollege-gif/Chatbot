"""Security primitives: password hashing (Argon2) and JWT tokens."""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from jose import JWTError, jwt

from .config import settings

_ALGORITHM = "HS256"

# --- Password hashing -------------------------------------------------------
# Argon2id is the primary algorithm.  Some frozen/offline environments ship
# without the argon2 CFFI binding; instead of refusing to start (or, worse,
# creating an account nobody can log into) we fall back to PBKDF2-HMAC-SHA256
# from the standard library.  Both formats are always *verifiable*, so
# databases written by one build can be opened by the other.
_PBKDF2_PREFIX = "$pbkdf2-sha256$"
_PBKDF2_ROUNDS = 260000

try:  # pragma: no cover - depends on the runtime environment
    from argon2 import PasswordHasher
    from argon2.exceptions import InvalidHashError, VerifyMismatchError

    _ph = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)
    _ARGON2 = True
except Exception:  # pragma: no cover
    _ph = None
    _ARGON2 = False

    class InvalidHashError(Exception):  # type: ignore[no-redef]
        pass

    class VerifyMismatchError(Exception):  # type: ignore[no-redef]
        pass


def argon2_available() -> bool:
    return _ARGON2


def _pbkdf2_hash(password: str, rounds: int = _PBKDF2_ROUNDS) -> str:
    import base64
    import hashlib
    import os as _os

    salt = _os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)
    return "{}{}${}${}".format(
        _PBKDF2_PREFIX,
        rounds,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def _pbkdf2_verify(password: str, password_hash: str) -> bool:
    import base64
    import hashlib
    import hmac

    try:
        _, rounds, salt_b64, digest_b64 = password_hash.split("$", 3)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def hash_password(password: str) -> str:
    if _ph is not None:
        return _ph.hash(password)
    return _pbkdf2_hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    if password_hash.startswith(_PBKDF2_PREFIX):
        return _pbkdf2_verify(password, password_hash)
    if _ph is None:
        return False
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, ValueError):
        return False
    except Exception:
        return False


def needs_rehash(password_hash: str) -> bool:
    if password_hash.startswith(_PBKDF2_PREFIX):
        return _ARGON2  # upgrade to argon2 as soon as the binding is available
    if _ph is None:
        return False
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
    "argon2_available",
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
