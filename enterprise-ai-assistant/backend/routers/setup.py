"""First-run setup wizard endpoints."""
from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException

from core import bootstrap
from core import database as db
from core.security import hash_password
from models.schemas import AdminSetup, OrganizationSetup
from services import audit_service

router = APIRouter(prefix="/api/setup", tags=["setup"])


def _setup_completed() -> bool:
    row = db.query_one("SELECT completed FROM setup_status WHERE id=1")
    return bool(row and row["completed"])


@router.get("/bootstrap-info")
def bootstrap_info():
    """Credentials generated on first run, so the login page can show them.

    Only served on the loopback interface and only while the password has not
    been used yet (the file is deleted after the first successful login).
    """
    return bootstrap.bootstrap_info()


@router.post("/reset-admin")
def reset_admin():
    """Create or reset the super-admin account (offline recovery path).

    Disabled by default: it is a local-only recovery helper for support staff
    and for the standalone repair launcher, which sets
    ``EAI_ALLOW_ADMIN_RESET=1`` before starting the backend.
    """
    if os.environ.get("EAI_ALLOW_ADMIN_RESET") != "1":
        raise HTTPException(status_code=403, detail="این قابلیت غیرفعال است.")
    result = bootstrap.reset_credentials()
    return {
        "success": True,
        "username": result["username"],
        "password": result["password"],
        "created": result["created"],
    }


@router.get("/status")
def status():
    row = db.query_one("SELECT * FROM setup_status WHERE id=1")
    has_users = db.query_one("SELECT 1 FROM users WHERE is_superadmin=1 LIMIT 1")
    has_org = db.query_one("SELECT 1 FROM organizations LIMIT 1")
    step = 1
    if has_users:
        step = 2
    if has_org:
        step = 3
    if row and row["completed"]:
        step = 4
    return {
        "completed": bool(_setup_completed()),
        "current_step": (row["current_step"] if row else step),
        "step": step,
        "has_admin": bool(has_users),
        "has_organization": bool(has_org),
    }


@router.post("/admin")
def create_admin(payload: AdminSetup):
    if db.query_one("SELECT 1 FROM users WHERE is_superadmin=1 LIMIT 1"):
        # A bootstrap admin already exists (created automatically on first run
        # so the user is never locked out).  Treat the wizard as a password /
        # profile update instead of failing the whole setup.
        result = bootstrap.bootstrap_admin(
            username=payload.username.strip(), reset_password=True
        )
        db.execute("UPDATE setup_status SET current_step=2 WHERE id=1")
        audit_service.log("setup.admin_updated", actor_id=result["admin_id"], actor_name=payload.name)
        return {"success": True, "user_id": result["admin_id"], "updated": True}
    uid = db.insert_and_pk(
        "users",
        {
            "username": payload.username,
            "email": payload.email,
            "name": payload.name,
            "password_hash": hash_password(payload.password),
            "is_superadmin": 1,
            "is_active": 1,
        },
    )
    db.execute("UPDATE setup_status SET current_step=2 WHERE id=1")
    audit_service.log("setup.admin_created", actor_id=uid, actor_name=payload.name)
    return {"success": True, "user_id": uid}


@router.post("/organization")
def create_organization(payload: OrganizationSetup):
    admin = db.query_one("SELECT * FROM users WHERE is_superadmin=1 ORDER BY created_at LIMIT 1")
    if not admin:
        raise HTTPException(status_code=400, detail="ابتدا مدیر سیستم را ایجاد کنید.")
    org_id = db.query_one("SELECT id FROM organizations LIMIT 1")
    if org_id:
        raise HTTPException(status_code=400, detail="سازمان قبلاً ایجاد شده است.")

    oid = db.insert_and_pk(
        "organizations",
        {"name": payload.name, "description": payload.description or ""},
    )
    db.execute("UPDATE users SET organization_id=? WHERE id=?", (oid, admin["id"]))

    dept_ids = []
    for dept_name in payload.departments:
        dept_name = dept_name.strip()
        if dept_name:
            did = db.insert_and_pk(
                "departments",
                {"organization_id": oid, "name": dept_name},
            )
            dept_ids.append(did)
    if dept_ids:
        db.execute("UPDATE users SET department_id=? WHERE id=?", (dept_ids[0], admin["id"]))

    # Default "همکاران" role with all permissions.
    role_id = db.insert_and_pk(
        "roles",
        {"organization_id": oid, "name": "مدیر سیستم", "is_system": 1},
    )
    perm_rows = db.query_all("SELECT id FROM permissions")
    for p in perm_rows:
        db.execute(
            "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
            (role_id, p["id"]),
        )
    db.execute(
        "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
        (admin["id"], role_id),
    )

    db.execute("UPDATE setup_status SET current_step=3 WHERE id=1")
    audit_service.log("setup.organization_created", resource_type="organization", resource_id=oid)
    return {"success": True, "organization_id": oid, "department_ids": dept_ids}


@router.post("/complete")
def complete():
    if not db.query_one("SELECT 1 FROM users WHERE is_superadmin=1 LIMIT 1"):
        # Self-heal: never leave the user with an unusable installation.
        bootstrap.bootstrap_admin()
    if not db.query_one("SELECT 1 FROM organizations LIMIT 1"):
        raise HTTPException(status_code=400, detail="سازمان ایجاد نشده است.")
    db.execute(
        "UPDATE setup_status SET completed=1, current_step=4, completed_at=datetime('now') WHERE id=1"
    )
    audit_service.log("setup.completed")
    return {"success": True, "redirect": "/login"}
