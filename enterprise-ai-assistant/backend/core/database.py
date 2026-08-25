"""SQLite database engine, extension loading and schema bootstrap."""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable, List, Optional, Sequence

from .config import settings

_LOCAL = threading.local()

SCHEMA_VERSION = 1


def _sqlite_vec_path() -> Optional[Path]:
    """Locate the sqlite-vec loadable extension shipped with the pip package."""
    try:
        import sqlite_vec  # type: ignore

        raw = Path(sqlite_vec.loadable_path())
        # The package ships the extension without a suffix on some platforms.
        candidates = [raw]
        if raw.suffix == "":
            candidates.extend(
                [raw.with_suffix(".dll"), raw.with_suffix(".so"), raw.with_suffix(".dylib")]
            )
        for c in candidates:
            if c.exists():
                return c
    except Exception:
        pass
    # Fallback: extensions dir next to the app
    for ext in settings.extensions_dir.glob("sqlite_vec*"):
        return ext
    return None


def _connect() -> sqlite3.Connection:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        str(settings.db_path),
        detect_types=sqlite3.PARSE_DECLTYPES,
        check_same_thread=False,
        timeout=30.0,
        isolation_level=None,  # autocommit; we manage transactions explicitly
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-64000")
    conn.execute("PRAGMA mmap_size=268435456")

    vec_path = _sqlite_vec_path()
    if vec_path is not None:
        try:
            conn.enable_load_extension(True)
            conn.load_extension(str(vec_path))
            conn.enable_load_extension(False)
        except sqlite3.OperationalError:
            # Extension may fail on unusual platforms; degrade gracefully.
            pass
    return conn


def get_conn() -> sqlite3.Connection:
    conn = getattr(_LOCAL, "conn", None)
    if conn is None:
        conn = _connect()
        _LOCAL.conn = conn
    return conn


# SQLAlchemy engine (kept for ORM-style models / compatibility). It reuses the
# same file and pragmas.
_engine = None


def get_sa_engine():
    global _engine
    if _engine is None:
        from sqlalchemy import create_engine, event

        url = f"sqlite:///{settings.db_path}"
        _engine = create_engine(
            url,
            connect_args={"check_same_thread": False},
            future=True,
        )

        @event.listens_for(_engine, "connect")
        def _set_sqlite_pragma(dbapi_conn, _rec):  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            vec = _sqlite_vec_path()
            if vec is not None:
                try:
                    dbapi_conn.enable_load_extension(True)
                    dbapi_conn.load_extension(str(vec))
                except Exception:
                    pass
            cur.close()

    return _engine


# --------------------------------------------------------------------------- #
# Query helpers
# --------------------------------------------------------------------------- #
def query_one(sql: str, params: Sequence[Any] = ()) -> Optional[sqlite3.Row]:
    return get_conn().execute(sql, params).fetchone()


def query_all(sql: str, params: Sequence[Any] = ()) -> List[sqlite3.Row]:
    return list(get_conn().execute(sql, params).fetchall())


def execute(sql: str, params: Sequence[Any] = ()) -> sqlite3.Cursor:
    return get_conn().execute(sql, params)


def executemany(sql: str, seq_of_params: Iterable[Sequence[Any]]) -> sqlite3.Cursor:
    return get_conn().executemany(sql, seq_of_params)


def insert_and_pk(table: str, data: dict, pk: str = "id") -> str:
    cols = list(data.keys())
    placeholders = ",".join("?" for _ in cols)
    sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders})"
    cur = execute(sql, [data[c] for c in cols])
    row = query_one(f"SELECT * FROM {table} WHERE rowid=?", (cur.lastrowid,))
    return row[pk] if row else str(cur.lastrowid)


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[dict]:
    return dict(row) if row is not None else None


