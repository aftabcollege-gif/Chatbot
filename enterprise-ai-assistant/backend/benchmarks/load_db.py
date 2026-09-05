"""Bulk-load synthetic corpora into a throwaway benchmark database.

Uses the real schema (documents / document_chunks / chunks_vec / chunks_fts)
and the real embedding service, but inserts in batches so that large scales
stay practical. Chunking mirrors production (fixed word windows).
"""
from __future__ import annotations

import os
import random
import sys
import time
import uuid
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Dict, List, Tuple

BACKEND_DIR = str(Path(__file__).resolve().parent.parent)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from core import database as db  # noqa: E402
from services.normalizer_service import normalize_for_index  # noqa: E402

ORG_ID = "bench-org-0001"
DEPT_IDS = ["bench-dept-01", "bench-dept-02"]
ADMIN_ID = "bench-admin-0001"
USER_ID = "bench-user-0001"


def seed_org() -> None:
    conn = db.get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)",
        (ORG_ID, "سازمان بنچمارک"),
    )
    for i, dept in enumerate(DEPT_IDS):
        conn.execute(
            "INSERT OR IGNORE INTO departments (id, organization_id, name) VALUES (?, ?, ?)",
            (dept, ORG_ID, f"واحد {i + 1}"),
        )
    conn.execute(
        "INSERT OR IGNORE INTO users (id, organization_id, department_id, username, email, name, password_hash, is_superadmin)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (ADMIN_ID, ORG_ID, DEPT_IDS[0], "bench_admin", "bench-admin@example.test",
         "مدیر بنچمارک", "not-a-real-hash", 1),
    )
    conn.execute(
        "INSERT OR IGNORE INTO users (id, organization_id, department_id, username, email, name, password_hash, is_superadmin)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (USER_ID, ORG_ID, DEPT_IDS[1], "bench_user", "bench-user@example.test",
         "کاربر بنچمارک", "not-a-real-hash", 0),
    )


def admin_user() -> Dict:
    return {"id": ADMIN_ID, "organization_id": ORG_ID,
            "department_id": DEPT_IDS[0], "is_superadmin": True}


def restricted_user() -> Dict:
    return {"id": USER_ID, "organization_id": ORG_ID,
            "department_id": DEPT_IDS[1], "is_superadmin": False}


# --------------------------------------------------------------------------- #
# Chunking (mirrors production windows: ~words per chunk with small overlap)
# --------------------------------------------------------------------------- #
def window_text(text: str, size: int = 220, overlap: int = 25) -> List[str]:
    words = text.split()
    if not words:
        return []
    if len(words) <= size:
        return [text.strip()]
    out, i = [], 0
    step = size - overlap
    while i < len(words):
        out.append(" ".join(words[i:i + size]))
        i += step
    return out


# --------------------------------------------------------------------------- #
# Embedding helpers (hash backend is CPU-bound pure Python -> multiprocess it)
# --------------------------------------------------------------------------- #
def _embed_batch_worker(args: Tuple[List[str], int]) -> List[List[float]]:
    texts, dim = args
    # Local import: workers are fresh interpreters.
    import sys as _sys
    if BACKEND_DIR not in _sys.path:
        _sys.path.insert(0, BACKEND_DIR)
    from services.embedding_service import _HashEmbedder
    return _HashEmbedder(dim).embed(texts).astype("float32").tolist()


