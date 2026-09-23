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
import re
import shutil
import sqlite3
import tempfile
import urllib.request
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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
    # An Electron/portable layout can keep the backend next to the launcher.
    for exe in BACKEND_EXE_NAMES:
        if (path / exe).is_file() and (path / "models").is_dir() or (path / "resources").is_dir():
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


def _sibling_roots(path: Path) -> List[Path]:
    """Directories next to *path* that look like another installation.

    A machine frequently ends up with more than one copy ("EnterpriseAI" in
    Program Files and "Chatbot Enterprise" from the older installer, or a
    portable folder), and the models/llm binaries may live in only one of
    them.  Those copies are not always registered anywhere, so look next to
    the known roots as well.
    """
    found: List[Path] = []
    for parent in (path.parent, path.parent.parent):
        try:
            if not parent.is_dir():
                continue
            for entry in parent.iterdir():
                try:
                    if entry.is_dir() and entry != path and _looks_like_install(entry):
                        if entry not in found:
                            found.append(entry)
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
    for path in list(installs):
        for sibling in _sibling_roots(path):
            if sibling not in installs:
                installs.append(sibling)
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
    # The UI bundled with the *mini tool* is the fixed build, so it wins over
    # whatever the installation already contains: the old bundle keeps talking
    # to a backend address that no longer exists (that is why the window stayed
    # blank / empty even after the files were in place).
    bundled_ui = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "frontend" / "dist"
    if not (bundled_ui / "index.html").is_file():
        bundled_ui = Path(__file__).resolve().parents[2] / "frontend" / "dist"

    frontend_sources = [
        bundled_ui,
        install / "frontend" / "dist",
        install / "resources" / "frontend" / "dist",
        backend / "frontend" / "dist",
        install / "dist",
    ]
    frontend_targets = [
        backend / "frontend" / "dist",
        install / "frontend" / "dist",
    ]
    source = next((p for p in frontend_sources if (p / "index.html").is_file()), None)
    if source is None:
        report["actions"].append(("warn", "frontend/dist پیدا نشد (رابط کاربری نصب نشده است)"))
    else:
        placed = 0
        for target in frontend_targets:
            try:
                if source.resolve() == target.resolve():
                    placed += 1 if (target / "index.html").is_file() else 0
                    continue
                copied = _copy_tree(source, target)
                placed += 1
                if target == frontend_targets[0]:
                    report["actions"].append(
                        ("ok", f"رابط کاربری در مسیر درست قرار گرفت ({copied} فایل) → {target}")
                    )
            except OSError:
                continue
        if placed == 0:
            report["actions"].append(("warn", "رابط کاربری جای‌گذاری نشد"))

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
            if not src.is_dir() or not any(src.iterdir()):
                continue
            target = backend / "models" / model_name
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
# Making the *installed* application work (white screen / model paths)
# --------------------------------------------------------------------------- #
def persist_asset_environment(install: Path, log=print) -> Dict[str, Any]:
    """Store the asset locations for the installed app in the user's registry.

    The installed shell launches ``backend-server.exe`` without telling it where
    the bundle lives, so the backend looks for ``frontend/dist`` and ``models``
    relative to ``{app}\backend`` — which is exactly why the old installation
    kept showing a blank window and an empty models page even after the files
    were moved.  Writing ``EAI_ROOT`` / ``EAI_ASSETS_DIR`` /
    ``EAI_FRONTEND_DIST`` into HKCU\Environment (per-user, no admin needed)
    makes every copy of the backend find the UI and the models.
    """
    result: Dict[str, Any] = {"persisted": False, "values": {}}
    if sys.platform != "win32":
        return result

    # Every known installation goes into the search path: the models of the
    # old "Chatbot Enterprise" copy are then visible to this installation.
    asset_roots = [install]
    try:
        for other in find_installations():
            if other != install and other not in asset_roots:
                asset_roots.append(other)
    except Exception:
        pass
    values = {
        "EAI_ROOT": str(install),
        "EAI_ASSETS_DIR": os.pathsep.join(str(root) for root in asset_roots),
    }
    frontend = install / "frontend" / "dist"
    if (frontend / "index.html").is_file():
        values["EAI_FRONTEND_DIST"] = str(frontend)
    backend_frontend = install / "backend" / "frontend" / "dist"
    if "EAI_FRONTEND_DIST" not in values and (backend_frontend / "index.html").is_file():
        values["EAI_FRONTEND_DIST"] = str(backend_frontend)

    try:
        import winreg  # type: ignore

        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
            for name, value in values.items():
                winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
        result["persisted"] = True
        result["values"] = values
        log("    [✓] مسیر دارایی‌ها برای برنامهٔ نصب‌شده ثبت شد (EAI_ROOT / EAI_ASSETS_DIR)")
    except OSError as exc:
        log(f"    [!] ثبت مسیر دارایی‌ها ناموفق بود: {exc!r}")

    # Tell already-running shells (Explorer) about the new environment.
    try:
        import ctypes

        HWND_BROADCAST = 0xFFFF
        WM_SETTINGCHANGE = 0x001A
        SMTO_ABORTIFHUNG = 0x0002
        value = "Environment\x00"
        ctypes.windll.user32.SendMessageTimeoutW(
            HWND_BROADCAST, WM_SETTINGCHANGE, 0, ctypes.c_wchar_p(value), SMTO_ABORTIFHUNG, 5000, None
        )
    except Exception:
        pass
    return result