# --------------------------------------------------------------------------- #
# Schema bootstrap
# --------------------------------------------------------------------------- #
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    settings TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES departments(id),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    department_id TEXT REFERENCES departments(id),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_path TEXT,
    is_active INTEGER DEFAULT 1,
    is_superadmin INTEGER DEFAULT 0,
    failed_login_count INTEGER DEFAULT 0,
    locked_until TEXT,
    last_login TEXT,
    preferences TEXT DEFAULT '{"theme":"dark","language":"fa","calendar":"jalali"}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    name TEXT NOT NULL,
    description TEXT,
    is_system INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    code TEXT UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resource_folders (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    department_id TEXT REFERENCES departments(id),
    parent_id TEXT REFERENCES resource_folders(id),
    name TEXT NOT NULL,
    owner_id TEXT REFERENCES users(id),
    visibility TEXT DEFAULT 'private',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    department_id TEXT REFERENCES departments(id),
    folder_id TEXT REFERENCES resource_folders(id),
    owner_id TEXT REFERENCES users(id),
    title TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INTEGER,
    file_hash TEXT,
    storage_path TEXT NOT NULL,
    status TEXT DEFAULT 'UPLOADED',
    processing_progress INTEGER DEFAULT 0,
    processing_error TEXT,
    language TEXT,
    page_count INTEGER,
    visibility TEXT DEFAULT 'private',
    authority_score REAL DEFAULT 0.8,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    file_size_bytes INTEGER,
    file_hash TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_chunks (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    organization_id TEXT,
    department_id TEXT,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_normalized TEXT,
    page_number INTEGER,
    section TEXT,
    heading TEXT,
    source_type TEXT,
    visibility TEXT,
    token_count INTEGER,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    content_normalized,
    heading,
    section,
    content='document_chunks',
    content_rowid='rowid',
    tokenize='unicode61'
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
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    permissions TEXT NOT NULL,
    inherited INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS web_sources (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    domain TEXT NOT NULL,
    allowed_paths TEXT DEFAULT '["/"]',
    crawl_depth INTEGER DEFAULT 2,
    refresh_hours INTEGER DEFAULT 24,
    is_active INTEGER DEFAULT 1,
    last_crawled_at TEXT,
    pages_count INTEGER DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS web_pages (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    web_source_id TEXT REFERENCES web_sources(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    content TEXT,
    content_normalized TEXT,
    status TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    organization_id TEXT REFERENCES organizations(id),
    department_id TEXT REFERENCES departments(id),
    owner_id TEXT REFERENCES users(id),
    title TEXT NOT NULL,
    subject TEXT,
    problem_description TEXT NOT NULL,
    action_taken TEXT NOT NULL,
    result TEXT,
    lesson_learned TEXT NOT NULL,
    suggestion TEXT,
    visibility TEXT DEFAULT 'department',
    status TEXT DEFAULT 'DRAFT',
    reviewed_by TEXT REFERENCES users(id),
    reviewed_at TEXT,
    approved_by TEXT REFERENCES users(id),
    approved_at TEXT,
    published_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_tags (
    knowledge_id TEXT REFERENCES knowledge_items(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (knowledge_id, tag)
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    title,
    problem_description,
    action_taken,
    lesson_learned,
    suggestion,
    content='knowledge_items',
    content_rowid='rowid',
    tokenize='unicode61'
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
    organization_id TEXT,
    title TEXT,
    is_pinned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    scope TEXT DEFAULT 'all',
    scope_id TEXT,
    confidence_score REAL,
    response_time_ms INTEGER,
    token_count INTEGER,
    feedback TEXT,
    feedback_reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_sources (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    chunk_id TEXT,
    page_number INTEGER,
    section TEXT,
    heading TEXT,
    relevance_score REAL,
    citation_index INTEGER
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    event_code TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    resource_type TEXT,
    resource_id TEXT,
    resource_name TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_code, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS setup_status (
    id INTEGER PRIMARY KEY DEFAULT 1,
    completed INTEGER DEFAULT 0,
    current_step INTEGER DEFAULT 1,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    job_type TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    payload TEXT DEFAULT '{}',
    result TEXT,
    error TEXT,
    progress INTEGER DEFAULT 0,
    created_by TEXT,
    started_at TEXT,
    completed_at TEXT,
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

VEC_SQL_CHUNKS = """
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
    chunk_id TEXT PRIMARY KEY,
    embedding float[{dim}]
);
"""

VEC_SQL_KNOWLEDGE = """
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
    knowledge_id TEXT PRIMARY KEY,
    embedding float[{dim}]
);
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


def init_db() -> None:
    conn = get_conn()
    conn.executescript(SCHEMA_SQL)
    # Vector tables require the sqlite-vec extension loaded.
    try:
        conn.execute(VEC_SQL_CHUNKS.format(dim=settings.embedding_dim))
        conn.execute(VEC_SQL_KNOWLEDGE.format(dim=settings.embedding_dim))
    except sqlite3.OperationalError:
        # sqlite-vec unavailable — semantic search will degrade to FTS only.
        pass
    # Seed permissions.
    for code, desc in PERMISSION_SEED:
        conn.execute(
            "INSERT OR IGNORE INTO permissions (code, description) VALUES (?, ?)",
            (code, desc),
        )
    # Seed default system settings.
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


def vec_available() -> bool:
    try:
        get_conn().execute("SELECT 1 FROM chunks_vec LIMIT 1")
        return True
    except sqlite3.OperationalError:
        return False