def embed_texts(texts: List[str], dim: int, workers: int = 0) -> List[List[float]]:
    if workers and workers > 1 and len(texts) >= workers * 4:
        shard = max(1, len(texts) // workers)
        jobs = [(texts[i:i + shard], dim) for i in range(0, len(texts), shard)]
        with ProcessPoolExecutor(max_workers=workers) as pool:
            parts = list(pool.map(_embed_batch_worker, jobs))
        return [v for part in parts for v in part]
    from services.embedding_service import get_embedding_service
    return get_embedding_service().embed(texts)


def _to_blob(vec: List[float]) -> bytes:
    import struct
    return struct.pack(f"{len(vec)}f", *vec)


# --------------------------------------------------------------------------- #
# Bulk load
# --------------------------------------------------------------------------- #
def bulk_load(num_docs: int, sentences_per_doc: int = 60,
              seed: int = 42, embed_workers: int = 0,
              batch_docs: int = 500, log: bool = True) -> Dict:
    """Generate + embed + index `num_docs` synthetic documents. Returns stats."""
    from benchmarks.gen_data import generate_doc
    rng = random.Random(seed)
    conn = db.get_conn()
    t0 = time.time()
    total_chunks = 0
    embed_s = 0.0
    insert_s = 0.0

    from core.config import settings
    dim = settings.embedding_dim
    vec_on = db.vec_available()

    for start in range(0, num_docs, batch_docs):
        end = min(num_docs, start + batch_docs)
        # 1) generate
        docs, chunk_rows = [], []
        for doc_no in range(start, end):
            d = generate_doc(rng, doc_no, sentences=sentences_per_doc)
            doc_id = f"bench-doc-{doc_no:07d}"
            dept = DEPT_IDS[doc_no % len(DEPT_IDS)]
            docs.append((doc_id, ORG_ID, dept, ADMIN_ID, d.title,
                         f"doc-{doc_no}.txt", "txt", "text/plain",
                         len(d.body.encode("utf-8")), f"hash-{doc_no}",
                         f"/bench/doc-{doc_no}.txt", "READY", 100, None,
                         "fa", 3, "public", 0.8, "{}"))
            for idx, window in enumerate(window_text(d.body)):
                chunk_rows.append((str(uuid.uuid4()), doc_id, ORG_ID, dept,
                                   idx, window, normalize_for_index(window),
                                   1 + (idx % 3), None, None, "document",
                                   "public", len(window.split()), "{}"))
        # 2) embed chunk contents
        t_e = time.time()
        texts = [r[5] for r in chunk_rows]
        vectors = embed_texts(texts, dim, workers=embed_workers)
        embed_s += time.time() - t_e
        # 3) insert
        t_i = time.time()
        conn.executemany(
            "INSERT INTO documents (id, organization_id, department_id, owner_id, title,"
            " original_filename, file_type, mime_type, file_size_bytes, file_hash,"
            " storage_path, status, processing_progress, processing_error, language,"
            " page_count, visibility, authority_score, metadata)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", docs)
        conn.executemany(
            "INSERT INTO document_chunks (id, document_id, organization_id, department_id,"
            " chunk_index, content, content_normalized, page_number, section, heading,"
            " source_type, visibility, token_count, metadata)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", chunk_rows)
        if vec_on:
            conn.executemany(
                "INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)",
                [(r[0], _to_blob(v)) for r, v in zip(chunk_rows, vectors)])
        conn.execute("COMMIT") if False else None
        total_chunks += len(chunk_rows)
        insert_s += time.time() - t_i
        if log:
            el = time.time() - t0
            print(f"  loaded {end}/{num_docs} docs ({total_chunks} chunks) "
                  f"in {el:.1f}s", flush=True)

    return {"docs": num_docs, "chunks": total_chunks,
            "load_wall_s": round(time.time() - t0, 2),
            "embed_s": round(embed_s, 2), "insert_s": round(insert_s, 2),
            "vec_enabled": vec_on}


def plant_needles(seed_offset: int = 0) -> Dict[str, str]:
    """Insert one document per NEEDLE. Returns {exact_query: doc_id} + {'PARA:...': doc_id}."""
    from benchmarks.gen_data import NEEDLES
    from core.config import settings
    conn = db.get_conn()
    gold: Dict[str, str] = {}
    for i, n in enumerate(NEEDLES):
        doc_id = f"bench-needle-{i + seed_offset:03d}"
        conn.execute(
            "INSERT INTO documents (id, organization_id, department_id, owner_id, title,"
            " original_filename, file_type, mime_type, file_size_bytes, file_hash,"
            " storage_path, status, processing_progress, language, page_count,"
            " visibility, authority_score, metadata)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (doc_id, ORG_ID, DEPT_IDS[0], ADMIN_ID, f"سند ویژه {i}",
             f"needle-{i}.txt", "txt", "text/plain",
             len(n.text.encode("utf-8")), f"needle-hash-{i}",
             f"/bench/needle-{i}.txt", "READY", 100, "fa", 1,
             "public", 0.9, "{}"))
        chunk_id = str(uuid.uuid4())
        norm = normalize_for_index(n.text)
        conn.execute(
            "INSERT INTO document_chunks (id, document_id, organization_id, department_id,"
            " chunk_index, content, content_normalized, page_number, source_type,"
            " visibility, token_count, metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (chunk_id, doc_id, ORG_ID, DEPT_IDS[0], 0, n.text, norm, 1,
             "document", "public", len(n.text.split()), "{}"))
        if db.vec_available():
            vec = embed_texts([norm], settings.embedding_dim, workers=0)[0]
            conn.execute("INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)",
                         (chunk_id, _to_blob(vec)))
        gold[n.exact_query] = doc_id
        gold["PARA:" + n.paraphrase_query] = doc_id
    return gold


def db_size_bytes() -> int:
    from core.config import settings
    total = 0
    for suffix in ("", "-wal", "-shm"):
        p = Path(str(settings.db_path) + suffix)
        if p.exists():
            total += p.stat().st_size
    return total


def count_rows() -> Dict[str, int]:
    out = {}
    for table in ("documents", "document_chunks"):
        row = db.query_one(f"SELECT COUNT(*) AS c FROM {table}")
        out[table] = row["c"] if row else 0
    try:
        row = db.query_one("SELECT COUNT(*) AS c FROM chunks_vec")
        out["chunks_vec"] = row["c"] if row else 0
    except Exception:
        out["chunks_vec"] = 0
    out["chunks"] = out["document_chunks"]
    return out