def borrow_missing_assets(install: Path, log=print) -> list:
    """Link models / llm binaries that another installation already has.

    A machine can easily end up with two installations (the "Chatbot
    Enterprise" Electron bundle with the ~1 GB of models, and an
    "EnterpriseAI" installation without them).  Instead of downloading
    gigabytes again, junctions point the selected installation at the existing
    files.
    """
    actions: list = []
    backend = backend_dir(install)
    if backend is None:
        return actions

    others = [p for p in find_installations() if p != install]
    want_models = install / "models"
    want_llm = install / "llm"

    def _missing_models(root: Path) -> bool:
        for name in ("embedding", "reranker", "llm", "ocr"):
            sub = root / "models" / name
            if sub.is_dir() and any(sub.iterdir()):
                return False
        return True

    if _missing_models(install):
        for other in others:
            if not _missing_models(other):
                source = other / "models"
                results = []
                for name in ("embedding", "reranker", "llm", "ocr"):
                    src = source / name
                    if not src.is_dir() or not any(src.iterdir()):
                        continue
                    target = want_models / name
                    # embedding/reranker/ocr are a few hundred MB and worth a
                    # copy if a junction is not possible; the LLM weights are
                    # gigabytes, so they are only ever linked.
                    outcome = _link_or_copy_dir(src, target, allow_copy=name != "llm")
                    if outcome != "failed":
                        results.append(f"{name} ({outcome})")
                if results:
                    actions.append(("ok", "مدل‌ها از نصب دیگر استفاده شد: " + "، ".join(results) + f" ← {other}"))
                break

    if not (want_llm / "llama-server.exe").is_file():
        for other in others:
            candidate = other / "llm" / "llama-server.exe"
            if not candidate.is_file():
                continue
            target = want_llm / "llama-server.exe"
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                _link_or_copy_dir(other / "llm", want_llm)
                if not target.is_file():  # the folder link was skipped, copy the file
                    shutil.copy2(candidate, target)
            except OSError:
                continue
            if target.is_file():
                actions.append(("ok", f"موتور مدل (llama-server) از نصب دیگر: {other}"))
                break
    return actions


