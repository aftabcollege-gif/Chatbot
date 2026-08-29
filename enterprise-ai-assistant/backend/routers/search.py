"""Global search endpoints."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from core.dependencies import get_current_user
from services import search_service

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(
    q: str,
    type: Optional[str] = None,
    department_id: Optional[str] = None,
    file_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    user: dict = Depends(get_current_user),
):
    return search_service.global_search(
        q,
        user,
        result_type=type,
        department_id=department_id,
        file_type=file_type,
        from_date=from_date,
        to_date=to_date,
        page=page,
        limit=limit,
    )


@router.get("/suggestions")
def suggestions(q: str, user: dict = Depends(get_current_user)):
    return {"suggestions": search_service.suggestions(q)}
