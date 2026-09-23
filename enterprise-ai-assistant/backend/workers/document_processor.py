"""Background document processing: extract -> normalize -> chunk -> embed -> index."""
from __future__ import annotations

import re
import threading
import time
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


#: statuses that mean "work finished" (nothing to requeue)
TERMINAL_STATUSES = ("READY", "ERROR")

#: how long a document may stay in a working status before it is retried
STALE_SECONDS = 120
MAX_ATTEMPTS = 3

_started: Dict[str, float] = {}
_attempts: Dict[str, int] = {}
_watchdog_started = False


def submit_document(doc_id: str) -> None:
    """Submit a document for background processing (threaded)."""
    _started[doc_id] = time.time()
    _executor.submit(_safe_process, doc_id)
    _ensure_watchdog()


def _safe_process(doc_id: str) -> None:
    _attempts[doc_id] = _attempts.get(doc_id, 0) + 1
    try:
        _process(doc_id)
    except Exception as exc:  # noqa: BLE001
        _set_status(doc_id, "ERROR", 0, f"خطای پردازش: {exc}")
    finally:
        _started.pop(doc_id, None)


def requeue_unfinished(log=print) -> int:
    """Restart documents that were left mid-processing.

    A document can stay in ``UPLOADED``/``EMBEDDING``/... forever when the
    process is closed mid-way (or when its worker thread died).  The user sees
    "بارگذاری شد و در حال پردازش است" and the source never becomes usable.
    Requeuing them here is what makes the resources page eventually finish.
    """
    requeued = 0
    try:
        rows = db.query_all(
            "SELECT id, status, processing_progress FROM documents "
            "WHERE status IS NULL OR status NOT IN ('READY','ERROR')"
        )
    except Exception as exc:  # noqa: BLE001
        log(f"[docproc] requeue skipped: {exc!r}")
        return 0
    now = time.time()
    for row in rows:
        doc_id = row["id"] if not isinstance(row, dict) else row["id"]
        started = _started.get(doc_id, 0)
        if started and now - started < STALE_SECONDS:
            continue  # still being worked on
        if _attempts.get(doc_id, 0) >= MAX_ATTEMPTS:
            _set_status(doc_id, "ERROR", 0, "پردازش پس از چند تلاش کامل نشد؛ فایل را دوباره بارگذاری کنید.")
            continue
        log(f"[docproc] requeue {doc_id} (status={row['status']})")
        submit_document(doc_id)
        requeued += 1
    return requeued


def _ensure_watchdog() -> None:
    """Start the background watchdog that finishes stuck documents."""
    global _watchdog_started
    if _watchdog_started:
        return
    _watchdog_started = True

    def _loop() -> None:
        while True:
            time.sleep(STALE_SECONDS / 2)
            try:
                requeue_unfinished(log=lambda message: print(message, flush=True))
            except Exception:  # noqa: BLE001
                pass

    threading.Thread(target=_loop, name="docproc-watchdog", daemon=True).start()


def shutdown(self) -> None:
    _executor.shutdown(wait=False, cancel_futures=True)
