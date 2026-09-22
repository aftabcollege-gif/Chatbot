"""Chatbot Enterprise — offline mini launcher / repair tool.

Double-click behaviour (no arguments, no cmd, no PowerShell, no installer):

1. repairs the installed application (UI path so the white screen goes away,
   vector extension placement, admin account + password);
2. starts a fully self-contained copy of the fixed backend + UI on
   ``http://127.0.0.1:8751`` and opens the default browser on it.

The generated admin credentials are printed here, written to
``%APPDATA%\\EnterpriseAI\\ADMIN-CREDENTIALS.txt`` and copied to the Desktop.
"""
from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from pathlib import Path

APP_PORT = 8751
LLM_PORT = 8742

BANNER = r"""
================================================================
   دستیار هوشمند سازمانی  —  نسخهٔ تعمیر و اجرای آفلاین
   Chatbot Enterprise offline launcher / repair  (mini)
================================================================
"""


# --------------------------------------------------------------------------- #
# paths / environment
# --------------------------------------------------------------------------- #
def bundle_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def backend_path() -> Path:
    """Where the backend package lives (repo checkout or frozen bundle)."""
    if getattr(sys, "frozen", False):
        return bundle_dir()
    return Path(__file__).resolve().parents[2] / "backend"


def prepare_sys_path() -> None:
    backend = backend_path()
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
    except NameError:  # pragma: no cover
        pass


def frontend_dist() -> Path:
    candidates = [
        bundle_dir() / "frontend" / "dist",
        Path(__file__).resolve().parents[2] / "frontend" / "dist",
    ]
    for candidate in candidates:
        if (candidate / "index.html").is_file():
            return candidate
    return candidates[0]


def port_free(port: int, host: str = "127.0.0.1") -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def is_admin() -> bool:
    if sys.platform != "win32":
        return os.geteuid() == 0 if hasattr(os, "geteuid") else False
    try:
        import ctypes

        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def relaunch_elevated(extra_args: list[str]) -> bool:
    """Run this EXE again through UAC and wait for it to finish.

    Repairing an application that lives in ``C:\Program Files`` requires
    administrator rights; this keeps the "just double-click" experience while
    still being able to write there (one UAC prompt).
    """
    report_file = Path(tempfile.gettempdir()) / "chatbot-mini-repair.txt"
    try:
        report_file.unlink()
    except OSError:
        pass
    args = [*extra_args, "--repair-report", str(report_file)]
    try:
        import ctypes

        # ShellExecuteW returns a value > 32 on success.
        result = ctypes.windll.shell32.ShellExecuteW(
            None, "runas", sys.executable, subprocess.list2cmdline(args), None, 1
        )
        if int(result) <= 32:
            print("[!] درخواست دسترسی مدیر تأیید نشد؛ تعمیر نسخهٔ نصب‌شده انجام نمی‌شود.")
            return False
    except Exception as exc:
        print(f"[!] اجرای مجدد با دسترسی مدیر ممکن نشد: {exc!r}")
        return False

    deadline = time.time() + 180
    while time.time() < deadline:
        if report_file.is_file():
            try:
                print(report_file.read_text(encoding="utf-8").strip())
            except OSError:
                pass
            try:
                report_file.unlink()
            except OSError:
                pass
            return True
        time.sleep(1)
    print("[!] پاسخ برنامهٔ با دسترسی مدیر دریافت نشد.")
    return False


def http_ok(url: str, timeout: float = 1.5) -> bool:
    import urllib.error
    import urllib.request

    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


# --------------------------------------------------------------------------- #
# LLM (reuse the model + binary already installed on the machine)
# --------------------------------------------------------------------------- #
def find_llm(install: Path | None):
    if install is None:
        return None, None
    binaries = [
        install / "llm" / "llama-server.exe",
        install / "llm" / "llama-server",
        install / "resources" / "llm" / "llama-server.exe",
        install / "backend" / "llm" / "llama-server.exe",
    ]
    models: list[Path] = []
    for root in (install / "models" / "llm", install / "resources" / "models" / "llm",
                 install / "backend" / "models" / "llm"):
        if root.is_dir():
            models.extend(sorted(root.glob("*.gguf")))
    binary = next((b for b in binaries if b.is_file()), None)
    return binary, (models[0] if models else None)


