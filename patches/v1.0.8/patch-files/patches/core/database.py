"""SQLite database engine - v1.0.8 numpy vector backend.

Replaces sqlite-vec with a numpy in-memory cosine index. Numpy is imported
lazily so that even if sitecustomize runs early in PyInstaller bootstrap
(before numpy/pyd DLL search paths are finalized), the patch module still
loads and numpy resolves on first actual use.

We intercept legacy sqlite-vec SQL (``embedding MATCH ? AND k=?`` and
``INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?,?)``) at the
connection wrapper so unpatched frozen code continues to work.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .config import settings

_LOCAL = threading.local()
_LOG_LOCK = threading.Lock()
_LOG_PATH = settings.appdata / "logs" / "patch-v1.0.8.log"


def _log(msg: str) -> None:
    try:
        _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _LOG_LOCK:
            with open(_LOG_PATH, "a", encoding="utf-8") as f:
                f.write(msg.rstrip() + "\n")
    except Exception:
        pass


_log(f"[patch-db] module loading, __file__={__file__}")

_np = None
_np_err: Optional[str] = None
_NP_TRIED = False


def _get_np():
    global _np, _np_err, _NP_TRIED
    if _np is not None:
        return _np
    if _NP_TRIED:
        return None
    _NP_TRIED = True
    try:
        import numpy as _np_mod
        _np = _np_mod
        _log(f"[patch-db] numpy {_np.__version__} import OK")
        return _np
    except Exception as e:
        _np_err = f"{type(e).__name__}: {e}"
        _log(f"[patch-db] numpy import FAILED: {_np_err}")
        return None


SCHEMA_VERSION = 2

VECTOR_DDL: Dict[str, str] = {
    "chunks_vec": """
        CREATE TABLE IF NOT EXISTS chunks_vec (
            chunk_id TEXT PRIMARY KEY,
            dim INTEGER NOT NULL,
            embedding BLOB NOT NULL
        )
    """,
    "knowledge_vec": """
        CREATE TABLE IF NOT EXISTS knowledge_vec (
            knowledge_id TEXT PRIMARY KEY,
            dim INTEGER NOT NULL,
            embedding BLOB NOT NULL
        )
    """,
}

_VEC_INSERT_RE = re.compile(
    r"^\s*INSERT(?:\s+OR\s+(?:REPLACE|IGNORE))?\s+INTO\s+(chunks_vec|knowledge_vec)\s*\(\s*(chunk_id|knowledge_id)\s*,\s*embedding\s*\)\s*VALUES\s*\(\s*\?\s*,\s*\?\s*\)",
    re.IGNORECASE,
)
_VEC_INSERT_DIM_RE = re.compile(
    r"^\s*INSERT(?:\s+OR\s+(?:REPLACE|IGNORE))?\s+INTO\s+(chunks_vec|knowledge_vec)\s*\(\s*(chunk_id|knowledge_id)\s*,\s*dim\s*,\s*embedding\s*\)\s*VALUES\s*\(\s*\?\s*,\s*\?\s*,\s*\?\s*\)",
    re.IGNORECASE,
)
_VEC_DELETE_RE = re.compile(
    r"^\s*DELETE\s+FROM\s+(chunks_vec|knowledge_vec)\s+WHERE\s+(chunk_id|knowledge_id)\s*=\s*\?",
    re.IGNORECASE,
)
_VEC_MATCH_RE = re.compile(
    r"^\s*SELECT\b.*?\bFROM\s+(chunks_vec|knowledge_vec)\b\s+WHERE\s+embedding\s+MATCH\s*\?\s+AND\s+k\s*=\s*\?",
    re.IGNORECASE | re.DOTALL,
)
_VEC0_DDL_RE = re.compile(
    r"CREATE\s+VIRTUAL\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(chunks_vec|knowledge_vec)\s+USING\s+vec0",
    re.IGNORECASE,
)


class _VectorIndex:
    def __init__(self, table: str, pk_col: str):
        self.table = table
        self.pk_col = pk_col
        self._lock = threading.RLock()
        self._ids: List[Any] = []
        self._id_to_pos: Dict[Any, int] = {}
        self._mat: Optional[Any] = None
        self._dim: Optional[int] = None

    def _blob_to_vec(self, blob: bytes):
        np = _get_np()
        if np is None:
            return None
        return np.frombuffer(blob, dtype=np.float32)

    def _normalize(self, v):
        np = _get_np()
        if np is None:
            return v
        n = float(np.linalg.norm(v))
        if n > 0:
            return (v / n).astype(np.float32)
        return v.astype(np.float32)

    def load(self, conn) -> None:
        np = _get_np()
        with self._lock:
            self._ids = []
            self._id_to_pos = {}
            if np is None:
                self._mat = None
                self._dim = None
                _log(f"[patch-db] {self.table}: numpy not available, index stays empty")
                return
            try:
                rows = conn.execute(
                    f"SELECT {self.pk_col}, dim, embedding FROM {self.table}"
                ).fetchall()
            except sqlite3.OperationalError as e:
                self._mat = None
                self._dim = None
                _log(f"[patch-db] {self.table} load error: {e}")
                return
            if not rows:
                self._mat = None
                self._dim = None
                _log(f"[patch-db] {self.table}: empty")
                return
            dim0 = int(rows[0]["dim"])
            self._dim = dim0
            vecs = []
            for r in rows:
                try:
                    v = np.frombuffer(r["embedding"], dtype=np.float32)
                except Exception:
                    continue
                if v.shape[0] != dim0:
                    continue
                vecs.append(self._normalize(v))
                self._ids.append(r[self.pk_col])
                self._id_to_pos[r[self.pk_col]] = len(self._ids) - 1
            if vecs:
                self._mat = np.stack(vecs, axis=0)
            else:
                self._mat = None
            _log(f"[patch-db] loaded {self.table}: {len(self._ids)} vectors dim={self._dim}")

    def upsert_blob(self, pk: Any, blob: bytes, dim: Optional[int] = None) -> None:
        np = _get_np()
        inner = _get_inner_conn()
        with self._lock:
            if np is None:
                # No numpy: at least persist the BLOB so a future reload works.
                d = dim if dim is not None else (len(blob) // 4 if blob else 0)
                if d:
                    try:
                        inner.execute(
                            f"INSERT INTO {self.table} ({self.pk_col}, dim, embedding) VALUES (?,?,?)\n"
                            f"ON CONFLICT({self.pk_col}) DO UPDATE SET dim=excluded.dim, embedding=excluded.embedding",
                            (pk, d, blob),
                        )
                    except Exception as e:
                        _log(f"[patch-db] upsert_blob fallback insert failed: {e}")
                return
            v = np.frombuffer(blob, dtype=np.float32)
            if v.size == 0:
                return
            d = int(v.shape[0])
            vn = self._normalize(v)
            inner.execute(
                f"INSERT INTO {self.table} ({self.pk_col}, dim, embedding) VALUES (?,?,?)\n"
                f"ON CONFLICT({self.pk_col}) DO UPDATE SET dim=excluded.dim, embedding=excluded.embedding",
                (pk, d, vn.tobytes()),
            )
            if self._mat is None or self._dim != d:
                self.load(inner)
                return
            pos = self._id_to_pos.get(pk)
            if pos is None:
                self._ids.append(pk)
                self._id_to_pos[pk] = self._mat.shape[0]
                self._mat = np.vstack([self._mat, vn.reshape(1, -1)])
            else:
                self._mat[pos] = vn

    def upsert(self, pk: Any, vector: Sequence[float]) -> None:
        np = _get_np()
        if np is None:
            # Store raw float32 blob for later reload.
            import struct
            self.upsert_blob(pk, struct.pack(f"{len(vector)}f", *vector))
            return
        self.upsert_blob(pk, np.asarray(vector, dtype=np.float32).tobytes())

    def delete(self, pk: Any) -> None:
        np = _get_np()
        inner = _get_inner_conn()
        with self._lock:
            inner.execute(f"DELETE FROM {self.table} WHERE {self.pk_col}=?", (pk,))
            if np is None or self._mat is None:
                return
            pos = self._id_to_pos.get(pk)
            if pos is not None:
                mask = np.ones(self._mat.shape[0], dtype=bool)
                mask[pos] = False
                self._mat = self._mat[mask]
                self._ids = [x for i, x in enumerate(self._ids) if mask[i]]
                self._id_to_pos = {x: i for i, x in enumerate(self._ids)}

    def search_blob(self, blob: bytes, k: int):
        np = _get_np()
        with self._lock:
            if np is None or self._mat is None or self._mat.shape[0] == 0:
                return []
            q = np.frombuffer(blob, dtype=np.float32)
            if self._dim is None or q.shape[0] != self._dim:
                return []
            q = self._normalize(q)
            scores = self._mat @ q
            k_eff = min(k, scores.shape[0])
            if k_eff <= 0:
                return []
            if k_eff >= scores.shape[0]:
                idx = np.argsort(-scores)
            else:
                part = np.argpartition(-scores, k_eff - 1)[:k_eff]
                idx = part[np.argsort(-scores[part])]
            out = []
            for i in idx:
                out.append((self._ids[int(i)], float(1.0 - scores[int(i)])))
            return out

    @property
    def size(self) -> int:
        return 0 if self._mat is None else int(self._mat.shape[0])


_chunks_idx: Optional[_VectorIndex] = None
_knowledge_idx: Optional[_VectorIndex] = None
_idx_lock = threading.Lock()


def _chunks_index() -> _VectorIndex:
    global _chunks_idx
    with _idx_lock:
        if _chunks_idx is None:
            _chunks_idx = _VectorIndex("chunks_vec", "chunk_id")
            inner = _get_inner_conn()
            inner.execute(VECTOR_DDL["chunks_vec"])
            _chunks_idx.load(inner)
        return _chunks_idx


def _knowledge_index() -> _VectorIndex:
    global _knowledge_idx
    with _idx_lock:
        if _knowledge_idx is None:
            _knowledge_idx = _VectorIndex("knowledge_vec", "knowledge_id")
            inner = _get_inner_conn()
            inner.execute(VECTOR_DDL["knowledge_vec"])
            _knowledge_idx.load(inner)
        return _knowledge_idx


def _idx_for(table: str) -> Optional[_VectorIndex]:
    if table == "chunks_vec":
        return _chunks_index()
    if table == "knowledge_vec":
        return _knowledge_index()
    return None


class _VecRow:
    __slots__ = ("_keys", "_data")

    def __init__(self, keys, values):
        self._keys = tuple(keys)
        self._data = tuple(values)

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._data[key]
        try:
            return self._data[self._keys.index(key)]
        except ValueError:
            raise KeyError(key)

    def keys(self):
        return list(self._keys)


class _VecCursor:
    def __init__(self, rows):
        self._rows = list(rows)
        self._iter = iter(self._rows)
        self.lastrowid = None
        self.rowcount = len(self._rows)

    def fetchone(self):
        try:
            return next(self._iter)
        except StopIteration:
            return None

    def fetchall(self):
        rest = list(self._iter)
        return self._rows

    def __iter__(self):
        return iter(self._rows)

    def __next__(self):
        return next(self._iter)


class _VecConnWrapper:
    def __init__(self, inner):
        object.__setattr__(self, "_inner", inner)

    def __getattr__(self, name):
        return getattr(self._inner, name)

    def __setattr__(self, name, value):
        setattr(self._inner, name, value)

    def execute(self, sql, params=()):
        s = (sql or "").strip()
        m0 = _VEC0_DDL_RE.search(s)
        if m0:
            tbl = m0.group(1).lower()
            return self._inner.execute(VECTOR_DDL[tbl])
        m_id = _VEC_INSERT_DIM_RE.match(s)
        if m_id:
            tbl = m_id.group(1).lower()
            pk_col = m_id.group(2).lower()
            p = list(params)
            _idx_for(tbl).upsert_blob(p[0], bytes(p[2]) if isinstance(p[2], (bytes, bytearray, memoryview)) else p[2], dim=int(p[1]))
            c = self._inner.execute("SELECT last_insert_rowid() AS rid")
            rid = c.fetchone()["rid"]
            cur = _VecCursor([])
            cur.lastrowid = rid
            return cur
        m_ins = _VEC_INSERT_RE.match(s)
        if m_ins:
            tbl = m_ins.group(1).lower()
            params = list(params)
            blob = params[1]
            _idx_for(tbl).upsert_blob(
                params[0],
                bytes(blob) if isinstance(blob, (bytes, bytearray, memoryview)) else blob,
            )
            c = self._inner.execute("SELECT last_insert_rowid() AS rid")
            rid = c.fetchone()["rid"]
            cur = _VecCursor([])
            cur.lastrowid = rid
            return cur
        m_del = _VEC_DELETE_RE.match(s)
        if m_del:
            tbl = m_del.group(1).lower()
            _idx_for(tbl).delete(list(params)[0])
            return self._inner.execute("SELECT changes() AS c")
        m_mat = _VEC_MATCH_RE.match(s)
        if m_mat:
            tbl = m_mat.group(1).lower()
            pk_col = "chunk_id" if tbl == "chunks_vec" else "knowledge_id"
            params = list(params)
            out_col = pk_col
            sel = re.match(r"^\s*SELECT\s+(?:DISTINCT\s+)?([^,]+?)\s*,\s*distance\b", s, re.IGNORECASE)
            if sel:
                ex = sel.group(1).strip()
                am = re.search(r"\bAS\s+(\w+)\s*$", ex, re.IGNORECASE)
                if am:
                    out_col = am.group(1)
            blob = params[0]
            k = int(params[1])
            hits = _idx_for(tbl).search_blob(
                bytes(blob) if isinstance(blob, (bytes, bytearray, memoryview))
                else blob, k,
            )
            rows = [_VecRow([out_col, "distance"], (pid, float(d))) for pid, d in hits]
            return _VecCursor(rows)
        return self._inner.execute(sql, params)

    def executemany(self, sql, seq):
        return self._inner.executemany(sql, seq)


def _connect() -> sqlite3.Connection:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        str(settings.db_path),
        detect_types=sqlite3.PARSE_DECLTYPES,
        check_same_thread=False,
        timeout=30.0,
        isolation_level=None,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-64000")
    conn.execute("PRAGMA mmap_size=268435456")
    return conn


def get_conn() -> sqlite3.Connection:
    conn = getattr(_LOCAL, "conn", None)
    if conn is None:
        conn = _VecConnWrapper(_connect())
        _LOCAL.conn = conn
    return conn


def _get_inner_conn():
    w = get_conn()
    return w._inner if isinstance(w, _VecConnWrapper) else w


_engine = None

def get_sa_engine():
    global _engine
    if _engine is None:
        from sqlalchemy import create_engine
        _engine = create_engine(
            f"sqlite:///{settings.db_path}",
            connect_args={"check_same_thread": False},
            future=True,
        )
    return _engine


def query_one(sql: str, params: Sequence[Any] = ()) -> Optional[sqlite3.Row]:
    return get_conn().execute(sql, params).fetchone()


def query_all(sql: str, params: Sequence[Any] = ()) -> List[sqlite3.Row]:
    cur = get_conn().execute(sql, params)
    try:
        return list(cur.fetchall())
    except Exception:
        return list(cur)


def execute(sql: str, params: Sequence[Any] = ()):
    return get_conn().execute(sql, params)


def executemany(sql: str, seq):
    return get_conn().executemany(sql, seq)


def insert_and_pk(table: str, data: dict, pk: str = "id") -> str:
    cols = list(data.keys())
    placeholders = ",".join("?" for _ in cols)
    sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders})"
    cur = execute(sql, [data[c] for c in cols])
    rid = getattr(cur, "lastrowid", None)
    if rid is not None:
        row = query_one(f"SELECT * FROM {table} WHERE rowid=?", (rid,))
        if row:
            return row[pk]
    return str(rid) if rid else ""


def row_to_dict(row):
    return dict(row) if row is not None else None


# ---------- Public vector API ----------
def vec_search(table, pk_col, blob, k, _filters="", _params=()):
    idx = _idx_for(table)
    if idx is None:
        return []
    if isinstance(blob, (bytes, bytearray, memoryview)):
        b = bytes(blob)
    else:
        np = _get_np()
        if np is None:
            return []
        b = np.asarray(blob, dtype=np.float32).tobytes()
    return [{"id": pid, "distance": float(d)} for pid, d in idx.search_blob(b, k)]


def vec_upsert_chunk(chunk_id, vector):
    _chunks_index().upsert(chunk_id, vector)


def vec_upsert_knowledge(kid, vector):
    _knowledge_index().upsert(kid, vector)


def vec_delete_chunk(chunk_id):
    _chunks_index().delete(chunk_id)


def vec_delete_knowledge(kid):
    _knowledge_index().delete(kid)


def vec_available() -> bool:
    # Vector search is "available" once numpy loads. We return True proactively
    # and lazy-import numpy here so if PyInstaller set up DLL paths later
    # than sitecustomize time, we pick numpy up on first health check.
    return _get_np() is not None


def vec_backend() -> str:
    return "numpy" if _get_np() is not None else "unavailable"


def vec_dim():
    return _chunks_index()._dim


def vec_load_error() -> Optional[str]:
    if _get_np() is not None:
        return None
    return _np_err or "numpy not importable"


def vec_loaded_path() -> Optional[str]:
    if _get_np() is not None:
        return "numpy-inmemory"
    return None


# ---------- Schema ----------
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL, description TEXT, settings TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    name TEXT NOT NULL, parent_id TEXT REFERENCES departments(id),
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    department_id TEXT REFERENCES departments(id),
    username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, avatar_path TEXT,
    is_active INTEGER DEFAULT 1, is_superadmin INTEGER DEFAULT 0,
    failed_login_count INTEGER DEFAULT 0, locked_until TEXT, last_login TEXT,
    preferences TEXT DEFAULT '{"theme":"dark","language":"fa","calendar":"jalali"}',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    name TEXT NOT NULL, description TEXT, is_system INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);
CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    code TEXT UNIQUE NOT NULL, description TEXT
);
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT UNIQUE NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS resource_folders (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    department_id TEXT REFERENCES departments(id),
    parent_id TEXT REFERENCES resource_folders(id),
    name TEXT NOT NULL, owner_id TEXT REFERENCES users(id),
    visibility TEXT DEFAULT 'private',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    department_id TEXT REFERENCES departments(id),
    folder_id TEXT REFERENCES resource_folders(id),
    owner_id TEXT REFERENCES users(id),
    title TEXT NOT NULL, original_filename TEXT NOT NULL,
    file_type TEXT NOT NULL, mime_type TEXT,
    file_size_bytes INTEGER, file_hash TEXT, storage_path TEXT NOT NULL,
    status TEXT DEFAULT 'UPLOADED', processing_progress INTEGER DEFAULT 0,
    processing_error TEXT, language TEXT, page_count INTEGER,
    visibility TEXT DEFAULT 'private', authority_score REAL DEFAULT 0.8,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL, storage_path TEXT NOT NULL,
    file_size_bytes INTEGER, file_hash TEXT, created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS document_chunks (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    organization_id TEXT, department_id TEXT, chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL, content_normalized TEXT,
    page_number INTEGER, section TEXT, heading TEXT, source_type TEXT,
    visibility TEXT, token_count INTEGER, metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content, content_normalized, heading, section,
    content='document_chunks', content_rowid='rowid', tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON document_chunks BEGIN
  INSERT INTO chunks_fts(rowid, content, content_normalized, heading, section)
  VALUES (new.rowid, new.content, new.content_normalized, new.heading, new.section);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON document_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content, content_normalized, heading, section)
  VALUES ('delete', old.rowid, old.content, old.content_normalized, old.heading, old.section);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON document_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content, content_normalized, heading, section)
  VALUES ('delete', old.rowid, old.content, old.content_normalized, old.heading, old.section);
  INSERT INTO chunks_fts(rowid, content, content_normalized, heading, section)
  VALUES (new.rowid, new.content, new.content_normalized, new.heading, new.section);
END;
CREATE TABLE IF NOT EXISTS resource_permissions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
    role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    permissions TEXT NOT NULL, inherited INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS web_sources (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    domain TEXT NOT NULL, allowed_paths TEXT DEFAULT '["/"]',
    crawl_depth INTEGER DEFAULT 2, refresh_hours INTEGER DEFAULT 24,
    is_active INTEGER DEFAULT 1, last_crawled_at TEXT, pages_count INTEGER DEFAULT 0,
    created_by TEXT REFERENCES users(id), created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS web_pages (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    web_source_id TEXT REFERENCES web_sources(id) ON DELETE CASCADE,
    url TEXT NOT NULL, title TEXT, content TEXT, content_normalized TEXT,
    status TEXT, metadata TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    department_id TEXT REFERENCES departments(id),
    owner_id TEXT REFERENCES users(id),
    title TEXT NOT NULL, subject TEXT,
    problem_description TEXT NOT NULL, action_taken TEXT NOT NULL,
    result TEXT, lesson_learned TEXT NOT NULL, suggestion TEXT,
    visibility TEXT DEFAULT 'department', status TEXT DEFAULT 'DRAFT',
    reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT,
    approved_by TEXT REFERENCES users(id), approved_at TEXT, published_at TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS knowledge_tags (
    knowledge_id TEXT REFERENCES knowledge_items(id) ON DELETE CASCADE,
    tag TEXT NOT NULL, PRIMARY KEY (knowledge_id, tag)
);
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    title, problem_description, action_taken, lesson_learned, suggestion,
    content='knowledge_items', content_rowid='rowid', tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge_items BEGIN
  INSERT INTO knowledge_fts(rowid, title, problem_description, action_taken, lesson_learned, suggestion)
  VALUES (new.rowid, new.title, new.problem_description, new.action_taken, new.lesson_learned, new.suggestion);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge_items BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, problem_description, action_taken, lesson_learned, suggestion)
  VALUES ('delete', old.rowid, old.title, old.problem_description, old.action_taken, old.lesson_learned, old.suggestion);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge_items BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, problem_description, action_taken, lesson_learned, suggestion)
  VALUES ('delete', old.rowid, old.title, old.problem_description, old.action_taken, old.lesson_learned, old.suggestion);
  INSERT INTO knowledge_fts(rowid, title, problem_description, action_taken, lesson_learned, suggestion)
  VALUES (new.rowid, new.title, new.problem_description, new.action_taken, new.lesson_learned, new.suggestion);
END;
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT, title TEXT, is_pinned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, scope TEXT DEFAULT 'all', scope_id TEXT,
    confidence_score REAL, response_time_ms INTEGER, token_count INTEGER,
    feedback TEXT, feedback_reason TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS message_sources (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL, source_id TEXT NOT NULL,
    chunk_id TEXT, page_number INTEGER, section TEXT, heading TEXT,
    relevance_score REAL, citation_index INTEGER
);
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    event_code TEXT NOT NULL, actor_id TEXT, actor_name TEXT,
    resource_type TEXT, resource_id TEXT, resource_name TEXT,
    metadata TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_code, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS setup_status (
    id INTEGER PRIMARY KEY DEFAULT 1, completed INTEGER DEFAULT 0,
    current_step INTEGER DEFAULT 1, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    job_type TEXT NOT NULL, status TEXT DEFAULT 'PENDING',
    payload TEXT DEFAULT '{}', result TEXT, error TEXT, progress INTEGER DEFAULT 0,
    created_by TEXT, started_at TEXT, completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(file_hash);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_org ON document_chunks(organization_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON processing_jobs(status);
INSERT OR IGNORE INTO setup_status (id, completed, current_step) VALUES (1, 0, 1);
"""

