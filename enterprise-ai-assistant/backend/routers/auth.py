"""Authentication endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer

from core.dependencies import get_current_user
from core.security import AuthError
from models.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
)
from services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)


@router.post("/login")
def login(payload: LoginRequest, request: Request):
    try:
        return auth_service.authenticate(payload.username.strip(), payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.post("/logout")
def logout(payload: RefreshRequest, user: dict = Depends(get_current_user)):
    auth_service.logout(payload.refresh_token, user["id"])
    return {"success": True}


@router.post("/refresh")
def refresh(payload: RefreshRequest):
    try:
        result = auth_service.refresh_tokens(payload.refresh_token)
        return {
            "access_token": result["access_token"],
            "token_type": "bearer",
            "expires_in": result["expires_in"],
        }
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return {"user": auth_service.profile(user)}


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest, user: dict = Depends(get_current_user)
):
    try:
        auth_service.change_password(
            user["id"], payload.current_password, payload.new_password
        )
        return {"success": True}
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
