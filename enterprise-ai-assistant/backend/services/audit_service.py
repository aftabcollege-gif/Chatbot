"""Audit logging service."""
from __future__ import annotations

import json
from typing import Any, Dict, Optional

from core import database as db


def log(
    event_code: str,
    actor_id: Optional[str] = None,
    actor_name: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    resource_name: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    db.execute(
        """INSERT INTO audit_logs
           (event_code, actor_id, actor_name, resource_type, resource_id, resource_name, metadata)
           VALUES (?,?,?,?,?,?,?)""",
        (
            event_code,
            actor_id,
            actor_name,
            resource_type,
            resource_id,
            resource_name,
            json.dumps(metadata or {}, ensure_ascii=False),
        ),
    )