PERMISSION_SEED = [
    ("chat.use", "دسترسی به گفتگو"),
    ("resources.view", "مشاهده منابع"),
    ("resources.upload", "بارگذاری سند"),
    ("resources.manage", "مدیریت منابع"),
    ("knowledge.view", "مشاهده دانش"),
    ("knowledge.create", "ایجاد تجربه"),
    ("knowledge.approve", "تأیید تجربیات"),
    ("admin.users", "مدیریت کاربران"),
    ("admin.roles", "مدیریت نقش‌ها"),
    ("admin.settings", "تنظیمات سیستم"),
    ("admin.logs", "مشاهده لاگ‌ها"),
    ("admin.web", "مدیریت منابع وب"),
]


def _migrate_from_sqlite_vec(conn) -> None:
    def _is_vec0(name):
        try:
            row = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (name,)
            ).fetchone()
        except sqlite3.OperationalError:
            return False
        if not row or not row["sql"]:
            return False
        return "using vec0" in row["sql"].lower()

    for vec_table, plain_table, pk in (
        ("chunks_vec", "chunks_vec", "chunk_id"),
        ("knowledge_vec", "knowledge_vec", "knowledge_id"),
    ):
        if not _is_vec0(vec_table):
            continue
        try:
            rows = conn.execute(f"SELECT {pk}, embedding FROM {vec_table}").fetchall()
        except sqlite3.OperationalError:
            rows = []
        try:
            conn.execute(f"DROP TABLE IF EXISTS {vec_table}")
        except sqlite3.OperationalError:
            pass
        conn.execute(VECTOR_DDL[plain_table])
        ins = 0
        for r in rows or []:
            blob = r["embedding"]
            if not blob or len(blob) % 4 != 0:
                continue
            try:
                conn.execute(
                    f"INSERT OR IGNORE INTO {plain_table} ({pk}, dim, embedding) VALUES (?,?,?)",
                    (r[pk], len(blob)//4, blob),
                )
                ins += 1
            except sqlite3.OperationalError:
                break
        if ins:
            _log(f"[patch-db] migrated {ins} vec0 vectors -> {plain_table}")


def init_db() -> None:
    conn = get_conn()
    conn.executescript(SCHEMA_SQL)
    conn.execute(VECTOR_DDL["chunks_vec"])
    conn.execute(VECTOR_DDL["knowledge_vec"])
    try:
        _migrate_from_sqlite_vec(conn)
    except Exception as e:
        _log(f"[patch-db] migration skipped: {e}")
    _chunks_index()
    _knowledge_index()
    for code, desc in PERMISSION_SEED:
        conn.execute(
            "INSERT OR IGNORE INTO permissions (code, description) VALUES (?, ?)",
            (code, desc),
        )
    defaults = {
        "allow_registration": ("false", "اجازه ثبت‌نام خودکار"),
        "retrieval_top_k": (str(settings.rag_retrieval_top_k), "تعداد نتایج بازیابی"),
        "llm_temperature": (str(settings.llm_temperature), "دمای مدل"),
    }
    for key, (val, desc) in defaults.items():
        conn.execute(
            "INSERT OR IGNORE INTO system_settings (key, value, description) VALUES (?, ?, ?)",
            (key, val, desc),
        )
    conn.execute(
        "INSERT OR IGNORE INTO system_settings (key, value, description) VALUES (?, ?, ?)",
        ("schema_version", str(SCHEMA_VERSION), "نسخه طرحواره دیتابیس"),
    )
    # Marker file so users can verify patch applied.
    try:
        marker = settings.appdata / "patch-v1.0.8-applied.txt"
        marker.write_text(
            f"v1.0.8 numpy vector backend active.\n"
            f"numpy_ok={_get_np() is not None}\n"
            f"log={_LOG_PATH}\n",
            encoding="utf-8",
        )
    except Exception:
        pass
    _log("[patch-db] init_db complete, numpy_ok=%s" % (_get_np() is not None))
