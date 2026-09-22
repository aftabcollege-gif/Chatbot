"""First-run bootstrap: guarantees that somebody can always log in.

Historically the packaged application opened straight on the login page while
no account existed yet, and the setup wizard was only reachable by typing
``/setup`` manually — which is exactly why users ended up locked out of their
own offline installation ("initial login / admin credentials" problem).

Two things happen here:

* :func:`bootstrap_admin` creates a super-admin with a **generated** username
  and password when the database does not have one yet, unlocks it if it was
  locked by failed logins, and writes the credentials to a plain text file the
  user can open (and to the application log).
* :func:`bootstrap_info` exposes those still-unused credentials to the local UI
  so the login page can show them once, next to a copy button.

The credentials file is deleted automatically after the first successful
login, so the password stops being discoverable as soon as it is in use.
"""
from __future__ import annotations

import json
import os
import secrets
import sqlite3
import string
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from .config import settings

# Letters/digits that are hard to confuse when typed by hand.
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
DEFAULT_USERNAME = "admin"
CREDENTIALS_FILENAME = "ADMIN-CREDENTIALS.txt"


def credentials_path() -> Path:
    return settings.appdata / CREDENTIALS_FILENAME


def generate_password(length: int = 10) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def generate_username() -> str:
    return DEFAULT_USERNAME


def _write_credentials_file(username: str, password: str, created: bool) -> None:
    path = credentials_path()
    action = "ساخت" if created else "بازنشانی"
    body = f"""دستیار هوشمند سازمانی — اطلاعات ورود مدیر سیستم
=================================================

  نام کاربری : {username}
  رمز عبور   : {password}

این حساب در تاریخ {datetime.now().strftime('%Y-%m-%d %H:%M')} توسط برنامه ({action}) ساخته/تنظیم شده است.

راهنمای ورود
------------
1. برنامه را اجرا کنید.
2. همین نام کاربری و رمز عبور را در صفحهٔ ورود وارد کنید.
3. برای تغییر رمز: منوی «پروفایل» ← «تغییر رمز عبور».

توجه
----
* این فایل پس از نخستین ورود موفق به‌صورت خودکار حذف می‌شود.
* اگر این فایل را نمی‌خواهید، پس از یادداشت کردن رمز، آن را پاک کنید.
"""
    try:
        path.write_text(body, encoding="utf-8")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except OSError:
        pass
    # A second copy on the Desktop is easier to find for non-technical users.
    try:
        desktop = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop"
        if desktop.is_dir():
            (desktop / CREDENTIALS_FILENAME).write_text(body, encoding="utf-8")
    except OSError:
        pass


def clear_credentials_file() -> None:
    for path in (
        credentials_path(),
        Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop" / CREDENTIALS_FILENAME,
    ):
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass


def _hash_password(password: str) -> str:
    from .security import hash_password

    return hash_password(password)


def _ensure_roles_and_permissions(conn: sqlite3.Connection, org_id: Optional[str]) -> str:
    """Make sure a role with every permission exists and return its id."""
    row = conn.execute(
        "SELECT id FROM roles WHERE name IN ('مدیر سیستم','SUPER_ADMIN','admin') ORDER BY is_system DESC LIMIT 1"
    ).fetchone()
    if row is None:
        cur = conn.execute(
            "INSERT INTO roles (organization_id, name, description, is_system) VALUES (?,?,?,1)",
            (org_id, "مدیر سیستم", "مدیر ارشد سیستم"),
        )
        role_id = conn.execute("SELECT id FROM roles WHERE rowid=?", (cur.lastrowid,)).fetchone()[0]
    else:
        role_id = row[0]
    for perm in conn.execute("SELECT id FROM permissions").fetchall():
        conn.execute(
            "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?,?)",
            (role_id, perm[0]),
        )
    return str(role_id)


def _ensure_organization(conn: sqlite3.Connection) -> Tuple[str, Optional[str]]:
    row = conn.execute("SELECT id FROM organizations ORDER BY created_at LIMIT 1").fetchone()
    if row is not None:
        org_id = row[0]
    else:
        cur = conn.execute(
            "INSERT INTO organizations (name, description) VALUES (?,?)",
            ("سازمان من", "سازمان پیش‌فرض که در نخستین اجرا ساخته شد"),
        )
        org_id = conn.execute(
            "SELECT id FROM organizations WHERE rowid=?", (cur.lastrowid,)
        ).fetchone()[0]
    dept = conn.execute(
        "SELECT id FROM departments WHERE organization_id=? LIMIT 1", (org_id,)
    ).fetchone()
    dept_id = dept[0] if dept else None
    if dept_id is None:
        cur = conn.execute(
            "INSERT INTO departments (organization_id, name) VALUES (?,?)",
            (org_id, "واحد مرکزی"),
        )
        dept_id = conn.execute(
            "SELECT id FROM departments WHERE rowid=?", (cur.lastrowid,)
        ).fetchone()[0]
    return str(org_id), (str(dept_id) if dept_id else None)


