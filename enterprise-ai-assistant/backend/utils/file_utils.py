"""File validation, hashing, sanitization and safe path helpers."""
from __future__ import annotations

import hashlib
import re
import shutil
import uuid
from pathlib import Path
from typing import BinaryIO

from core.config import settings

# Magic-byte signatures for allowed binary types.
_MAGIC = {
    b"%PDF-": "pdf",
    b"PK\x03\x04": "zip",  # docx/xlsx/pptx
    b"\x89PNG": "png",
    b"\xff\xd8\xff": "jpg",
}

_EXT_ALIASES = {
    "doc": "docx",
    "xls": "xlsx",
    "ppt": "pptx",
    "jpeg": "jpg",
    "tif": "tiff",
    "text": "txt",
}

_OFFICE_ZIP = {"docx", "xlsx", "pptx"}


def safe_extension(filename: str) -> str:
    ext = Path(filename).suffix.lower().lstrip(".")
    return _EXT_ALIASES.get(ext, ext)


def sanitize_filename(filename: str) -> str:
    name = Path(filename).name
    name = re.sub(r"[^\w.\-\u0600-\u06FF ]+", "_", name)
    name = re.sub(r"\s+", "_", name).strip("._")
    return name or f"file_{uuid.uuid4().hex[:8]}"


def detect_file_type(stream: BinaryIO, filename: str) -> str:
    head = stream.read(8)
    stream.seek(0)
    ext = safe_extension(filename)
    for magic, kind in _MAGIC.items():
        if head.startswith(magic):
            if kind == "zip" and ext in _OFFICE_ZIP:
                return ext
            if kind == "zip":
                return "zip"
            if kind in ("png", "jpg"):
                return "image"
            return kind
    # Text-based formats.
    if ext in settings.allowed_types or ext in ("txt", "md", "csv", "json", "xml", "html", "epub", "odt"):
        return ext
    return ext


def validate_upload(filename: str, size_bytes: int) -> str:
    ext = safe_extension(filename)
    allowed = set(settings.allowed_types) | {"jpg", "jpeg", "png", "tiff", "bmp", "gif"}
    if ext not in allowed:
        raise ValueError(f"نوع فایل مجاز نیست: {ext}")
    if size_bytes > settings.max_file_size_bytes:
        raise ValueError("اندازه فایل بیش از حد مجاز است.")
    return ext


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_stream(stream: BinaryIO) -> str:
    h = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        h.update(chunk)
    stream.seek(0)
    return h.hexdigest()


def new_document_dir() -> Path:
    d = settings.storage_path / "documents" / uuid.uuid4().hex
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_upload(stream: BinaryIO, dest: Path) -> None:
    with open(dest, "wb") as out:
        shutil.copyfileobj(stream, out)
