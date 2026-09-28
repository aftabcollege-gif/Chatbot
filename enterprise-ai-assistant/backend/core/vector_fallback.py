"""In-process vector search fallback — works with **zero** native extensions.

The packaged Windows builds used to depend on the ``sqlite-vec`` loadable
extension (``vec0.dll``).  When the DLL is missing, blocked by the loader or
built for a different SQLite ABI, the whole application silently degraded to
keyword-only search and the admin health page reported
``vector_extension: degraded``.

This module implements the tiny subset of the ``vec0`` virtual-table SQL that
the application actually uses on top of a plain SQLite table plus numpy:

============  =====================================================
SQL used by the app                                          handled
============  =====================================================
``INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)``  rewrite
``DELETE FROM knowledge_vec WHERE knowledge_id=?``               rewrite
``SELECT 1 FROM chunks_vec LIMIT 1``                             rewrite
``SELECT <id> [, distance] FROM <vec> WHERE embedding MATCH ?    emulate
  AND k = ?``
============  =====================================================

Emulated queries are answered by a brute-force cosine similarity pass over the
stored float32 blobs.  The rows are materialised into a temporary table so the
callers keep receiving real :class:`sqlite3.Row` objects with the exact column
names they expect (``chunk_id``/``knowledge_id`` and ``distance``).

Everything here is pure Python + numpy, so it works on any platform, offline,
inside a PyInstaller bundle, and needs no compiler or DLL.
"""
from __future__ import annotations

import re
import sqlite3
import threading
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

# vec table -> (id column, backing table for the pure-Python backend)
VEC_TABLES: Dict[str, Tuple[str, str]] = {
    "chunks_vec": ("chunk_id", "chunks_vec_fallback"),
    "knowledge_vec": ("knowledge_id", "knowledge_vec_fallback"),
}

_DDL = """
CREATE TABLE IF NOT EXISTS {store} (
    id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL
);
"""

_INSERT_RE = re.compile(
    r"^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(chunks_vec|knowledge_vec)\s*\(\s*"
    r"(chunk_id|knowledge_id)\s*,\s*embedding\s*\)\s*VALUES\s*\(\s*\?\s*,\s*\?\s*\)",
    re.IGNORECASE | re.DOTALL,
)
_DELETE_RE = re.compile(
    r"^\s*DELETE\s+FROM\s+(chunks_vec|knowledge_vec)\s+WHERE\s+"
    r"(chunk_id|knowledge_id)\s*=\s*\?",
    re.IGNORECASE | re.DOTALL,
)
_PROBE_RE = re.compile(
    r"^\s*SELECT\s+1\s+FROM\s+(chunks_vec|knowledge_vec)\s+LIMIT\s+1",
    re.IGNORECASE | re.DOTALL,
)
_MATCH_RE = re.compile(
    r"SELECT\s+(?P<idcols>.*?)\s+FROM\s+(?P<table>chunks_vec|knowledge_vec)\s+"
    r"WHERE\s+embedding\s+MATCH\s+\?\s+AND\s+k\s*=\s*\?(?P<tail>.*)$",
    re.IGNORECASE | re.DOTALL | re.S,
)

_LOCK = threading.Lock()
# store table -> (row count, ids, unit-norm matrix)
_CACHE: Dict[str, Tuple[int, List[str], np.ndarray]] = {}


def is_fallback_statement(sql: str) -> bool:
    """Cheap pre-filter used by the connection wrapper."""
    lowered = sql.lower()
    return "chunks_vec" in lowered or "knowledge_vec" in lowered


def ensure_tables(conn: sqlite3.Connection) -> None:
    """Create the plain-SQLite backing tables (idempotent)."""
    for _table, (_id_col, store) in VEC_TABLES.items():
        conn.execute(_DDL.format(store=store))


def tables_present(conn: sqlite3.Connection) -> bool:
    try:
        conn.execute("SELECT 1 FROM chunks_vec_fallback LIMIT 1")
        return True
    except sqlite3.Error:
        return False


def invalidate(table: Optional[str] = None) -> None:
    with _LOCK:
        if table is None:
            _CACHE.clear()
        else:
            _CACHE.pop(table, None)


def _as_float32(blob: Any) -> Optional[np.ndarray]:
    if blob is None:
        return None
    if isinstance(blob, memoryview):
        blob = blob.tobytes()
    if isinstance(blob, bytearray):
        blob = bytes(blob)
    if isinstance(blob, str):  # tolerate legacy JSON-encoded vectors
        import json

        try:
            vector = np.asarray(json.loads(blob), dtype=np.float32)
        except Exception:
            return None
        return vector if vector.size else None
    if not isinstance(blob, (bytes,)):
        return None
    if len(blob) % 4 != 0:
        return None
    vector = np.frombuffer(blob, dtype="<f4").astype(np.float32)
    return vector if vector.size else None


