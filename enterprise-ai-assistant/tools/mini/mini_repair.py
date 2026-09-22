"""Offline repair + launcher helpers for the "mini" standalone EXE.

The mini EXE is a *single small downloadable file* that fixes an installed
Chatbot Enterprise / دستیار هوشمند سازمانی installation without requiring
cmd, PowerShell, an installer or elevated tooling, and that can also act as a
complete, self-contained launcher for the application.

What :func:`repair_installation` fixes on an existing installation
------------------------------------------------------------------
* the white screen — the packaged backend looked for ``frontend/dist`` in the
  wrong directory, so the desktop shell loaded a page with no UI; the built UI
  is now staged where the backend actually looks;
* semantic search — ``sqlite_vec.dll`` / ``vec0.dll`` is placed in every
  directory the backend probes (``backend/extensions`` first), and the backend
  also falls back to a pure numpy index, so vector search works either way;
* the initial-login dead end — the super-admin account is created (or its
  password reset) with credentials written to a text file.

Everything here is pure standard library so it can run inside PyInstaller.
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

APP_TITLES = ("Chatbot Enterprise", "EnterpriseAI", "دستیار هوشمند سازمانی")
BACKEND_EXE_NAMES = ("backend-server.exe", "backend-server")
DLL_NAMES = ("sqlite_vec.dll", "vec0.dll")


# --------------------------------------------------------------------------- #
# Detection
# --------------------------------------------------------------------------- #
def _candidate_roots() -> List[Path]:
    roots: List[Path] = []
    explicit = os.environ.get("EAI_INSTALL_DIR")
    if explicit:
        roots.append(Path(explicit))
    env_roots = [os.environ.get("ProgramFiles"),
                 os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramW6432"),
                 os.environ.get("LOCALAPPDATA"), os.environ.get("APPDATA")]
    for base in env_roots:
        if not base:
            continue
        base_path = Path(base)
        for title in APP_TITLES:
            roots.append(base_path / title)
        if "Programs" not in base:
            for title in APP_TITLES:
                roots.append(base_path / "Programs" / title)
    roots += [Path("C:/EnterpriseAI"), Path("C:/Chatbot Enterprise"), Path("/opt/EnterpriseAI")]
    seen: List[Path] = []
    for root in roots:
        if root not in seen:
            seen.append(root)
    return seen


def _looks_like_install(path: Path) -> bool:
    """True when *path* is the root of an installed desktop application."""
    if not path.is_dir():
        return False
    for name in ("Chatbot Enterprise.exe", "EnterpriseAI.exe", "chatbot-enterprise.exe"):
        if (path / name).is_file():
            return True
    for sub in ("backend", "resources/backend", "resources"):
        for exe in BACKEND_EXE_NAMES:
            if (path / sub / exe).is_file():
                return True
            if (path / sub / "dist" / "backend-server" / exe).is_file():
                return True
    return False


def _registry_installs() -> List[Path]:
    """Best-effort lookup of install locations from the Windows registry."""
    found: List[Path] = []
    if sys.platform != "win32":
        return found
    try:
        import winreg  # type: ignore
    except Exception:
        return found
    keys = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
    for hive, subkey in keys:
        try:
            with winreg.OpenKey(hive, subkey) as root:
                for index in range(winreg.QueryInfoKey(root)[0]):
                    try:
                        name = winreg.EnumKey(root, index)
                        with winreg.OpenKey(root, name) as item:
                            display = str(winreg.QueryValueEx(item, "DisplayName")[0])
                            if not any(t.lower() in display.lower() for t in ("chatbot", "enterpriseai", "enterprise ai", "دستیار")):
                                continue
                            try:
                                location = str(winreg.QueryValueEx(item, "InstallLocation")[0]).strip('"')
                            except OSError:
                                location = ""
                            if location and _looks_like_install(Path(location)):
                                found.append(Path(location))
                    except OSError:
                        continue
        except OSError:
            continue
    return found


def find_installations() -> List[Path]:
    candidates = _registry_installs() + _candidate_roots()
    installs: List[Path] = []
    for path in candidates:
        try:
            if _looks_like_install(path) and path not in installs:
                installs.append(path)
        except OSError:
            continue
    return installs


def backend_dir(install: Path) -> Optional[Path]:
    """Directory that holds ``backend-server.exe`` (PyInstaller onedir root)."""
    for sub in ("backend", "resources/backend", "resources", ""):
        directory = (install / sub) if sub else install
        for exe in BACKEND_EXE_NAMES:
            if (directory / exe).is_file():
                return directory
        nested = directory / "dist" / "backend-server"
        for exe in BACKEND_EXE_NAMES:
            if (nested / exe).is_file():
                return nested
    return None


def data_dir() -> Path:
    base = os.environ.get("APPDATA") or os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "EnterpriseAI"


# --------------------------------------------------------------------------- #
# Copy helpers
# --------------------------------------------------------------------------- #
def _copy_tree(src: Path, dst: Path) -> int:
    """Copy *src* into *dst* (created if needed).  Returns files copied."""
    if not src.is_dir():
        return 0
    copied = 0
    dst.mkdir(parents=True, exist_ok=True)
    for root, _dirs, files in os.walk(src):
        rel = Path(root).relative_to(src)
        (dst / rel).mkdir(parents=True, exist_ok=True)
        for name in files:
            target = dst / rel / name
            try:
                if target.exists() and target.stat().st_size == (Path(root) / name).stat().st_size:
                    continue
                shutil.copy2(Path(root) / name, target)
                copied += 1
            except OSError:
                continue
    return copied


def _link_or_copy_dir(src: Path, dst: Path, allow_copy: bool = True) -> str:
    """Expose *src* at *dst*.  Prefers a directory junction (no copying)."""
    if dst.exists():
        return "exists"
    if sys.platform == "win32":
        result = _create_junction(src, dst)
        if result:
            return "junction"
    if not allow_copy:
        return "failed"
    try:
        shutil.copytree(src, dst, dirs_exist_ok=True)
        return "copied"
    except OSError:
        return "failed"


def _create_junction(target: Path, link: Path) -> bool:
    """Create a directory junction without needing cmd.exe."""
    try:
        import _winapi  # type: ignore

        _winapi.CreateJunction(str(target), str(link))
        return True
    except Exception:
        pass
    try:  # fallback: mklink is part of cmd, but we never ask the user to type
        completed = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True,
            timeout=20,
        )
        return completed.returncode == 0 and link.exists()
    except Exception:
        return False


# --------------------------------------------------------------------------- #
# Repair
# --------------------------------------------------------------------------- #
def repair_installation(install: Path, log=print) -> Dict[str, object]:
    """Apply every offline fix to an installed application.  Never raises."""
    report: Dict[str, object] = {"install": str(install), "actions": [], "ok": True}
    backend = backend_dir(install)
    if backend is None:
        report["ok"] = False
        report["actions"].append(("error", "backend-server.exe یافت نشد"))
        return report

    # 1) Frontend build where the packaged backend looks for it (white screen).
    frontend_sources = [
        install / "frontend" / "dist",
        install / "resources" / "frontend" / "dist",
        backend / "frontend" / "dist",
        install / "dist",
    ]
    frontend_target = backend / "frontend" / "dist"
    source = next((p for p in frontend_sources if (p / "index.html").is_file()), None)
    if source is None:
        report["actions"].append(("warn", "frontend/dist پیدا نشد (رابط کاربری نصب نشده است)"))
    elif source.resolve() != frontend_target.resolve():
        copied = _copy_tree(source, frontend_target)
        report["actions"].append(
            ("ok", f"رابط کاربری در مسیر درست قرار گرفت ({copied} فایل) → {frontend_target}")
        )
    else:
        report["actions"].append(("ok", "رابط کاربری از قبل در مسیر درست است"))

    # 2) Vector extension (sqlite-vec).
    #
    # Two hard-won details:
    #   * SQLite derives the loadable entry point *from the file name*; only
    #     ``vec0.dll`` (or ``vec0``) exposes ``sqlite3_vec_init``.  Renaming it
    #     to ``sqlite_vec.dll`` — which the build scripts used to do — produces
    #     "undefined symbol: sqlite3_sqlitevec_init" and silent degradation.
    #   * the loader in the packaged backend tries ``sqlite_vec.loadable_path()``
    #     first, i.e. ``<bundle>/sqlite_vec/vec0.dll``, then ``<root>/extensions``.
    dll_source = None
    for candidate in [
        Path(getattr(sys, "_MEIPASS", ".")) / "extensions" / "vec0.dll",
        Path(getattr(sys, "_MEIPASS", ".")) / "vec0.dll",
        Path(getattr(sys, "_MEIPASS", ".")) / "extensions" / "sqlite_vec.dll",
        Path(__file__).resolve().parent / "extensions" / "vec0.dll",
        Path(__file__).resolve().parent / "vec0.dll",
        Path(__file__).resolve().parent / "extensions" / "sqlite_vec.dll",
        install / "extensions" / "vec0.dll",
    ]:
        if candidate and candidate.is_file():
            dll_source = candidate
            break

    if dll_source is None:
        report["actions"].append(("warn", "فایل vec0.dll همراه بسته نیست؛ جست‌وجوی برداری با موتور numpy انجام می‌شود"))
    else:
        placements = [
            backend / "_internal" / "sqlite_vec" / "vec0.dll",
            backend / "sqlite_vec" / "vec0.dll",
            backend / "vec0.dll",
            backend / "_internal" / "vec0.dll",
            backend / "extensions" / "vec0.dll",
            backend / "_internal" / "extensions" / "vec0.dll",
            install / "extensions" / "vec0.dll",
            backend / "extensions" / "sqlite_vec.dll",
        ]
        placed = 0
        for target in placements:
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists() or target.stat().st_size != dll_source.stat().st_size:
                    shutil.copy2(dll_source, target)
                placed += 1
            except OSError:
                continue
        # Shim so ``import sqlite_vec`` + loadable_path() also works when the
        # frozen build did not bundle the tiny Python helper package.
        shim = (
            "from os import path\n"
            "def loadable_path():\n"
            "    return path.normpath(path.join(path.dirname(__file__), 'vec0'))\n"
            "def load(conn):\n"
            "    conn.load_extension(loadable_path())\n"
        )
        for pkg_dir in (backend / "_internal" / "sqlite_vec", backend / "sqlite_vec"):
            try:
                pkg_dir.mkdir(parents=True, exist_ok=True)
                (pkg_dir / "__init__.py").write_text(shim, encoding="utf-8")
            except OSError:
                continue
        report["actions"].append(("ok", f"افزونهٔ برداری vec0.dll در {placed} مسیر قرار گرفت"))

    # 3) Config + models discoverable by the frozen backend.
    for name in ("default.yaml", "system-prompt.txt"):
        src = install / "config" / name
        if src.is_file():
            target = backend / "config" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                try:
                    shutil.copy2(src, target)
                except OSError:
                    pass
    for name, target_name in (("llm", "llm"), ("extensions", "extensions")):
        src = install / name
        if src.is_dir():
            result = _link_or_copy_dir(src, backend / target_name)
            report["actions"].append(("ok" if result != "failed" else "warn", f"{name} → {backend / target_name} ({result})"))

    # Model sub-directories: the packaged backend resolves ``models/embedding``
    # and ``models/reranker`` relative to its own directory, while the
    # installer keeps the (huge) model files in ``<install>/models``.  Junction
    # the individual model folders instead of copying gigabytes around.
    models_src = install / "models"
    if models_src.is_dir():
        linked = []
        for model_name in ("embedding", "reranker", "llm", "ocr"):
            src = models_src / model_name
            target = backend / "models" / model_name
            if not src.is_dir() or target.exists():
                continue
            # Never copy model folders (hundreds of megabytes); junction only.
            result = _link_or_copy_dir(src, target, allow_copy=False)
            if result != "failed":
                linked.append(f"{model_name} ({result})")
        if linked:
            report["actions"].append(("ok", "مدل‌های هوش مصنوعی متصل شدند: " + "، ".join(linked)))
        else:
            report["actions"].append(("warn", "مدل‌های هوش مصنوعی یافت نشد؛ جست‌وجو با موتور کلمات کلیدی انجام می‌شود"))

    return report


# --------------------------------------------------------------------------- #
# Database / admin repair
# --------------------------------------------------------------------------- #
def repair_database(directory: Path, log=print) -> Tuple[str, str, bool]:
    """Ensure the schema exists and a usable super-admin is present.

    Returns ``(username, password, created)``.
    """
    from core import bootstrap  # bundled backend module
    from core.database import init_db
    from core.security import argon2_available

    if not argon2_available():
        log("[!] کتابخانهٔ Argon2 در دسترس نیست؛ رمز با الگوریتم جایگزین ساخته می‌شود.")

    (directory / "data").mkdir(parents=True, exist_ok=True)
    (directory / "logs").mkdir(parents=True, exist_ok=True)

    try:
        init_db()  # CREATE TABLE IF NOT EXISTS ... (full schema, idempotent)
    except Exception as exc:  # pragma: no cover - defensive
        log(f"[!] init_db: {exc!r}")

    result = bootstrap.bootstrap_admin(reset_password=True)
    return result["username"], result["password"] or "", result["created"]
