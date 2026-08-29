"""Knowledge base endpoints."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core import database as db
from core.dependencies import get_current_user, require_permission
from models.schemas import (
    ApproveRequest,
    KnowledgeCreate,
    KnowledgeUpdate,
    RejectRequest,
)
from services import audit_service, knowledge_service

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


@router.get("")
def list_knowledge(
    status: Optional[str] = None,
    department_id: Optional[str] = None,
    tags: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    user: dict = Depends(get_current_user),
):
    return knowledge_service.list_knowledge(
        user,
        status=status,
        department_id=department_id,
        tag=tags,
        search=search,
        page=page,
        limit=limit,
    )


@router.post("", dependencies=[Depends(require_permission("knowledge.create"))])
def create_knowledge(
    payload: KnowledgeCreate, user: dict = Depends(get_current_user)
):
    item = knowledge_service.create_knowledge(payload.model_dump(), user)
    audit_service.log(
        "knowledge.create",
        actor_id=user["id"],
        resource_type="knowledge",
        resource_id=item["id"],
        resource_name=item["title"],
    )
    return item


@router.get("/{kid}")
def get_knowledge(kid: str, user: dict = Depends(get_current_user)):
    try:
        return knowledge_service.get_knowledge(kid, user)
    except KeyError as exc:
        raise HTTPException(404, str(exc))


@router.patch("/{kid}")
def update_knowledge(
    kid: str, payload: KnowledgeUpdate, user: dict = Depends(get_current_user)
):
    item = knowledge_service.get_knowledge(kid, user)
    if item["owner_id"] != user["id"] and not user.get("is_superadmin"):
        raise HTTPException(403, "فقط مالک می‌تواند ویرایش کند.")
    return knowledge_service.update_knowledge(kid, payload.model_dump(exclude_none=True), user)


@router.delete("/{kid}")
def delete_knowledge(kid: str, user: dict = Depends(get_current_user)):
    item = knowledge_service.get_knowledge(kid, user)
    if item["owner_id"] != user["id"] and not user.get("is_superadmin"):
        raise HTTPException(403, "فقط مالک می‌تواند حذف کند.")
    db.execute("DELETE FROM knowledge_items WHERE id=?", (kid,))
    audit_service.log(
        "knowledge.delete", actor_id=user["id"], resource_type="knowledge", resource_id=kid
    )
    return {"success": True}


@router.post("/{kid}/submit")
def submit_knowledge(kid: str, user: dict = Depends(get_current_user)):
    knowledge_service.get_knowledge(kid, user)
    return knowledge_service.set_status(kid, "UNDER_REVIEW", user)


@router.post("/{kid}/approve", dependencies=[Depends(require_permission("knowledge.approve"))])
def approve_knowledge(
    kid: str, payload: ApproveRequest, user: dict = Depends(get_current_user)
):
    item = knowledge_service.set_status(kid, "PUBLISHED", user, payload.comment)
    audit_service.log(
        "knowledge.approve",
        actor_id=user["id"],
        resource_type="knowledge",
        resource_id=kid,
    )
    return item


@router.post("/{kid}/reject", dependencies=[Depends(require_permission("knowledge.approve"))])
def reject_knowledge(
    kid: str, payload: RejectRequest, user: dict = Depends(get_current_user)
):
    return knowledge_service.set_status(kid, "REJECTED", user, payload.reason)


@router.post("/{kid}/publish")
def publish_knowledge(kid: str, user: dict = Depends(get_current_user)):
    item = knowledge_service.get_knowledge(kid, user)
    if item["owner_id"] != user["id"] and not user.get("is_superadmin"):
        raise HTTPException(403, "فقط مالک می‌تواند منتشر کند.")
    item = knowledge_service.set_status(kid, "PUBLISHED", user)
    audit_service.log(
        "knowledge.publish", actor_id=user["id"], resource_type="knowledge", resource_id=kid
    )
    return item


@router.post("/{kid}/archive")
def archive_knowledge(kid: str, user: dict = Depends(get_current_user)):
    return knowledge_service.set_status(kid, "ARCHIVED", user)