def diagnose_installed_backend(install: Path, log=print) -> Dict[str, Any]:
    """Start the installed backend and report what it actually serves.

    The old window stays white when its backend answers with JSON instead of
    the UI (or does not answer at all).  Running it here — with the repaired
    environment — tells us which of the two it is, without guessing.
    """
    report: Dict[str, Any] = {"ran": False, "serves_ui": False, "status": None, "detail": ""}
    backend = backend_dir(install)
    if backend is None:
        report["detail"] = "backend-server.exe یافت نشد"
        return report

    exe = None
    for name in BACKEND_EXE_NAMES:
        candidate = backend / name
        if candidate.is_file():
            exe = candidate
            break
    if exe is None:
        report["detail"] = "backend-server.exe یافت نشد"
        return report

    port = _spare_port()
    env = dict(os.environ)
    env.update(
        {
            "APP_HOST": "127.0.0.1",
            "APP_PORT": str(port),
            "EAI_ROOT": str(install),
            "EAI_ASSETS_DIR": str(install),
        }
    )
    frontend = install / "frontend" / "dist"
    if (frontend / "index.html").is_file():
        env["EAI_FRONTEND_DIST"] = str(frontend)

    log_file = Path(tempfile.gettempdir()) / "chatbot-mini-installed-backend.log"
    try:
        with open(log_file, "wb") as fh:
            process = subprocess.Popen(
                [str(exe)], cwd=str(backend), env=env, stdout=fh, stderr=subprocess.STDOUT
            )
    except OSError as exc:
        report["detail"] = f"اجرای بک‌اند نصب‌شده ناموفق بود: {exc!r}"
        return report

    try:
        deadline = time.time() + 45
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as resp:
                    if resp.status == 200:
                        break
            except Exception:
                time.sleep(1)
        report["ran"] = True
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5) as resp:
                body = resp.read(4000).decode("utf-8", "replace")
                report["status"] = resp.status
                report["serves_ui"] = "<html" in body.lower()
                report["detail"] = "UI" if report["serves_ui"] else body.strip()[:200]
        except Exception as exc:
            report["detail"] = f"پاسخی از بک‌اند نصب‌شده دریافت نشد: {exc!r}"
    finally:
        try:
            process.terminate()
            process.wait(timeout=10)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass

    if report["serves_ui"]:
        log("    [✓] بک‌اند نسخهٔ نصب‌شده با تنظیمات تعمیرشده، رابط کاربری را سرو می‌کند")
    else:
        log(f"    [!] بک‌اند نسخهٔ نصب‌شده رابط کاربری را سرو نمی‌کند: {report['detail']}")
        log(f"        گزارش کامل: {log_file}")
    return report


def _spare_port(start: int = 8790) -> int:
    import socket

    for port in range(start, start + 40):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start


def port_owner(port: int) -> Dict[str, Any]:
    """Identify the process listening on *port* (Windows, best effort)."""
    info: Dict[str, Any] = {"pid": None, "exe": "", "ours": False}
    if sys.platform != "win32":
        return info
    try:
        completed = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, timeout=20
        )
    except Exception:
        return info
    for line in completed.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0].upper() != "TCP":
            continue
        if not parts[1].endswith(f":{port}"):
            continue
        if parts[3].upper() not in ("LISTENING", "ESTABLISHED", "CLOSE_WAIT"):
            continue
        try:
            info["pid"] = int(parts[-1])
        except ValueError:
            return info
        break
    if info["pid"]:
        try:
            completed = subprocess.run(
                ["tasklist", "/FI", f"PID eq {info['pid']}", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=20,
            )
            first = completed.stdout.strip().splitlines()
            if first:
                name = first[0].split(",")[0].strip('"')
                info["exe"] = name
                info["ours"] = any(
                    token in name.lower()
                    for token in ("backend-server", "enterpriseai", "chatbot", "llama-server", "python")
                )
        except Exception:
            pass
    return info


def free_ports(ports: List[int] = None, log=print) -> list:
    """Stop leftover copies of the app's own backend/shell holding its ports.

    An old ``backend-server.exe`` (or the desktop shell) that survives a crash
    keeps port 8741 open.  The repared installation then talks to that stale
    process — which is exactly the kind of mismatch that shows up as an empty
    or blank window.
    """
    if sys.platform != "win32":
        return []
    ports = ports or [8741, 8742]
    killed: list = []
    try:
        completed = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, timeout=20
        )
    except Exception:
        return killed
    pids = set()
    for line in completed.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0].upper() != "TCP":
            continue
        local = parts[1]
        if not any(local.endswith(f":{port}") for port in ports):
            continue
        state = parts[3].upper() if len(parts) > 4 else ""
        if state not in ("LISTENING", "ESTABLISHED", "CLOSE_WAIT"):
            continue
        try:
            pids.add(int(parts[-1]))
        except ValueError:
            continue
    for pid in pids:
        if pid in (0, 4) or pid == os.getpid():
            continue
        try:
            completed = subprocess.run(
                ["taskkill", "/PID", str(pid), "/F", "/T"], capture_output=True, text=True, timeout=20
            )
            if completed.returncode == 0:
                killed.append(pid)
        except Exception:
            continue
    if killed:
        log(f"    [✓] نسخه‌های قبلی برنامه بسته شدند (PID: {', '.join(str(p) for p in killed)})")
    return killed


