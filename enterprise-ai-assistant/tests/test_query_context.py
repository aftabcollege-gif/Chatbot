"""A follow-up question must be resolved against the conversation first.

Reported behaviour: inside one conversation, "میتوانند از مرخصی استعلاجی
استفاده کنند؟" right after a question about a different kind of leave was
retrieved as if it were a brand-new topic, so the wrong passage was cited.

``standalone_query()`` must decide — before retrieval —

* a *standalone* question keeps its own query (a topic change must not inherit
  the previous subject), and
* a *follow-up* question is resolved into a self-contained query (LLM rewrite
  when the local model is up, a conservative heuristic otherwise).
"""
from __future__ import annotations

import asyncio
import sys
import types
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services import query_context_service as qcs  # noqa: E402  (path set above)


def _history(*pairs):
    messages = []
    for question, answer in pairs:
        messages.append({"role": "user", "content": question})
        messages.append({"role": "assistant", "content": answer})
    return messages


def _stub_llm(reply: str | None, available: bool = True):
    """Install a fake ``services.llm_service`` so no real model is needed."""
    module = types.ModuleType("services.llm_service")
    calls: list = []

    class _LLM:
        async def is_available(self) -> bool:
            return available

        async def complete(self, messages, max_tokens=0, temperature=0.0):
            calls.append(messages)
            if reply is None:
                raise RuntimeError("model unavailable")
            return reply

    module.get_llm_service = lambda: _LLM()
    return module, calls


PREVIOUS = "کارکنان چند روز مرخصی استحقاقی دارند؟"
FOLLOW_UP = "برای مدیران هم همین‌طور است؟"
UNRELATED = "شرایط بازنشستگی پیش از موعد چیست؟"
HISTORY = _history((PREVIOUS, "۲۶ روز کاری در سال."))


class FollowUpDetectionTests(unittest.TestCase):
    def test_reference_marker_is_a_follow_up(self):
        self.assertTrue(qcs._is_followup(FOLLOW_UP, HISTORY))
        self.assertTrue(qcs._is_followup("درباره آن بیشتر توضیح بده", HISTORY))

    def test_conjunction_and_anaphoric_openers_are_follow_ups(self):
        self.assertTrue(qcs._is_followup("و در مورد مدیران؟", HISTORY))
        self.assertTrue(qcs._is_followup("چطور درخواست بدهیم؟", HISTORY))

    def test_short_question_sharing_a_word_is_a_follow_up(self):
        self.assertTrue(qcs._is_followup("مدیران چطور؟", HISTORY))

    def test_a_new_topic_is_not_a_follow_up(self):
        self.assertFalse(qcs._is_followup(UNRELATED, HISTORY))
        self.assertFalse(qcs._is_followup("آیا سامانه پشتیبان‌گیری خودکار دارد؟", HISTORY))

    def test_a_new_topic_without_history_is_not_a_follow_up(self):
        self.assertFalse(qcs._is_followup(UNRELATED, []))


class StandaloneQueryTests(unittest.TestCase):
    def _run(self, question, history=HISTORY, reply=None, available=True):
        module, calls = _stub_llm(reply, available)
        original = sys.modules.get("services.llm_service")
        sys.modules["services.llm_service"] = module
        try:
            result = asyncio.run(qcs.standalone_query(question, history))
        finally:
            if original is None:
                sys.modules.pop("services.llm_service", None)
            else:
                sys.modules["services.llm_service"] = original
        return result, calls

    def test_heuristic_carries_the_previous_subject(self):
        result, _ = self._run(FOLLOW_UP, available=False)
        self.assertEqual(result["method"], "heuristic")
        self.assertTrue(result["rewritten"])
        self.assertIn("مرخصی", result["query"])
        self.assertIn(FOLLOW_UP.strip(), result["query"])

    def test_topic_change_keeps_its_own_query(self):
        result, _ = self._run(UNRELATED, available=False)
        self.assertEqual(result["method"], "none")
        self.assertFalse(result["rewritten"])
        self.assertEqual(result["query"], UNRELATED)

    def test_first_question_is_never_rewritten(self):
        result, _ = self._run(FOLLOW_UP, history=[])
        self.assertEqual(result["query"], FOLLOW_UP)
        self.assertFalse(result["rewritten"])

    def test_llm_rewrite_is_used_when_the_model_answers(self):
        result, calls = self._run(FOLLOW_UP, reply="برای مدیران هم چند روز مرخصی استحقاقی وجود دارد؟")
        self.assertEqual(result["method"], "llm")
        self.assertIn("مرخصی", result["query"])
        self.assertTrue(calls, "the rewriter must be given the conversation")

    def test_llm_noise_is_stripped(self):
        result, _ = self._run(FOLLOW_UP, reply="پرسش بازنویسی‌شده: برای مدیران چند روز مرخصی استحقاقی است؟")
        self.assertNotIn("پرسش بازنویسی‌شده", result["query"])

    def test_broken_llm_falls_back_to_the_heuristic(self):
        result, _ = self._run(FOLLOW_UP, reply=None)
        self.assertEqual(result["method"], "heuristic")
        self.assertIn("مرخصی", result["query"])


if __name__ == "__main__":
    unittest.main()
