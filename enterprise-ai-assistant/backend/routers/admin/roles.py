"""Admin: roles, permissions and resource-level permissions."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from core import database as db
from core.dependencies import require_admin
from models.schemas import ResourcePermissionUpdate, RoleCreate, RoleUpdate
from services import audit_service

router = APIRouter(prefix="/api/admin", tags=["admin-roles"])


def _role_row(role_id: str):
    return db.query_one("SELECT * FROM roles WHERE id=?", (role_id,))


@router.get("/roles")
def list_roles(admin: dict = Depends(require_admin)):
    rows = db.query_all("SELECT * FROM roles ORDER BY name")
    roles = []
    for r in rows:
        d = dict(r)
        perms = db.query_all(
            """SELECT p.code FROM role_permissions rp
               JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?""",
            (r["id"],),
        )
        d["permissions"] = [p["code"] for p in perms]
        roles.append(d)
    return {"roles": roles}


@router.post("/roles")
def create_role(payload: RoleCreate, admin: dict = Depends(require_admin)):
    rid = db.insert_and_pk(
        "roles",
        {
            "organization_id": admin.get("organization_id"),
            "name": payload.name,
            "description": payload.description,
        },
    )
    _set_permissions(rid, payload.permissions)
    audit_service.log("admin.role_create", actor_id=admin["id"], resource_id=rid, resource_name=payload.name)
    return dict(_role_row(rid))


@router.patch("/roles/{role_id}")
def update_role(role_id: str, payload: RoleUpdate, admin: dict = Depends(require_admin)):
    if not _role_row(role_id):
        raise HTTPException(404, "نقش یافت نشد.")
    sets, params = [], []
    if payload.name is not None:
        sets.append("name=?")
        params.append(payload.name)
    if payload.description is not None:
        sets.append("description=?")
        params.append(payload.description)
    if sets:
        params.append(role_id)
        db.execute(f"UPDATE roles SET {', '.join(sets)} WHERE id=?", params)
    if payload.permissions is not None:
        _set_permissions(role_id, payload.permissions)
    return dict(_role_row(role_id))


@router.delete("/roles/{role_id}")
def delete_role(role_id: str, admin: dict = Depends(require_admin)):
    row = _role_row(role_id)
    if not row:
        raise HTTPException(404, "نقش یافت نشد.")
    if row["is_system"]:
        raise HTTPException(400, "نقش سیستمی قابل حذف نیست.")
    db.execute("DELETE FROM roles WHERE id=?", (role_id,))
    return {"success": True}


def _set_permissions(role_id: str, codes: list[str]) -> None:
    db.execute("DELETE FROM role_permissions WHERE role_id=?", (role_id,))
    for code in codes:
        p = db.query_one("SELECT id FROM permissions WHERE code=?", (code,))
        if p:
            db.execute(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
                (role_id, p["id"]),
            )


@router.get("/permissions")
def list_permissions(admin: dict = Depends(require_admin)):
    return {"permissions": [dict(r) for r in db.query_all(
        "SELECT * FROM permissions ORDER BY code"
    )]}


@router.get("/permissions/resources/{resource_id}")
def resource_permissions(resource_id: str, admin: dict = Depends(require_admin)):
    rows = db.query_all(
        "SELECT * FROM resource_permissions WHERE resource_id=?", (resource_id,)
    )
    return {"permissions": [dict(r) for r in rows]}


@router.post("/permissions/resources/{resource_id}")
def set_resource_permissions(
    resource_id: str,
    payload: ResourcePermissionUpdate,
    admin: dict = Depends(require_admin),
):
    import json

    # Determine resource type from the document/knowledge/folder.
    rtype = "unknown"
    if db.query_one("SELECT 1 FROM documents WHERE id=?", (resource_id,)):
        rtype = "document"
    elif db.query_one("SELECT 1 FROM knowledge_items WHERE id=?", (resource_id,)):
        rtype = "knowledge"
    elif db.query_one("SELECT 1 FROM resource_folders WHERE id=?", (resource_id,)):
        rtype = "folder"

    db.execute(
        "DELETE FROM resource_permissions WHERE resource_id=?", (resource_id,)
    )
    db.insert_and_pk(
        "resource_permissions",
        {
            "resource_type": rtype,
            "resource_id": resource_id,
            "role_id": payload.role_id,
            "user_id": payload.user_id,
            "permissions": json.dumps(payload.permissions),
            "inherited": 1 if payload.inherit else 0,
        },
    )
    return {"success": True}