def _finish_setup(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT OR IGNORE INTO setup_status (id, completed, current_step) VALUES (1,0,1)")
    conn.execute(
        "UPDATE setup_status SET completed=1, current_step=4, completed_at=datetime('now') WHERE id=1"
    )


def find_superadmin(conn: sqlite3.Connection) -> Optional[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM users WHERE is_superadmin=1 ORDER BY created_at LIMIT 1"
    ).fetchone()


def bootstrap_admin(
    username: Optional[str] = None,
    password: Optional[str] = None,
    reset_password: bool = True,
) -> Dict[str, Any]:
    """Ensure a usable super-admin account exists.

    Returns a dict: ``{created, username, password, admin_id}``.  ``password``
    is ``None`` when an existing account was kept untouched.
    """
    from .database import get_conn, init_db

    init_db()
    conn = get_conn()
    existing = find_superadmin(conn)
    created = existing is None

    if existing is not None and not reset_password:
        # Only make sure the account can actually be used.
        conn.execute(
            "UPDATE users SET is_active=1, failed_login_count=0, locked_until=NULL WHERE id=?",
            (existing["id"],),
        )
        return {
            "created": False,
            "username": existing["username"],
            "password": None,
            "admin_id": existing["id"],
        }

    org_id, dept_id = _ensure_organization(conn)
    role_id = _ensure_roles_and_permissions(conn, org_id)

    new_username = (username or (existing["username"] if existing else None) or generate_username()).strip()
    new_password = password or generate_password()
    password_hash = _hash_password(new_password)

    if existing is None:
        email = f"{new_username}@local"
        cur = conn.execute(
            """INSERT INTO users
               (organization_id, department_id, username, email, name, password_hash,
                is_active, is_superadmin, failed_login_count, locked_until, preferences)
               VALUES (?,?,?,?,?,?,1,1,0,NULL,?)""",
            (
                org_id,
                dept_id,
                new_username,
                email,
                "مدیر سیستم",
                password_hash,
                json.dumps({"theme": "dark", "language": "fa", "calendar": "jalali"}, ensure_ascii=False),
            ),
        )
        admin_id = conn.execute("SELECT id FROM users WHERE rowid=?", (cur.lastrowid,)).fetchone()[0]
    else:
        admin_id = existing["id"]
        conn.execute(
            """UPDATE users
                  SET password_hash=?, is_active=1, is_superadmin=1,
                      failed_login_count=0, locked_until=NULL,
                      organization_id=COALESCE(organization_id, ?),
                      department_id=COALESCE(department_id, ?)
                WHERE id=?""",
            (password_hash, org_id, dept_id, admin_id),
        )
        new_username = existing["username"]

    conn.execute(
        "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?,?)",
        (admin_id, role_id),
    )
    _finish_setup(conn)
    _write_credentials_file(new_username, new_password, created)

    try:  # never fail the bootstrap because of auditing
        conn.execute(
            """INSERT INTO audit_logs (event_code, actor_id, actor_name, resource_type,
                                       resource_id, metadata)
               VALUES (?,?,?,?,?,?)""",
            (
                "setup.bootstrap_admin",
                admin_id,
                "مدیر سیستم",
                "user",
                str(admin_id),
                json.dumps({"created": created, "username": new_username}, ensure_ascii=False),
            ),
        )
    except sqlite3.Error:
        pass

    return {
        "created": created,
        "username": new_username,
        "password": new_password,
        "admin_id": admin_id,
    }


def has_admin() -> bool:
    from .database import get_conn, init_db

    try:
        init_db()
        return find_superadmin(get_conn()) is not None
    except sqlite3.Error:
        return False


def bootstrap_info() -> Dict[str, Any]:
    """State used by the login screen (never exposes an in-use password)."""
    info: Dict[str, Any] = {"has_admin": False, "setup_completed": False, "credentials": None}
    try:
        from .database import get_conn, init_db

        init_db()
        conn = get_conn()
        info["has_admin"] = find_superadmin(conn) is not None
        row = conn.execute("SELECT completed FROM setup_status WHERE id=1").fetchone()
        info["setup_completed"] = bool(row and row[0])
    except sqlite3.Error:
        return info

    path = credentials_path()
    if path.is_file():
        parsed = _parse_credentials_file(path)
        if parsed:
            info["credentials"] = parsed
    return info


def _parse_credentials_file(path: Path) -> Optional[Dict[str, str]]:
    try:
        username = password = ""
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("نام کاربری") and ":" in stripped:
                username = stripped.split(":", 1)[1].strip()
            elif stripped.startswith("رمز عبور") and ":" in stripped:
                password = stripped.split(":", 1)[1].strip()
        if username and password:
            return {"username": username, "password": password}
    except OSError:
        pass
    return None


def reset_credentials(username: Optional[str] = None) -> Dict[str, Any]:
    """Force a fresh password for the super-admin (repair / support path)."""
    return bootstrap_admin(username=username, reset_password=True)


__all__ = [
    "bootstrap_admin",
    "bootstrap_info",
    "reset_credentials",
    "has_admin",
    "credentials_path",
    "clear_credentials_file",
    "generate_password",
    "generate_username",
    "CREDENTIALS_FILENAME",
]
