"""Chatbot Enterprise — offline mini launcher / repair tool.

Double-click behaviour (no arguments, no cmd, no PowerShell, no installer):

1. repairs the installed application (UI path so the white screen goes away,
   vector extension placement, admin account + password);
2. starts a fully self-contained copy of the fixed backend + UI on the
   application's own address — ``http://127.0.0.1:8741`` — and opens the default
   browser on it.

Port policy (the address must never move on its own)
----------------------------------------------------
* **8741** (the application's own port) is always the default.
* The port is changed **only** when the user explicitly approves it in the
  console prompt (or passes ``--port``).  A refused/unanswered prompt means the
  launcher stops instead of silently moving elsewhere.
* When 8741 is taken, the owner is identified.  A *previous copy of this very
  application* is closed only with the user's consent (option 1), so 8741 stays
  the address of the installed application.  Any other program is never closed.
* If the user prefers a different address, there is exactly **one** fixed
  alternative (8751) — never a "next free port", which used to walk
  8741 → 8752 → 8753 … and made the URL different on every run.

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

APP_PORT = 8741
LLM_PORT = 8742
#: The one and only alternative port.  It is *never* chosen automatically: the
#: user must pick it in the console prompt (or pass ``--port``).  A fixed number
#: — instead of "the next free port" — keeps the address predictable between
#: runs and keeps 8741 (what the installed application and its shortcuts use)
#: meaningful.
FALLBACK_PORT = 8751
#: Exit code used when the application's own port is taken and the user did not
#: approve either closing the previous copy or moving to the alternative port.
PORT_NOT_AVAILABLE_EXIT = 4

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
# port policy
# --------------------------------------------------------------------------- #
def _port_helpers():
    """The port helpers from :mod:`mini_repair` (lazy so tests can inject fakes)."""
    from mini_repair import free_ports, port_owner  # noqa: WPS433 (lazy on purpose)

    return free_ports, port_owner


def _describe_owner(owner: dict) -> str:
    name = (owner or {}).get("exe") or "برنامهٔ دیگری"
    pid = (owner or {}).get("pid")
    return f"{name} (PID {pid})" if pid else name


def resolve_serve_port(
    preferred: int = APP_PORT,
    *,
    explicit: bool = False,
    restart: bool = False,
    ask=None,
    is_free=None,
    owner_of=None,
    close_ports=None,
    app_answers=None,
    log=print,
):
    """Decide which port to serve on — never moving the address without consent.

    Returns one of:

    * ``("serve", port)`` — start the built-in server on ``port``;
    * ``("open", port)``  — a working copy of the application already serves that
      port, so simply open it in the browser (nothing is started or closed);
    * ``("exit", code)``  — do not start; the caller should exit with ``code``.

    *explicit* is True when the user passed ``--port`` themselves: that is their
    approval, so no question is asked.  *restart* (``--restart``) is the same
    kind of explicit approval for closing a previous copy of this application.
    """
    if ask is None:
        ask = _ask_with_timeout
    if is_free is None:
        is_free = port_free
    if owner_of is None or close_ports is None:
        helpers_close, helpers_owner = _port_helpers()
        if owner_of is None:
            owner_of = helpers_owner
        if close_ports is None:
            close_ports = helpers_close
    if app_answers is None:
        app_answers = lambda port: http_ok(f"http://127.0.0.1:{port}/api/health", timeout=1.0)  # noqa: E731

    if explicit:
        log(f"    [i] پورت {preferred} را خودتان با --port تعیین کرده‌اید؛ همان استفاده می‌شود.")
        return ("serve", preferred)

    if is_free(preferred):
        return ("serve", preferred)

    owner = owner_of(preferred) or {}
    ours = bool(owner.get("ours"))
    log("")
    log(f"    [!] پورت پیش‌فرض {preferred} آزاد نیست؛ در اختیار {_describe_owner(owner)} است.")
    log(f"        این برنامه همیشه روی پورت {preferred} اجرا می‌شود و پورت را")
    log("        بدون تأیید شما عوض نمی‌کند.")

    if ours and restart:
        log(f"    [i] سوئیچ --restart داده شده است؛ نسخهٔ قبلی بسته می‌شود.")
        close_ports([preferred], log=log)
        if is_free(preferred):
            log(f"    [✓] پورت {preferred} آزاد شد و همان پورت استفاده می‌شود.")
            return ("serve", preferred)
        log(f"    [!] پورت {preferred} آزاد نشد.")

    if ours:
        running = None
        try:
            if app_answers(preferred):
                running = preferred
        except Exception:
            running = None
        log("        این نسخهٔ قبلیِ خودِ برنامه است (نه برنامهٔ بیگانه).")
        log("")
        log("        گزینه‌ها:")
        log(f"          1 = نسخهٔ قبلی بسته شود و این نسخه روی همان پورت {preferred} اجرا شود")
        log(f"          2 = این نسخه روی پورت ثابت {FALLBACK_PORT} اجرا شود (تغییر پورت با تأیید شما)")
        if running:
            log(f"          3 = چیزی بسته نشود و فقط نسخهٔ در حال اجرا روی پورت {preferred} در مرورگر باز شود")
        log("          Enter = انصراف (هیچ پورتی عوض نمی‌شود و هیچ برنامه‌ای بسته نمی‌شود)")
        prompt = "        انتخاب شما (1/2"
        prompt += "/3" if running else ""
        prompt += " یا Enter — پیش‌فرض: انصراف): "
        answer = ask(
            prompt,
            seconds=25,
            no_answer="    (پاسخی داده نشد؛ پورت عوض نمی‌شود و نسخهٔ قبلی دست‌نخورده می‌ماند)",
        ).strip()
        if answer in {"1", "۱"}:
            close_ports([preferred], log=log)
            if is_free(preferred):
                log(f"    [✓] نسخهٔ قبلی بسته شد؛ برنامه روی پورت {preferred} اجرا می‌شود.")
                return ("serve", preferred)
            log(f"    [!] پورت {preferred} آزاد نشد؛ نسخهٔ قبلی دست‌نخورده ماند.")
        elif answer in {"2", "۲"}:
            log(f"    [✓] با تأیید شما، برنامه روی پورت {FALLBACK_PORT} اجرا می‌شود.")
            return ("serve", FALLBACK_PORT)
        elif running and answer in {"3", "۳"}:
            return ("open", preferred)
    else:
        log("        این برنامه، برنامهٔ ما نیست و بسته نمی‌شود.")
        log("")
        log("        گزینه‌ها:")
        log(f"          1 = اجرای این نسخه روی پورت ثابت {FALLBACK_PORT} (تغییر پورت با تأیید شما)")
        log("          Enter = انصراف (پورت عوض نمی‌شود)")
        answer = ask(
            "        انتخاب شما (1 یا Enter — پیش‌فرض: انصراف): ",
            seconds=25,
            no_answer="    (پاسخی داده نشد؛ پورت عوض نمی‌شود)",
        ).strip()
        if answer in {"1", "۱"}:
            log(f"    [✓] با تأیید شما، برنامه روی پورت ثابت {FALLBACK_PORT} اجرا می‌شود.")
            return ("serve", FALLBACK_PORT)

    log("")
    log(f"    [i] پورت عوض نشد. برای اجرای برنامه روی پورت {preferred}:")
    log("        ۱) پنجرهٔ برنامه‌ای که روی این پورت است را ببندید (یا در وظیفه‌ها ببندید)،")
    log("        ۲) سپس همین فایل را دوباره اجرا کنید.")
    log(f"    [port] busy={preferred} ours={ours} decision=exit")
    return ("exit", PORT_NOT_AVAILABLE_EXIT)


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def _ask_with_timeout(question: str, seconds: int = 12, no_answer: str = "") -> str:
    """Read a line, but never block the launcher for longer than *seconds*.

    Without an interactive console (a service, a redirected pipe, the CI smoke
    test) the empty answer is returned immediately — every caller treats "" as
    "the user approved nothing".
    """
    if not (sys.stdin and sys.stdin.isatty()):
        print(question, flush=True)
        print("    (پایانهٔ تعاملی نیست؛ بدون تأیید شما هیچ تغییری انجام نمی‌شود.)")
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
    if not answer:
        print("\n" + (no_answer or "    (پاسخی داده نشد؛ ادامه می‌دهیم)"))
    else:
        print("")
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
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help=f"port for the built-in server (default: {APP_PORT}; this switch is your approval to change it)",
    )
    parser.add_argument(
        "--restart",
        action="store_true",
        help="close a previous copy of this same application so the default port can be used (no question asked)",
    )
    parser.add_argument("--repair-report", default=None, help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    global APP_PORT
    args = parse_args(list(argv if argv is not None else sys.argv[1:]))
    explicit_port = args.port is not None
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

    from mini_repair import (
        borrow_missing_assets,
        data_dir,
        diagnose_installed_backend,
        find_installations,
        fix_installed_shortcuts,
        free_ports,
        port_owner,
        persist_asset_environment,
        repair_database,
        repair_installation,
    )

    installs = [] if (args.serve_only and not args.repair_report) else find_installations()
    install = installs[0] if installs else None

    # Port policy: the application's own port (8741) is the default and the port
    # moves only when the user approves it — see resolve_serve_port().
    # A repair-only run never serves, so it never touches the port question.
    action, chosen = "serve", (args.port or APP_PORT)
    if not args.repair_only:
        try:
            action, chosen = resolve_serve_port(
                args.port or APP_PORT,
                explicit=explicit_port,
                restart=args.restart,
                close_ports=free_ports,
                owner_of=port_owner,
            )
        except Exception as exc:
            print(f"    [!] انتخاب پورت با خطا مواجه شد: {exc!r}")

        if action == "exit":
            print("")
            print("    [i] برنامه اجرا نشد (پورت بدون تأیید شما عوض نمی‌شود).")
            _pause()
            return chosen
        if action == "open":
            url = f"http://127.0.0.1:{chosen}"
            print(f"    [✓] نسخهٔ در حال اجرا روی {url} در مرورگر باز می‌شود.")
            if not args.no_browser:
                try:
                    webbrowser.open(url)
                except Exception:
                    pass
            _pause()
            return 0
        APP_PORT = chosen

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
            # Borrowing models/llm from another installation writes into the
            # installation directory, so it runs here (with admin rights).
            try:
                for level, message in borrow_missing_assets(install, log=print):
                    marker = {"ok": "[✓]", "warn": "[!]", "error": "[×]"}.get(str(level), "[·]")
                    print(f"    {marker} {message}")
            except Exception as exc:
                print(f"    [!] استفاده از دارایی‌های نصب دیگر ممکن نشد: {exc!r}")
            report = repair_installation(install, log=print)
            _print_actions(report)
            _write_repair_report(report, args.repair_report)
        print("تعمیر نسخهٔ نصب‌شده انجام شد.")
        return 0

    if install is not None:
        print(f"    مسیر نصب: {install}")
        elevated_done = False
        need_admin = not _is_writable(install) and sys.platform == "win32" and not is_admin()
        if need_admin:
            print("    [!] برای تعمیر این مسیر دسترسی مدیر لازم است؛ درخواست UAC ...")
            elevated_done = relaunch_elevated(["--repair-only", "--serve-only"])
        if elevated_done:
            print("    [✓] تعمیر نسخهٔ نصب‌شده با دسترسی مدیر انجام شد.")
        else:
            try:
                for level, message in borrow_missing_assets(install, log=print):
                    marker = {"ok": "[✓]", "warn": "[!]", "error": "[×]"}.get(str(level), "[·]")
                    print(f"    {marker} {message}")
            except Exception as exc:
                print(f"    [!] استفاده از دارایی‌های نصب دیگر ممکن نشد: {exc!r}")
            report = repair_installation(install, log=print)
            _print_actions(report)

        try:
            for level, message in fix_installed_shortcuts(install, log=print):
                marker = {"ok": "[✓]", "warn": "[!]", "error": "[×]"}.get(str(level), "[·]")
                print(f"    {marker} {message}")
        except Exception as exc:
            print(f"    [!] اصلاح میان‌برها ممکن نشد: {exc!r}")

        persist_asset_environment(install, log=print)
        if not args.serve_only:
            print("    بررسی اجرای نسخهٔ نصب‌شده ...")
            try:
                diagnose_installed_backend(install, log=print)
            except Exception as exc:
                print(f"    [!] بررسی بک‌اند نصب‌شده ممکن نشد: {exc!r}")
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
        # The port was busy again after the checks above (a race with another
        # program).  Moving to "some free port" here is exactly what used to
        # make the address change on every run, so the launcher stops instead.
        print(f"    [×] پورت {APP_PORT} بین تأیید شما و اجرای سرور اشغال شد.")
        print("        هیچ پورتی بدون تأیید شما عوض نمی‌شود؛ این پنجره را ببندید،")
        print("        برنامه‌ای را که این پورت را گرفته ببندید و دوباره اجرا کنید.")
        print(f"    [port] busy={APP_PORT} decision=exit")
        _pause()
        return PORT_NOT_AVAILABLE_EXIT

    configure_environment(install, directory)
    start_llm(install, log=print)

    url = f"http://127.0.0.1:{APP_PORT}"
    print(f"۳) اجرای برنامهٔ مستقل روی {url}")
    print("    این پنجره را باز نگه دارید؛ برای خروج این پنجره را ببندید.")
    if install is not None:
        print("")
        print("   برای اجرای برنامهٔ نصب‌شده (میان‌بر قبلی):")
        print("    • ابتدا این پنجره را ببندید تا پورت آزاد شود،")
        print("    • سپس همان میان‌بر «دستیار هوشمند سازمانی» را اجرا کنید.")
        print("      اگر هنوز صفحهٔ سفید بود، همین فایل را دوباره اجرا کنید و")
        print("      «گزارش بررسی» بالا را برای پشتیبانی بفرستید.")
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