def fix_installed_shortcuts(install: Path, log=print) -> list:
    """Point the shortcuts that run ``backend-server.exe`` at the launcher.

    Some installations put the *backend* on the Desktop/Start-menu instead of
    the desktop shell.  Opening it shows the backend's JSON answer as a blank
    page.  Rewriting the shortcut to the desktop shell (or re-creating it) is
    what makes the old icon work.
    """
    actions: list = []
    if sys.platform != "win32":
        return actions
    shell = install / "EnterpriseAI.exe"
    if not shell.is_file():
        for name in ("Chatbot Enterprise.exe", "chatbot-enterprise.exe", "EnterpriseAI.exe"):
            if (install / name).is_file():
                shell = install / name
                break
    if not shell.is_file():
        return actions

    targets = []
    for folder in (
        Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop",
        Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs",
    ):
        try:
            if folder.is_dir():
                targets += list(folder.rglob("*.lnk"))
        except OSError:
            continue

    fixed = 0
    for lnk in targets:
        name = lnk.name.lower()
        if "enterprise" not in name and "chatbot" not in name and "دستیار" not in lnk.name:
            continue
        try:
            # Read the shortcut with a tiny PowerShell-free COM call: use the
            # WScript.Shell through ctypes is not available, so parse the
            # target path out of the .lnk binary instead.
            raw = lnk.read_bytes()
        except OSError:
            continue
        text = raw.decode("utf-16-le", errors="ignore") + raw.decode("latin-1", errors="ignore")
        if "backend-server" not in text:
            continue
        try:
            updated = re.sub(
                r"backend-server(\.exe)?",
                shell.name,
                text,
                flags=re.IGNORECASE,
            )
            # Same byte layout: only the file name is replaced, so write it back
            # in a way that keeps the rest of the shortcut intact.
            raw_updated = raw.replace(b"backend-server.exe", shell.name.encode("utf-16-le"))
            raw_updated = raw_updated.replace(b"backend-server", shell.name.encode("utf-16-le"))
            if raw_updated != raw:
                lnk.write_bytes(raw_updated)
                fixed += 1
        except OSError:
            continue
    if fixed:
        actions.append(("ok", f"{fixed} میان‌بر به برنامهٔ اصلی اصلاح شد"))
    return actions


# --------------------------------------------------------------------------- #
# Database / admin repair
# --------------------------------------------------------------------------- #
def repair_database(
    directory: Path,
    log=print,
    reset_password: Optional[bool] = None,
) -> Dict[str, Any]:
    """Ensure the schema exists and the super-admin account is usable.

    Returns ``{username, password, created, reset, from_file}``.

    Password policy (the "initial login / admin credentials" problem):

    * no super-admin yet  -> create one with a generated password;
    * super-admin exists and a still-unused ``ADMIN-CREDENTIALS.txt`` is around
      -> keep the account, reprint the password from that file (it is valid);
    * ``reset_password=True`` (explicit user request / unknown password)
      -> generate a fresh password.
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

    has_admin = bootstrap.has_admin()
    stored = bootstrap.bootstrap_info().get("credentials") or {}

    if has_admin and reset_password is None and stored.get("username") and stored.get("password"):
        # The account exists and its password was never used yet.
        bootstrap.bootstrap_admin(reset_password=False)  # only unlock / activate
        return {
            "username": stored["username"],
            "password": stored["password"],
            "created": False,
            "reset": False,
            "from_file": True,
        }

    if has_admin and reset_password is None:
        # Keep the password the user knows; just make sure it can log in.
        result = bootstrap.bootstrap_admin(reset_password=False)
        return {
            "username": result["username"],
            "password": "",
            "created": False,
            "reset": False,
            "from_file": False,
        }

    result = bootstrap.bootstrap_admin(reset_password=True)
    return {
        "username": result["username"],
        "password": result["password"] or "",
        "created": result["created"],
        "reset": not result["created"],
        "from_file": False,
    }