def _load_matrix(conn: sqlite3.Connection, store: str) -> Tuple[List[str], Optional[np.ndarray]]:
    rows = conn.execute(f"SELECT id, embedding FROM {store}").fetchall()
    ids: List[str] = []
    vectors: List[np.ndarray] = []
    for row in rows:
        vector = _as_float32(row[1])
        if vector is None:
            continue
        ids.append(str(row[0]))
        vectors.append(vector)
    if not vectors:
        return [], None
    dim = min(v.shape[0] for v in vectors)
    matrix = np.vstack([v[:dim] for v in vectors]).astype(np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return ids, matrix / norms


def _cached_matrix(conn: sqlite3.Connection, store: str) -> Tuple[List[str], Optional[np.ndarray]]:
    count = int(conn.execute(f"SELECT COUNT(*) FROM {store}").fetchone()[0])
    with _LOCK:
        cached = _CACHE.get(store)
    if cached is not None and cached[0] == count:
        return cached[1], cached[2]
    ids, matrix = _load_matrix(conn, store)
    with _LOCK:
        _CACHE[store] = (count, ids, matrix)
    return ids, matrix


def search(
    conn: sqlite3.Connection, table: str, query_blob: Any, k: int
) -> List[Tuple[str, float]]:
    """Brute-force cosine search; returns ``(id, distance)`` sorted ascending."""
    id_col, store = VEC_TABLES[table]
    query = _as_float32(query_blob)
    if query is None or k <= 0:
        return []
    ids, matrix = _cached_matrix(conn, store)
    if matrix is None or not ids:
        return []
    dim = min(query.shape[0], matrix.shape[1])
    q = query[:dim].astype(np.float32)
    norm = float(np.linalg.norm(q))
    if norm == 0:
        return []
    similarity = matrix[:, :dim] @ (q / norm)
    take = min(k, similarity.shape[0])
    order = np.argsort(-similarity)[:take]
    return [(ids[int(i)], float(1.0 - similarity[int(i)])) for i in order]


def _materialise(conn: sqlite3.Connection, hits: Sequence[Tuple[str, float]]) -> None:
    """Expose the emulated hits through a temp table so callers get real Rows."""
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS _vec_hits (id TEXT, distance REAL)"
    )
    conn.execute("DELETE FROM _vec_hits")
    if hits:
        conn.executemany("INSERT INTO _vec_hits (id, distance) VALUES (?, ?)", list(hits))


def handle(
    conn: sqlite3.Connection, sql: str, params: Sequence[Any]
) -> Optional[sqlite3.Cursor]:
    """Emulate a vec0 statement.  Returns a cursor, or ``None`` when the
    statement is not a vec statement (the caller then runs it as-is)."""
    if not is_fallback_statement(sql):
        return None

    match = _INSERT_RE.match(sql)
    if match:
        table, id_col = match.group(1).lower(), match.group(2).lower()
        store = VEC_TABLES[table][1]
        rewritten = re.sub(
            rf"INTO\s+{table}\s*\(\s*{id_col}\s*,\s*embedding\s*\)",
            f"INTO {store} (id, embedding)",
            sql,
            count=1,
            flags=re.IGNORECASE,
        )
        cursor = sqlite3.Connection.execute(conn, rewritten, tuple(params))
        invalidate(store)
        return cursor

    match = _DELETE_RE.match(sql)
    if match:
        table, id_col = match.group(1).lower(), match.group(2).lower()
        store = VEC_TABLES[table][1]
        rewritten = re.sub(
            rf"FROM\s+{table}\s+WHERE\s+{id_col}",
            f"FROM {store} WHERE id",
            sql,
            count=1,
            flags=re.IGNORECASE,
        )
        cursor = sqlite3.Connection.execute(conn, rewritten, tuple(params))
        invalidate(store)
        return cursor

    if _PROBE_RE.match(sql):
        store = VEC_TABLES[_PROBE_RE.match(sql).group(1).lower()][1]
        return sqlite3.Connection.execute(conn, f"SELECT 1 FROM {store} LIMIT 1")

    match = _MATCH_RE.search(sql)
    if match:
        table = match.group("table").lower()
        id_col = VEC_TABLES[table][0]
        args = list(params or [])
        blob = args[0] if args else None
        k = int(args[1]) if len(args) > 1 else 10
        hits = search(conn, table, blob, k)
        _materialise(conn, hits)
        select_list = match.group("idcols")
        # ``chunk_id AS hit_id`` -> ``id AS hit_id``; a bare ``chunk_id`` keeps
        # its name through an explicit alias so callers still find the column.
        select_list = re.sub(
            rf"(?<![\w.]){id_col}(?=\s+AS\s)", "id", select_list, flags=re.IGNORECASE
        )
        select_list = re.sub(
            rf"(?<![\w.]){id_col}(?![\w\s]*\bAS\b)(?![\w])",
            f"id AS {id_col}",
            select_list,
            flags=re.IGNORECASE,
        )
        rewritten = f"SELECT {select_list} FROM _vec_hits"
        return sqlite3.Connection.execute(conn, rewritten, ())

    return None
