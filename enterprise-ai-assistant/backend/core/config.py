"""Application configuration loaded from YAML with environment overrides."""
from __future__ import annotations

import os
import secrets
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

import yaml


def _app_root() -> Path:
    """Root install directory.

    Resolution order:
      1. ``EAI_ROOT`` env var — set by the desktop shell to point the frozen
         backend at the bundled resources directory (which contains config/,
         frontend/dist, models/, llm/, extensions/). This is what makes the
         packaged app find its assets on an offline machine.
      2. When frozen by PyInstaller, the directory containing the executable
         (sys._MEIPASS is for bundled temp data; large assets like models live
         next to the executable / in the install dir).
      3. Source checkout: backend/core/config.py -> backend -> root.
    """
    env_root = os.environ.get("EAI_ROOT")
    if env_root:
        return Path(env_root)
    if getattr(__import__("sys"), "frozen", False):
        return Path(__import__("sys").executable).resolve().parent
    # backend/core/config.py -> backend -> root
    return Path(__file__).resolve().parent.parent.parent


def _default_appdata() -> Path:
    base = os.environ.get("APPDATA")
    if base:
        return Path(base) / "EnterpriseAI"
    # Linux/macOS fallback (dev/demo)
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "EnterpriseAI"


class Config:
    def __init__(self) -> None:
        self.root = _app_root()
        self._data: Dict[str, Any] = {}
        self._load_yaml()
        self.appdata = _default_appdata()
        self.appdata.mkdir(parents=True, exist_ok=True)
        (self.appdata / "data").mkdir(parents=True, exist_ok=True)
        (self.appdata / "storage" / "documents").mkdir(parents=True, exist_ok=True)
        (self.appdata / "storage" / "avatars").mkdir(parents=True, exist_ok=True)
        (self.appdata / "logs").mkdir(parents=True, exist_ok=True)
        (self.appdata / "cache").mkdir(parents=True, exist_ok=True)
        (self.appdata / "backups").mkdir(parents=True, exist_ok=True)

        self._secrets_file = self.appdata / "config" / ".secrets"
        self._secrets_file.parent.mkdir(parents=True, exist_ok=True)
        self.jwt_secret = self._resolve_secret(
            self.get("auth.jwt_secret", ""), "JWT_SECRET"
        )
        self.jwt_refresh_secret = self._resolve_secret(
            self.get("auth.jwt_refresh_secret", ""), "JWT_REFRESH_SECRET"
        )

    def _load_yaml(self) -> None:
        for candidate in (
            self.root / "config" / "default.yaml",
            Path(__file__).resolve().parent.parent.parent / "config" / "default.yaml",
        ):
            if candidate.exists():
                with open(candidate, "r", encoding="utf-8") as fh:
                    self._data = yaml.safe_load(fh) or {}
                self.config_path = candidate
                return
        self.config_path = None
        self._data = {}

    def get(self, dotted: str, default: Any = None) -> Any:
        node: Any = self._data
        for part in dotted.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node

    def _resolve_secret(self, configured: str, env_key: str) -> str:
        env_val = os.environ.get(env_key)
        if env_val:
            return env_val
        if configured and not configured.startswith("CHANGE_THIS"):
            return configured
        # Generate and persist a strong random secret on first run.
        secrets_map: Dict[str, str] = {}
        if self._secrets_file.exists():
            for line in self._secrets_file.read_text(encoding="utf-8").splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    secrets_map[k.strip()] = v.strip()
        if env_key not in secrets_map:
            secrets_map[env_key] = secrets.token_urlsafe(48)
            self._secrets_file.write_text(
                "\n".join(f"{k}={v}" for k, v in secrets_map.items()),
                encoding="utf-8",
            )
            try:
                os.chmod(self._secrets_file, 0o600)
            except OSError:
                pass
        return secrets_map[env_key]

    # ---- Convenience accessors ---------------------------------------------
    @property
    def app_name(self) -> str:
        return self.get("app.name", "دستیار هوشمند سازمانی")

    @property
    def app_version(self) -> str:
        return self.get("app.version", "1.0.0")

    @property
    def host(self) -> str:
        return os.environ.get("APP_HOST", self.get("app.host", "127.0.0.1"))

    @property
    def port(self) -> int:
        return int(os.environ.get("APP_PORT", self.get("app.port", 8741)))

    @property
    def language(self) -> str:
        return self.get("app.language", "fa")

    @property
    def theme(self) -> str:
        return self.get("app.theme", "dark")

    def model_abspath(self, rel: str) -> Path:
        p = Path(rel)
        if p.is_absolute():
            return p
        return self.root / rel

    # Auth
    @property
    def jwt_expiry_minutes(self) -> int:
        return int(self.get("auth.jwt_expiry_minutes", 60))

    @property
    def jwt_refresh_days(self) -> int:
        return int(self.get("auth.jwt_refresh_days", 7))

    @property
    def max_login_attempts(self) -> int:
        return int(self.get("auth.max_login_attempts", 5))

    @property
    def lockout_minutes(self) -> int:
        return int(self.get("auth.lockout_minutes", 15))

    # LLM
    @property
    def llm_server_url(self) -> str:
        return f"http://{self.get('llm.server_host', '127.0.0.1')}:{self.get('llm.server_port', 8742)}/v1"

    @property
    def llm_model_name(self) -> str:
        return self.get("llm.model_name", "qwen2.5-7b-instruct")

    @property
    def llm_temperature(self) -> float:
        return float(self.get("llm.temperature", 0.1))

    @property
    def llm_max_tokens(self) -> int:
        return int(self.get("llm.max_tokens", 2048))

    @property
    def llm_context_size(self) -> int:
        return int(self.get("llm.context_size", 4096))

    # Embedding
    @property
    def embedding_dim(self) -> int:
        return int(self.get("embedding.dimension", 1024))

    @property
    def embedding_path(self) -> Path:
        return self.model_abspath(self.get("embedding.model_path", "models/embedding"))

    @property
    def embedding_batch_size(self) -> int:
        return int(self.get("embedding.batch_size", 16))

    # Reranker
    @property
    def reranker_path(self) -> Path:
        return self.model_abspath(self.get("reranker.model_path", "models/reranker"))

    @property
    def reranker_top_k(self) -> int:
        return int(self.get("reranker.top_k", 5))

    # RAG
    @property
    def rag_chunk_size(self) -> int:
        return int(self.get("rag.chunk_size", 512))

    @property
    def rag_chunk_overlap(self) -> int:
        return int(self.get("rag.chunk_overlap", 50))

    @property
    def rag_retrieval_top_k(self) -> int:
        return int(self.get("rag.retrieval_top_k", 20))

    @property
    def rag_context_max_tokens(self) -> int:
        return int(self.get("rag.context_max_tokens", 3000))

    @property
    def rag_history_max_tokens(self) -> int:
        return int(self.get("rag.chat_history_max_tokens", 1500))

    @property
    def rag_min_confidence(self) -> float:
        return float(self.get("rag.min_confidence", 0.3))

    # Storage
    @property
    def storage_path(self) -> Path:
        return self.appdata / "storage"

    @property
    def db_path(self) -> Path:
        return self.appdata / "data" / "enterprise.db"

    @property
    def max_file_size_bytes(self) -> int:
        return int(self.get("storage.max_file_size_mb", 100)) * 1024 * 1024

    @property
    def allowed_types(self) -> List[str]:
        return list(self.get("storage.allowed_types", []))

    @property
    def extensions_dir(self) -> Path:
        return self.root / "extensions"

    @property
    def system_prompt_path(self) -> Path:
        return self.root / "config" / "system-prompt.txt"

    @property
    def frontend_dist(self) -> Path:
        env_dist = os.environ.get("EAI_FRONTEND_DIST")
        if env_dist:
            return Path(env_dist)
        return self.root / "frontend" / "dist"


@lru_cache(maxsize=1)
def get_config() -> Config:
    return Config()


settings = get_config()
