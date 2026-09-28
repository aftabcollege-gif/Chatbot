"""The mini launcher must never move the address on its own.

Regression test for the reported behaviour: "every time I run the mini file the
connection port changes" — the launcher walked 8741 → 8752 → 8753 … whenever the
port was busy, so the URL differed on every run and the installed application
(which always uses 8741) stopped answering.

Policy under test:

* 8741 is the default, always;
* the port moves **only** with the user's explicit approval (console answer
  ``1``/``2`` *or* the ``--port`` switch);
* without approval the launcher stops (exit code 4) and closes nothing.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

MINI_DIR = Path(__file__).resolve().parents[1] / "tools" / "mini"
if str(MINI_DIR) not in sys.path:
    sys.path.insert(0, str(MINI_DIR))

import mini_main  # noqa: E402  (path set above)


def _ask(answer: str, calls: list | None = None):
    def _impl(question: str, seconds: int = 0, no_answer: str = "") -> str:
        if calls is not None:
            calls.append(question)
        return answer

    return _impl


class _Ports:
    """A tiny fake network: the given ports are busy, nothing else."""

    def __init__(self, *busy: int) -> None:
        self.busy = set(busy)
        self.closed: list[list[int]] = []

    def is_free(self, port: int) -> bool:
        return port not in self.busy

    def owner_of(self, port: int):
        return {"pid": 4321, "exe": "backend-server.exe" if self.ours else "chrome.exe", "ours": self.ours}

    def close_ports(self, ports, log=print):
        self.closed.append(list(ports))
        for port in ports:
            self.busy.discard(port)
        return list(ports)

    def answers(self, port: int) -> bool:
        return self.health

    ours = True
    health = True


def _resolve(ports: _Ports, *, answer: str, explicit=False, restart=False, calls=None, health=True):
    ports.health = health
    return mini_main.resolve_serve_port(
        mini_main.APP_PORT,
        explicit=explicit,
        restart=restart,
        ask=_ask(answer, calls),
        is_free=ports.is_free,
        owner_of=ports.owner_of,
        close_ports=ports.close_ports,
        app_answers=ports.answers,
        log=lambda *a, **k: None,
    )


class PortPolicyTests(unittest.TestCase):
    def test_defaults_are_locked(self):
        self.assertEqual(mini_main.APP_PORT, 8741)
        self.assertEqual(mini_main.FALLBACK_PORT, 8751)
        self.assertEqual(mini_main.PORT_NOT_AVAILABLE_EXIT, 4)

    def test_free_port_is_used_without_asking(self):
        ports = _Ports()
        calls: list = []
        action = _resolve(ports, answer="", calls=calls)
        self.assertEqual(action, ("serve", 8741))
        self.assertEqual(calls, [], "the user must not be asked when 8741 is free")
        self.assertEqual(ports.closed, [])

    def test_explicit_port_is_respected(self):
        ports = _Ports()
        action = mini_main.resolve_serve_port(
            8799,
            explicit=True,
            ask=_ask(""),
            is_free=ports.is_free,
            owner_of=ports.owner_of,
            close_ports=ports.close_ports,
            app_answers=ports.answers,
            log=lambda *a, **k: None,
        )
        self.assertEqual(action, ("serve", 8799))

    def test_our_previous_copy_is_closed_only_with_approval(self):
        ports = _Ports(8741)
        action = _resolve(ports, answer="1")
        self.assertEqual(action, ("serve", 8741))
        self.assertEqual(ports.closed, [[8741]])

    def test_alternative_port_needs_the_users_choice(self):
        ports = _Ports(8741)
        action = _resolve(ports, answer="2")
        self.assertEqual(action, ("serve", 8751))
        self.assertEqual(ports.closed, [], "choosing another port must not close anything")

    def test_no_answer_keeps_everything_untouched(self):
        ports = _Ports(8741)
        action = _resolve(ports, answer="")
        self.assertEqual(action, ("exit", mini_main.PORT_NOT_AVAILABLE_EXIT))
        self.assertEqual(ports.closed, [], "without approval nothing may be closed")

    def test_foreign_program_is_never_closed(self):
        ports = _Ports(8741)
        ports.ours = False
        action = _resolve(ports, answer="1")
        self.assertEqual(action, ("serve", 8751))
        self.assertEqual(ports.closed, [])

    def test_foreign_program_without_answer_stops(self):
        ports = _Ports(8741)
        ports.ours = False
        action = _resolve(ports, answer="")
        self.assertEqual(action, ("exit", mini_main.PORT_NOT_AVAILABLE_EXIT))
        self.assertEqual(ports.closed, [])

    def test_running_copy_can_just_be_opened(self):
        ports = _Ports(8741)
        action = _resolve(ports, answer="3")
        self.assertEqual(action, ("open", 8741))
        self.assertEqual(ports.closed, [])

    def test_restart_switch_is_explicit_approval(self):
        ports = _Ports(8741)
        action = _resolve(ports, answer="", restart=True)
        self.assertEqual(action, ("serve", 8741))
        self.assertEqual(ports.closed, [[8741]])

    def test_never_serves_on_a_walking_port_number(self):
        """The old bug: 8742/8752/8753… were picked silently. Must never happen."""
        for busy in ([8741], [8741, 8751], [8741, 8742, 8751]):
            ports = _Ports(*busy)
            action = _resolve(ports, answer="")
            self.assertEqual(action, ("exit", mini_main.PORT_NOT_AVAILABLE_EXIT), f"busy={busy}")


if __name__ == "__main__":
    unittest.main()
