"""Pydantic request/response schemas."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

# A pragmatic email type that also accepts internal/corporate domains such as
# ``admin@corp.local`` which the strict ``EmailStr`` rejects.
import re as _re

_EMAIL_RE = _re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

from pydantic.functional_validators import AfterValidator  # noqa: E402
from typing import Annotated  # noqa: E402


def _validate_email(v: str) -> str:
    v = v.strip()
    if not _EMAIL_RE.match(v):
        raise ValueError("نشانی ایمیل نامعتبر است.")
    return v


EmailStr = Annotated[str, AfterValidator(_validate_email)]  # type: ignore


# ---- Auth ---------------------------------------------------------------- #
class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


class RefreshRequest(BaseModel):
    refresh_token: str


# ---- Setup --------------------------------------------------------------- #
class AdminSetup(BaseModel):
    name: str
    email: EmailStr
    username: str = Field(min_length=3, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=6)


class OrganizationSetup(BaseModel):
    name: str
    description: Optional[str] = ""
    departments: List[str] = Field(default_factory=list)


# ---- Chat ---------------------------------------------------------------- #
class ConversationCreate(BaseModel):
    title: Optional[str] = None


class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    is_pinned: Optional[bool] = None


class ChatMessageRequest(BaseModel):
    content: str
    scope: str = "all"
    scope_id: Optional[str] = None
    attachments: List[str] = Field(default_factory=list)


class FeedbackRequest(BaseModel):
    type: str = Field(pattern="^(positive|negative)$")
    reason: Optional[str] = None


# ---- Resources ----------------------------------------------------------- #
class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[str] = None
    visibility: str = "private"
    department_id: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    visibility: Optional[str] = None
    parent_id: Optional[str] = None


class DocumentPublish(BaseModel):
    visibility: str = "private"
    authority_score: Optional[float] = 0.8


# ---- Knowledge ----------------------------------------------------------- #
class KnowledgeCreate(BaseModel):
    title: str
    subject: Optional[str] = None
    department_id: Optional[str] = None
    problem_description: str
    action_taken: str
    result: Optional[str] = None
    lesson_learned: str
    suggestion: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    visibility: str = "department"


class KnowledgeUpdate(BaseModel):
    title: Optional[str] = None
    subject: Optional[str] = None
    department_id: Optional[str] = None
    problem_description: Optional[str] = None
    action_taken: Optional[str] = None
    result: Optional[str] = None
    lesson_learned: Optional[str] = None
    suggestion: Optional[str] = None
    tags: Optional[List[str]] = None
    visibility: Optional[str] = None


class ApproveRequest(BaseModel):
    comment: Optional[str] = None


class RejectRequest(BaseModel):
    reason: str


# ---- Admin users --------------------------------------------------------- #
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    username: str = Field(min_length=3, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=6)
    role_id: Optional[str] = None
    department_id: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role_id: Optional[str] = None
    department_id: Optional[str] = None
    is_active: Optional[bool] = None


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6)


# ---- Admin roles --------------------------------------------------------- #
class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[List[str]] = None


class ResourcePermissionUpdate(BaseModel):
    role_id: Optional[str] = None
    user_id: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)
    inherit: bool = False


# ---- Admin web sources --------------------------------------------------- #
class WebSourceCreate(BaseModel):
    domain: str
    allowed_paths: List[str] = Field(default_factory=lambda: ["/"])
    crawl_depth: int = 2
    refresh_hours: int = 24


class WebSourceUpdate(BaseModel):
    allowed_paths: Optional[List[str]] = None
    crawl_depth: Optional[int] = None
    refresh_hours: Optional[int] = None
    is_active: Optional[bool] = None


# ---- Admin settings / logs ---------------------------------------------- #
class SettingsUpdate(BaseModel):
    settings: Dict[str, Any]


class LogQuery(BaseModel):
    question: str


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    preferences: Optional[Dict[str, Any]] = None
