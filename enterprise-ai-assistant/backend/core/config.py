"""Application configuration loaded from YAML with environment overrides."""
from __future__ import annotations

import os
import secrets
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

import yaml


def _app_root() -> Path:
    """Root install directory.

    When frozen by PyInstaller, data files live next to the executable
    (sys._MEIPASS is for bundled temp data; we prefer the install dir for
    large assets like models).
    """
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
        # When frozen, the backend runs from <resources>/backend while the
        # Electron shell stages config/ as a sibling under <resources>. Search
        # the backend dir first, then its parent, so the packaged app still
        # loads storage.allowed_types and the rest of the YAML settings.
        candidates = [
            self.root / "config" / "default.yaml",
            self.root.parent / "config" / "default.yaml",
            Path(__file__).resolve().parent.parent.parent / "config" / "default.yaml",
        ]
        candidates += [root / "config" / "default.yaml" for root in self._known_install_roots()]
        for candidate in candidates:
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

    #: Product folder names we ship under (Program Files, LOCALAPPDATA, ...).
    INSTALL_TITLES = ("EnterpriseAI", "Chatbot Enterprise", "enterprise-ai-assistant")

    @classmethod
    def _known_install_roots(cls) -> List[Path]:
        """Directories of *installed* copies of this application (best effort).

        The packaged backend sometimes runs from a place that is not the
        install root (PyInstaller onedir under ``{app}\backend``, a Tauri
        bundle, the standalone mini launcher).  Assets such as
        ``models/``, ``llm/`` and ``frontend/dist`` live in the install root,
        so it is added to the asset search path.  This is what makes the
        "models not found" page find the models that the installer placed.
        """
        roots: List[Path] = []

        def _add(path: Path) -> None:
            try:
                if path.is_dir() and path not in roots:
                    roots.append(path)
            except OSError:
                pass

        env_root = os.environ.get("EAI_ROOT")
        if env_root:
            _add(Path(env_root.strip().strip('"')))
        for base in (
            os.environ.get("ProgramFiles"),
            os.environ.get("ProgramFiles(x86)"),
            os.environ.get("ProgramW6432"),
            os.environ.get("LOCALAPPDATA"),
            os.environ.get("APPDATA"),
        ):
            if not base:
                continue
            base_path = Path(base)
            for title in cls.INSTALL_TITLES:
                _add(base_path / title)
                _add(base_path / "Programs" / title)
        # Scripts / installers we know about, plus the executable's parents.
        for candidate in (Path("C:/EnterpriseAI"), Path("C:/Chatbot Enterprise"), Path("/opt/EnterpriseAI")):
            _add(candidate)
        try:
            exe_dir = Path(sys.executable).resolve().parent
            for parent in (exe_dir, exe_dir.parent, exe_dir.parent.parent):
                _add(parent)
        except (OSError, ValueError):
            pass
        return roots

    def _asset_roots(self) -> List[Path]:
        """Directories that may contain bundled assets.

        Covers every layout we ship: frozen-onedir (``<app>/backend`` with
        ``<app>`` as the sibling root), Inno Setup (``{app}\backend`` +
        ``{app}\frontend\dist``), Electron (``resources\backend``), a plain
        source checkout, any extra directory handed to us through
        ``EAI_ASSETS_DIR`` / ``EAI_ROOT``, and the known install directories
        (so an installation that lives next to the executable is used).
        """
        roots: List[Path] = [self.root, self.root.parent]
        extra = os.environ.get("EAI_ASSETS_DIR")
        if extra:
            for part in extra.split(os.pathsep):
                part = part.strip().strip('"')
                if part:
                    roots.append(Path(part))
        if getattr(sys, "frozen", False):
            roots.append(Path(sys.executable).resolve().parent)
        roots += self._known_install_roots()
        roots.append(Path.cwd())
        seen: List[Path] = []
        for r in roots:
            if r not in seen:
                seen.append(r)
        return seen

    def _resolve_asset(self, rel: str) -> Path:
        """Resolve a shared asset path under the app root, with a packaged fallback.

        When frozen by PyInstaller the backend runs from ``<resources>/backend``,
        while the shell stages shared assets (frontend build, models, config,
        extensions, llm binaries) as siblings directly under ``<resources>``.
        Check the backend directory first, then its parent, so both dev and
        packaged layouts resolve correctly.
        """
        for root in self._asset_roots():
            candidate = root / rel
            if candidate.exists():
                return candidate
        return self.root / rel

    def model_abspath(self, rel: str) -> Path:
        p = Path(rel)
        if p.is_absolute():
            return p
        return self._resolve_asset(rel)

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
        return self._resolve_asset("extensions")

    @property
    def system_prompt_path(self) -> Path:
        override = os.environ.get("EAI_SYSTEM_PROMPT")
        if override:
            return Path(override)
        return self._resolve_asset("config/system-prompt.txt")

    @property
    def frontend_dist(self) -> Path:
        override = os.environ.get("EAI_FRONTEND_DIST")
        if override:
            return Path(override)
        return self._resolve_asset("frontend/dist")


@lru_cache(maxsize=1)
def get_config() -> Config:
    return Config()


settings = get_config()
