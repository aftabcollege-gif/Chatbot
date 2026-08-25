"""Document and folder management endpoints."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from core import database as db
from core.dependencies import get_current_user, require_permission
from models.schemas import FolderCreate, FolderUpdate
from services import audit_service
from utils.file_utils import (
    detect_file_type,
    new_document_dir,
    safe_extension,
    sanitize_filename,
    save_upload,
    sha256_stream,
    validate_upload,
)
from workers.document_processor import submit_document

router = APIRouter(prefix="/api/resources", tags=["resources"])


# ---- Folders ------------------------------------------------------------- #
@router.get("/folders")
def list_folders(
    parent_id: Optional[str] = None,
    department_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    clauses = []
    params: list = []
    if parent_id:
        clauses.append("parent_id=?")
        params.append(parent_id)
    else:
        clauses.append("parent_id IS NULL")
    if department_id:
        clauses.append("department_id=?")
        params.append(department_id)
    if not user.get("is_superadmin"):
        clauses.append("(owner_id=? OR visibility!='private')")
        params.append(user["id"])
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    rows = db.query_all(
        f"SELECT * FROM resource_folders{where} ORDER BY name", params
    )
    return {"folders": [dict(r) for r in rows]}


@router.get("/tree")
def folder_tree(user: dict = Depends(get_current_user)):
    rows = db.query_all("SELECT * FROM resource_folders ORDER BY name")
    folders = [dict(r) for r in rows]

    def build(parent_id=None):
        nodes = []
        for f in folders:
            if f["parent_id"] == parent_id:
                node = {**f, "children": build(f["id"])}
                nodes.append(node)
        return nodes

    return {"tree": build(None)}


@router.post("/folders", dependencies=[Depends(require_permission("resources.upload"))])
def create_folder(payload: FolderCreate, user: dict = Depends(get_current_user)):
    fid = db.insert_and_pk(
        "resource_folders",
        {
            "organization_id": user.get("organization_id"),
            "department_id": payload.department_id or user.get("department_id"),
            "parent_id": payload.parent_id,
            "name": payload.name.strip(),
            "owner_id": user["id"],
            "visibility": payload.visibility,
        },
    )
    return dict(db.query_one("SELECT * FROM resource_folders WHERE id=?", (fid,)))


@router.patch("/folders/{folder_id}", dependencies=[Depends(require_permission("resources.manage"))])
def update_folder(folder_id: str, payload: FolderUpdate, user: dict = Depends(get_current_user)):
    row = db.query_one("SELECT * FROM resource_folders WHERE id=?", (folder_id,))
    if not row:
        raise HTTPException(404, "پوشه یافت نشد.")
    sets, params = [], []
    for field in ("name", "visibility", "parent_id"):
        val = getattr(payload, field)
        if val is not None:
            sets.append(f"{field}=?")
            params.append(val)
    sets.append("updated_at=datetime('now')")
    params.append(folder_id)
    db.execute(f"UPDATE resource_folders SET {', '.join(sets)} WHERE id=?", params)
    return dict(db.query_one("SELECT * FROM resource_folders WHERE id=?", (folder_id,)))


@router.delete("/folders/{folder_id}", dependencies=[Depends(require_permission("resources.manage"))])
def delete_folder(folder_id: str, user: dict = Depends(get_current_user)):
    if db.query_one("SELECT 1 FROM documents WHERE folder_id=?", (folder_id,)):
        raise HTTPException(400, "پوشه شامل سند است و قابل حذف نیست.")
    db.execute("DELETE FROM resource_folders WHERE id=?", (folder_id,))
    return {"success": True}


# ---- Documents ----------------------------------------------------------- #
@router.get("/documents")
def list_documents(
    folder_id: Optional[str] = None,
    page: int = 1,
    limit: int = 24,
    search: Optional[str] = None,
    file_type: Optional[str] = None,
    status: Optional[str] = None,
    visibility: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    clauses = []
    params: list = []
    if folder_id:
        clauses.append("folder_id=?")
        params.append(folder_id)
    if search:
        clauses.append("(title LIKE ? OR original_filename LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    if file_type:
        clauses.append("file_type=?")
        params.append(file_type)
    if status:
        clauses.append("status=?")
        params.append(status)
    if visibility:
        clauses.append("visibility=?")
        params.append(visibility)
    if not user.get("is_superadmin"):
        clauses.append(
            "(owner_id=? OR visibility='public' OR "
            "(visibility='department' AND department_id=?) OR "
            "(visibility IN ('org','organization') AND organization_id=?))"
        )
        params.extend([user["id"], user.get("department_id"), user.get("organization_id")])
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    total = db.query_one(f"SELECT COUNT(*) AS c FROM documents{where}", params)["c"]
    rows = db.query_all(
        f"SELECT * FROM documents{where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [*params, limit, (page - 1) * limit],
    )
    return {"items": [dict(r) for r in rows], "total": total, "page": page, "limit": limit}


@router.post("/documents/upload", dependencies=[Depends(require_permission("resources.upload"))])
async def upload_document(
    file: UploadFile = File(...),
    folder_id: Optional[str] = Form(None),
    visibility: str = Form("private"),
    user: dict = Depends(get_current_user),
):
    raw = await file.read()
    size = len(raw)
    try:
        ext = validate_upload(file.filename or "unknown", size)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    # Detect true type from magic bytes.
    import io

    stream = io.BytesIO(raw)
    detected = detect_file_type(stream, file.filename or "")
    if detected in ("zip",) and ext not in ("docx", "xlsx", "pptx"):
        raise HTTPException(400, "فایل فشرده پشتیبانی نمی‌شود.")

    doc_dir = new_document_dir()
    safe_name = sanitize_filename(file.filename or "file")
    storage_path = doc_dir / f"original.{safe_extension(safe_name)}"
    stream.seek(0)
    save_upload(stream, storage_path)
    file_hash = sha256_stream(open(storage_path, "rb"))

    # Duplicate hash check.
    dup = db.query_one(
        "SELECT id FROM documents WHERE file_hash=? AND owner_id=?",
        (file_hash, user["id"]),
    )
    if dup:
        # Still allow but link; we create a new record with reference.
        pass

    doc_id = db.insert_and_pk(
        "documents",
        {
            "organization_id": user.get("organization_id"),
            "department_id": user.get("department_id"),
            "folder_id": folder_id,
            "owner_id": user["id"],
            "title": Path(safe_name).stem,
            "original_filename": file.filename,
            "file_type": ext,
            "mime_type": file.content_type,
            "file_size_bytes": size,
            "file_hash": file_hash,
            "storage_path": str(storage_path),
            "visibility": visibility,
            "status": "UPLOADED",
        },
    )
    audit_service.log(
        "document.upload", actor_id=user["id"], actor_name=user["name"],
        resource_type="document", resource_id=doc_id, resource_name=file.filename,
    )

    # Create version 1.
    db.execute(
        """INSERT INTO document_versions
           (document_id, version_number, storage_path, file_size_bytes, file_hash, created_by)
           VALUES (?,?,?,?,?,?)""",
        (doc_id, 1, str(storage_path), size, file_hash, user["id"]),
    )

    # Fire-and-forget background processing.
    submit_document(doc_id)

    return {
        "document": dict(db.query_one("SELECT * FROM documents WHERE id=?", (doc_id,))),
        "job_id": doc_id,
    }


@router.post("/batch-upload", dependencies=[Depends(require_permission("resources.upload"))])
async def batch_upload(
    files: List[UploadFile] = File(...),
    folder_id: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    results = []
    for f in files:
        raw = await f.read()
        try:
            validate_upload(f.filename or "unknown", len(raw))
        except ValueError:
            continue
        import io as _io

        doc_dir = new_document_dir()
        safe_name = sanitize_filename(f.filename or "file")
        storage_path = doc_dir / f"original.{safe_extension(safe_name)}"
        with open(storage_path, "wb") as out:
            out.write(raw)
        file_hash = sha256_stream(open(storage_path, "rb"))
        doc_id = db.insert_and_pk(
            "documents",
            {
                "organization_id": user.get("organization_id"),
                "department_id": user.get("department_id"),
                "folder_id": folder_id,
                "owner_id": user["id"],
                "title": Path(safe_name).stem,
                "original_filename": f.filename,
                "file_type": safe_extension(safe_name),
                "mime_type": f.content_type,
                "file_size_bytes": len(raw),
                "file_hash": file_hash,
                "storage_path": str(storage_path),
                "visibility": "private",
            },
        )
        submit_document(doc_id)
        results.append(doc_id)
    return {"job_id": uuid.uuid4().hex, "file_count": len(results), "document_ids": results}


@router.get("/documents/{doc_id}")
def get_document(doc_id: str, user: dict = Depends(get_current_user)):
    row = db.query_one("SELECT * FROM documents WHERE id=?", (doc_id,))
    if not row:
        raise HTTPException(404, "سند یافت نشد.")
    return dict(row)


@router.delete("/documents/{doc_id}", dependencies=[Depends(require_permission("resources.manage"))])
def delete_document(doc_id: str, user: dict = Depends(get_current_user)):
    row = db.query_one("SELECT * FROM documents WHERE id=?", (doc_id,))
    if not row:
        raise HTTPException(404, "سند یافت نشد.")
    db.execute("DELETE FROM documents WHERE id=?", (doc_id,))
    try:
        p = Path(row["storage_path"])
        if p.exists():
            p.unlink()
            p.parent.rmdir()
    except OSError:
        pass
    return {"success": True}


@router.get("/documents/{doc_id}/status")
def document_status(doc_id: str, user: dict = Depends(get_current_user)):
    row = db.query_one(
        "SELECT status, processing_progress, processing_error FROM documents WHERE id=?",
        (doc_id,),
    )
    if not row:
        raise HTTPException(404, "سند یافت نشد.")
    return dict(row)


@router.get("/documents/{doc_id}/download")
def download_document(doc_id: str, user: dict = Depends(get_current_user)):
    row = db.query_one("SELECT * FROM documents WHERE id=?", (doc_id,))
    if not row or not Path(row["storage_path"]).exists():
        raise HTTPException(404, "فایل یافت نشد.")
    return FileResponse(
        row["storage_path"],
        filename=row["original_filename"],
        media_type=row["mime_type"] or "application/octet-stream",
    )


@router.get("/documents/{doc_id}/preview")
def preview_document(doc_id: str, user: dict = Depends(get_current_user)):
    row = db.query_one("SELECT * FROM documents WHERE id=?", (doc_id,))
    if not row:
        raise HTTPException(404, "سند یافت نشد.")
    pages = [
        dict(r)
        for r in db.query_all(
            "SELECT DISTINCT page_number FROM document_chunks WHERE document_id=? AND page_number IS NOT NULL ORDER BY page_number",
            (doc_id,),
        )
    ]
    return {
        "preview_url": f"/api/resources/documents/{doc_id}/download",
        "file_type": row["file_type"],
        "pages": [p["page_number"] for p in pages],
    }


@router.get("/documents/{doc_id}/view-page/{page}")
def view_page(doc_id: str, page: int, user: dict = Depends(get_current_user)):
    rows = db.query_all(
        "SELECT chunk_index, content, heading FROM document_chunks WHERE document_id=? AND page_number=? ORDER BY chunk_index",
        (doc_id, page),
    )
    return {"page": page, "chunks": [dict(r) for r in rows]}


@router.post("/documents/{doc_id}/publish", dependencies=[Depends(require_permission("resources.manage"))])
def publish_document(doc_id: str, user: dict = Depends(get_current_user)):
    row = db.query_one("SELECT status FROM documents WHERE id=?", (doc_id,))
    if not row:
        raise HTTPException(404, "سند یافت نشد.")
    if row["status"] != "READY":
        raise HTTPException(400, "سند هنوز پردازش نشده است.")
    db.execute(
        "UPDATE documents SET visibility='public', updated_at=datetime('now') WHERE id=?",
        (doc_id,),
    )
    audit_service.log(
        "document.publish", actor_id=user["id"], resource_type="document", resource_id=doc_id
    )
    return dict(db.query_one("SELECT * FROM documents WHERE id=?", (doc_id,)))


@router.get("/documents/{doc_id}/versions")
def versions(doc_id: str, user: dict = Depends(get_current_user)):
    rows = db.query_all(
        "SELECT * FROM document_versions WHERE document_id=? ORDER BY version_number DESC",
        (doc_id,),
    )
    return {"versions": [dict(r) for r in rows]}
