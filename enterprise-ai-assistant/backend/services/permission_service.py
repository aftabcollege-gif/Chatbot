"""Role-based permission helpers."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from core import database as db


def permissions_for_user(user_id: str, is_superadmin: bool = False) -> List[str]:
    if is_superadmin:
        rows = db.query_all("SELECT code FROM permissions")
        return [r["code"] for r in rows]
    rows = db.query_all(
        """SELECT DISTINCT p.code
           FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id
           WHERE ur.user_id = ?""",
        (user_id,),
    )
    return [r["code"] for r in rows]


def has_permission(user: Dict[str, Any], code: str) -> bool:
    if user.get("is_superadmin"):
        return True
    return code in (user.get("permissions") or [])


def user_roles(user_id: str) -> List[Dict[str, Any]]:
    rows = db.query_all(
        """SELECT r.* FROM roles r
           JOIN user_roles ur ON ur.role_id = r.id
           WHERE ur.user_id = ?""",
        (user_id,),
    )
    return [dict(r) for r in rows]


def can_access_document(user: Dict[str, Any], doc: Dict[str, Any]) -> bool:
    if user.get("is_superadmin"):
        return True
    vis = doc.get("visibility")
    if vis == "public":
        return True
    if vis == "private":
        return doc.get("owner_id") == user["id"]
    if vis in ("department", "org", "organization"):
        if doc.get("organization_id") and doc.get("organization_id") != user.get("organization_id"):
            return False
        if vis == "department":
            return doc.get("department_id") == user.get("department_id")
        return True
    return False