def start_llm(install: Path | None, log=print):
    """Start llama-server unless one is already answering on the LLM port."""
    if http_ok(f"http://127.0.0.1:{LLM_PORT}/v1/models", timeout=1.0):
        log("[LLM] یک سرور مدل از قبل فعال است؛ از همان استفاده می‌شود.")
        return None
    binary, model = find_llm(install)
    if binary is None or model is None:
        log("[LLM] مدل یا فایل اجرایی llama-server پیدا نشد؛ پاسخ‌ها حالت استخراجی خواهند داشت.")
        return None
    try:
        process = subprocess.Popen(
            [
                str(binary),
                "--model", str(model),
                "--host", "127.0.0.1",
                "--port", str(LLM_PORT),
                "--ctx-size", "4096",
                "--threads", str(max(2, (os.cpu_count() or 4))),
                "--parallel", "2",
            ],
            cwd=str(binary.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        log(f"[LLM] مدل محلی در حال بارگذاری است: {model.name}")
        return process
    except Exception as exc:
        log(f"[LLM] اجرای llama-server ناموفق بود: {exc!r}")
        return None


# --------------------------------------------------------------------------- #
# server
# --------------------------------------------------------------------------- #
def configure_environment(install: Path | None, data: Path) -> None:
    os.environ.setdefault("APP_HOST", "127.0.0.1")
    os.environ["APP_PORT"] = str(APP_PORT)
    os.environ["EAI_FRONTEND_DIST"] = str(frontend_dist())
    os.environ["EAI_ALLOW_ADMIN_RESET"] = "1"
    assets: list[str] = []
    if install is not None:
        assets.append(str(install))
    bin_dir = Path(getattr(sys, "_MEIPASS", "."))
    assets.append(str(bin_dir))
    os.environ["EAI_ASSETS_DIR"] = os.pathsep.join(assets)
    if not os.environ.get("APPDATA"):
        os.environ["XDG_DATA_HOME"] = str(data.parent)


def run_server() -> None:
    import uvicorn  # noqa: WPS433 (imported late on purpose)

    import main as backend_main  # the bundled backend application

    uvicorn.run(backend_main.app, host="127.0.0.1", port=APP_PORT, log_level="info", access_log=False)


def open_browser_when_ready(url: str, timeout: float = 60.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if http_ok(f"{url}/api/health", timeout=1.0):
            break
        time.sleep(0.5)
    try:
        webbrowser.open(url)
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def _ask_with_timeout(question: str, seconds: int = 12) -> str:
    """Read a line, but never block the launcher for longer than *seconds*."""
    if not (sys.stdin and sys.stdin.isatty()):
        return ""
    print(question, end="", flush=True)
    answer: list[str] = []

    def _reader() -> None:
        try:
            answer.append(input())
        except (EOFError, OSError):
            answer.append("")

    thread = threading.Thread(target=_reader, daemon=True)
    thread.start()
    thread.join(seconds)
    print("" if answer else "\n    (پاسخی داده نشد؛ ادامه می‌دهیم)")
    return answer[0].strip() if answer else ""


def _is_writable(path: Path) -> bool:
    try:
        probe = path / ".eai-write-test"
        probe.write_text("x", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False


def _print_actions(report: dict) -> None:
    for level, message in report.get("actions", []):  # type: ignore[union-attr]
        marker = {"ok": "[✓]", "warn": "[!]", "error": "[×]"}.get(str(level), "[·]")
        print(f"    {marker} {message}")


def _write_repair_report(report: dict, path: str | None) -> None:
    if not path:
        return
    try:
        lines = [f"{level}: {message}" for level, message in report.get("actions", [])]  # type: ignore[union-attr]
        Path(path).write_text("\n".join(lines), encoding="utf-8")
    except OSError:
        pass


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=True, description="Chatbot Enterprise offline mini launcher")
    parser.add_argument("--repair-only", action="store_true", help="only repair the installed app, do not serve")
    parser.add_argument("--serve-only", action="store_true", help="skip the repair step")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser")
    parser.add_argument("--port", type=int, default=APP_PORT, help="port for the built-in server")
    parser.add_argument("--repair-report", default=None, help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    global APP_PORT
    args = parse_args(list(argv if argv is not None else sys.argv[1:]))
    APP_PORT = args.port
    prepare_sys_path()

    # Persian output must survive a Windows console *and* a redirected pipe
    # (the CI smoke test, `> log.txt`): with the cp1252 default a single
    # Persian character aborts the process with UnicodeEncodeError.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(  # type: ignore[attr-defined]
                encoding="utf-8", errors="replace", line_buffering=True
            )
        except Exception:
            pass
    if sys.platform == "win32":
        try:  # make Persian output readable in the classic console
            subprocess.run(["chcp", "65001"], shell=True, capture_output=True, timeout=5)
        except Exception:
            pass
    print(BANNER, flush=True)

    from mini_repair import data_dir, find_installations, repair_database, repair_installation

    installs = [] if (args.serve_only and not args.repair_report) else find_installations()
    install = installs[0] if installs else None

    print("۱) بررسی نسخهٔ نصب‌شده ...")
    if args.repair_report:
        # Elevated helper run: repair only, report the result for the parent
        # process, then exit so the parent can continue starting the server.
        if install is None:
            print("    [!] نسخهٔ نصب‌شده‌ای برای تعمیر پیدا نشد.")
            _write_repair_report(
                {"actions": [("warn", "نسخهٔ نصب‌شده‌ای برای تعمیر پیدا نشد")]}, args.repair_report
            )
        else:
            print(f"    مسیر نصب: {install}")
            report = repair_installation(install, log=print)
            _print_actions(report)
            _write_repair_report(report, args.repair_report)
        print("تعمیر نسخهٔ نصب‌شده انجام شد.")
        return 0

    if install is not None:
        print(f"    مسیر نصب: {install}")
        elevated_done = False
        if not _is_writable(install) and sys.platform == "win32" and not is_admin():
            print("    [!] برای تعمیر این مسیر دسترسی مدیر لازم است؛ درخواست UAC ...")
            elevated_done = relaunch_elevated(["--repair-only", "--serve-only"])
        if elevated_done:
            print("    [✓] تعمیر نسخهٔ نصب‌شده با دسترسی مدیر انجام شد.")
        else:
            report = repair_installation(install, log=print)
            _print_actions(report)
    else:
        print("    نسخهٔ نصب‌شده‌ای پیدا نشد (این برنامه به‌تنهایی کار می‌کند).")

    directory = data_dir()
    print(f"۲) تعمیر پایگاه داده و ساخت حساب مدیر  ({directory}) ...")
    try:
        result = repair_database(directory, log=print)
        if not result["password"] and not result["created"]:
            # An account with a password the user (supposedly) knows already
            # exists: give a way out when that is not the case.
            answer = _ask_with_timeout(
                "    [؟] اگر رمز عبور فعلی را فراموش کرده‌اید عدد 2 و Enter را بزنید،\n"
                "        در غیر این صورت فقط Enter بزنید (۱۲ ثانیه): "
            )
            if answer.strip() in {"2", "۲"}:
                result = repair_database(directory, log=print, reset_password=True)
    except Exception as exc:
        print(f"    [×] خطا در تعمیر پایگاه داده: {exc!r}")
        return 2

    username, password = result["username"], result["password"]
    if password:
        print("")
        print("================================================================")
        print("   اطلاعات ورود (نام کاربری و رمز عبور مدیر)")
        print(f"      نام کاربری : {username}")
        print(f"      رمز عبور   : {password}")
        if result["created"]:
            status = "حساب تازه ساخته شد"
        elif result.get("from_file"):
            status = "همان رمز قبلی (فایل اطلاعات ورود) معتبر است"
        else:
            status = "رمز عبور بازنشانی شد"
        print(f"      وضعیت      : {status}")
        print("================================================================")
        print("   این اطلاعات در فایل ADMIN-CREDENTIALS.txt (در پوشهٔ APPDATA و روی")
        print("   دسکتاپ) ذخیره شد. پس از نخستین ورود، رمز را از بخش «پروفایل» تغییر دهید.")
        print("")
    else:
        print("")
        print(f"    [✓] حساب مدیر «{username}» فعال و آمادهٔ ورود است (رمز فعلی شما معتبر است).")
        print("")

    if args.repair_only:
        print("تعمیر انجام شد. نسخهٔ نصب‌شده را از میان‌بر دسکتاپ اجرا کنید.")
        _pause()
        return 0

    if not port_free(APP_PORT):
        print(f"[!] پورت {APP_PORT} اشغال است؛ روی پورت دیگری تلاش می‌شود.")
        for candidate in range(APP_PORT + 1, APP_PORT + 20):
            if port_free(candidate):
                APP_PORT = candidate
                break

    configure_environment(install, directory)
    start_llm(install, log=print)

    url = f"http://127.0.0.1:{APP_PORT}"
    print(f"۳) اجرای برنامهٔ مستقل روی {url}")
    print("    این پنجره را باز نگه دارید؛ برای خروج این پنجره را ببندید.")
    print("")

    if not args.no_browser:
        threading.Thread(target=open_browser_when_ready, args=(url,), daemon=True).start()

    try:
        run_server()
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        print(f"[×] خطای اجرای سرور: {exc!r}")
        _pause()
        return 3
    return 0


def _pause() -> None:
    """Wait for Enter only in an interactive console (never in CI/scripts)."""
    try:
        if sys.platform == "win32" and sys.stdin and sys.stdin.isatty():
            input("برای بستن پنجره Enter بزنید ...")
    except (EOFError, OSError, AttributeError):
        pass


if __name__ == "__main__":
    raise SystemExit(main())
