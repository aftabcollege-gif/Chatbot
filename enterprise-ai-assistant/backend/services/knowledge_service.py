"""Knowledge-base service with embedding indexing."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from core import database as db
from services.embedding_service import get_embedding_service
from services.normalizer_service import normalize_for_index


def _index_knowledge_vector(item_id: str) -> None:
    row = db.query_one("SELECT * FROM knowledge_items WHERE id=?", (item_id,))
    if not row or not db.vec_available():
        return
    text = " ".join(
        filter(
            None,
            [
                row["title"],
                row["problem_description"],
                row["action_taken"],
                row["lesson_learned"],
                row["suggestion"],
            ],
        )
    )
    vec = get_embedding_service().embed_one(normalize_for_index(text))
    db.execute("DELETE FROM knowledge_vec WHERE knowledge_id=?", (item_id,))
    db.execute(
        "INSERT INTO knowledge_vec (knowledge_id, embedding) VALUES (?, ?)",
        (item_id, get_embedding_service().to_blob(vec)),
    )


def create_knowledge(data: dict, user: dict) -> dict:
    kid = db.insert_and_pk(
        "knowledge_items",
        {
            "organization_id": user.get("organization_id"),
            "department_id": data.get("department_id"),
            "owner_id": user["id"],
            "title": data["title"],
            "subject": data.get("subject"),
            "problem_description": data["problem_description"],
            "action_taken": data["action_taken"],
            "result": data.get("result"),
            "lesson_learned": data["lesson_learned"],
            "suggestion": data.get("suggestion"),
            "visibility": data.get("visibility", "department"),
            "status": "DRAFT",
        },
    )
    for tag in data.get("tags", []):
        tag = tag.strip()
        if tag:
            db.execute(
                "INSERT OR IGNORE INTO knowledge_tags (knowledge_id, tag) VALUES (?, ?)",
                (kid, tag),
            )
    return get_knowledge(kid, user)


def get_knowledge(kid: str, user: dict) -> dict:
    row = db.query_one("SELECT * FROM knowledge_items WHERE id=?", (kid,))
    if not row:
        raise KeyError("یافت نشد.")
    item = dict(row)
    tags = [r["tag"] for r in db.query_all(
        "SELECT tag FROM knowledge_tags WHERE knowledge_id=?", (kid,)
    )]
    item["tags"] = tags
    owner = db.query_one("SELECT name, avatar_path FROM users WHERE id=?", (item["owner_id"],))
    item["owner"] = dict(owner) if owner else None
    return item


def update_knowledge(kid: str, data: dict, user: dict) -> dict:
    fields = [
        "title", "subject", "department_id", "problem_description", "action_taken",
        "result", "lesson_learned", "suggestion", "visibility",
    ]
    sets, params = [], []
    for f in fields:
        if data.get(f) is not None:
            sets.append(f"{f}=?")
            params.append(data[f])
    if sets:
        sets.append("updated_at=datetime('now')")
        params.append(kid)
        db.execute(f"UPDATE knowledge_items SET {', '.join(sets)} WHERE id=?", params)
    if data.get("tags") is not None:
        db.execute("DELETE FROM knowledge_tags WHERE knowledge_id=?", (kid,))
        for tag in data["tags"]:
            tag = tag.strip()
            if tag:
                db.execute(
                    "INSERT OR IGNORE INTO knowledge_tags (knowledge_id, tag) VALUES (?, ?)",
                    (kid, tag),
                )
    # Re-index if the item is published.
    item = db.query_one("SELECT status FROM knowledge_items WHERE id=?", (kid,))
    if item and item["status"] == "PUBLISHED":
        _index_knowledge_vector(kid)
    return get_knowledge(kid, user)


def set_status(kid: str, status: str, user: dict, comment: Optional[str] = None) -> dict:
    updates = ["status=?", "updated_at=datetime('now')"]
    params: List[Any] = [status]
    if status == "PUBLISHED":
        updates.append("published_at=datetime('now')")
        updates.append("approved_by=?")
        updates.append("approved_at=datetime('now')")
        params.extend([user["id"]])
    elif status == "UNDER_REVIEW":
        updates.append("reviewed_by=?")
        updates.append("reviewed_at=datetime('now')")
        params.append(user["id"])
    params.append(kid)
    db.execute(f"UPDATE knowledge_items SET {', '.join(updates)} WHERE id=?", params)
    if status == "PUBLISHED":
        _index_knowledge_vector(kid)
    return get_knowledge(kid, user)


def list_knowledge(
    user: dict,
    status: Optional[str] = None,
    department_id: Optional[str] = None,
    tag: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    clauses = []
    params: List[Any] = []
    if status:
        clauses.append("ki.status=?")
        params.append(status)
    if department_id:
        clauses.append("ki.department_id=?")
        params.append(department_id)
    if tag:
        clauses.append(
            "ki.id IN (SELECT knowledge_id FROM knowledge_tags WHERE tag=?)"
        )
        params.append(tag)
    if search:
        clauses.append("(ki.title LIKE ? OR ki.lesson_learned LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    # Access: superadmin sees all; others see public + their dept + own.
    if not user.get("is_superadmin"):
        clauses.append(
            "(ki.visibility='public' OR ki.owner_id=? OR "
            "(ki.visibility='department' AND ki.department_id=?) OR "
            "(ki.visibility IN ('org','organization') AND ki.organization_id=?))"
        )
        params.extend([user["id"], user.get("department_id"), user.get("organization_id")])

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    total = db.query_one(f"SELECT COUNT(*) AS c FROM knowledge_items ki{where}", params)["c"]
    rows = db.query_all(
        f"""SELECT ki.* FROM knowledge_items ki{where}
            ORDER BY ki.updated_at DESC LIMIT ? OFFSET ?""",
        [*params, limit, (page - 1) * limit],
    )
    items = []
    for r in rows:
        d = dict(r)
        d["tags"] = [x["tag"] for x in db.query_all(
            "SELECT tag FROM knowledge_tags WHERE knowledge_id=?", (d["id"],)
        )]
        items.append(d)
    return {"items": items, "total": total, "page": page, "limit": limit}
