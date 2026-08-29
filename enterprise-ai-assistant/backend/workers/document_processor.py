"""Background document processing: extract -> normalize -> chunk -> embed -> index."""
from __future__ import annotations

import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Optional

from core import database as db
from services.chunker_service import chunk_text
from services.document_service import ExtractionError, extract
from services.embedding_service import get_embedding_service
from services.normalizer_service import normalize_for_index, detect
from utils.persian import normalize_persian
from utils.file_utils import sha256_file

_PAGE_RE = re.compile(r"\[\[page:(\d+)\]\]")

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="docproc")


def _set_status(doc_id: str, status: str, progress: int, error: Optional[str] = None) -> None:
    db.execute(
        "UPDATE documents SET status=?, processing_progress=?, processing_error=?, updated_at=datetime('now') WHERE id=?",
        (status, progress, error, doc_id),
    )


def _process(doc_id: str) -> None:
    conn = db.get_conn()  # this thread gets its own connection
    try:
        doc = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
        if not doc:
            return
        _set_status(doc_id, "EXTRACTING", 10)
        path = Path(doc["storage_path"])
        if not path.exists():
            _set_status(doc_id, "ERROR", 0, "فایل در دیسک یافت نشد.")
            return

        try:
            text, page_count = extract(path, doc["file_type"])
        except ExtractionError as exc:
            _set_status(doc_id, "ERROR", 0, str(exc))
            return

        language = detect(text[:2000])
        conn.execute(
            "UPDATE documents SET language=?, page_count=?, file_hash=?, status=?, processing_progress=? WHERE id=?",
            (language, page_count, sha256_file(path), "CHUNKING", 35, doc_id),
        )

        # Split text by explicit page markers (PDF).
        if "[[page:" in text:
            segments = []
            current_page = 1
            current: list[str] = []
            for line in text.splitlines():
                m = _PAGE_RE.search(line)
                if m:
                    if current:
                        segments.append((current_page, "\n".join(current)))
                    current_page = int(m.group(1))
                    current = []
                else:
                    current.append(line)
            if current:
                segments.append((current_page, "\n".join(current)))
        else:
            segments = [(1, text)]

        chunks = []
        for page_num, seg_text in segments:
            for ch in chunk_text(seg_text, page_number=page_num):
                chunks.append(ch)

        _set_status(doc_id, "EMBEDDING", 55)
        embedder = get_embedding_service()

        # Insert chunks in batches.
        BATCH = 32
        total = len(chunks)
        for batch_start in range(0, total, BATCH):
            batch = chunks[batch_start : batch_start + BATCH]
            norm_texts = [normalize_for_index(c.content) for c in batch]
            vectors = embedder.embed(norm_texts)
            for c, norm, vec in zip(batch, norm_texts, vectors):
                cur = conn.execute(
                    """INSERT INTO document_chunks
                       (document_id, organization_id, department_id, chunk_index,
                        content, content_normalized, page_number, section, heading,
                        source_type, visibility, token_count, metadata)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        doc_id,
                        doc["organization_id"],
                        doc["department_id"],
                        c.chunk_index,
                        c.content,
                        norm,
                        c.page_number,
                        c.section,
                        c.heading,
                        "document",
                        doc["visibility"],
                        c.token_count,
                        "{}",
                    ),
                )
                chunk_rowid = cur.lastrowid
                chunk_id_row = conn.execute(
                    "SELECT id FROM document_chunks WHERE rowid=?", (chunk_rowid,)
                ).fetchone()
                chunk_id = chunk_id_row["id"] if chunk_id_row else str(chunk_rowid)
                if db.vec_available():
                    try:
                        conn.execute(
                            "INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)",
                            (chunk_id, embedder.to_blob(vec)),
                        )
                    except Exception:
                        pass
            progress = 55 + int((batch_start + len(batch)) / max(1, total) * 40)
            _set_status(doc_id, "INDEXING", progress)

        _set_status(doc_id, "READY", 100)
    except Exception as exc:  # noqa: BLE001
        _set_status(doc_id, "ERROR", 0, f"خطای پردازش: {exc}")


def submit_document(doc_id: str) -> None:
    """Submit a document for background processing (threaded)."""
    _executor.submit(_safe_process, doc_id)


def _safe_process(doc_id: str) -> None:
    try:
        _process(doc_id)
    except Exception as exc:  # noqa: BLE001
        _set_status(doc_id, "ERROR", 0, f"خطای پردازش: {exc}")


def shutdown(self) -> None:
    _executor.shutdown(wait=False, cancel_futures=True)
