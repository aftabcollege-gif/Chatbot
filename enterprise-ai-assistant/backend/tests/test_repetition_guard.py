"""Tests for the repetition guard and the retrieval-confidence fixes.

Run from the backend directory:

    python -m pytest tests/ -v
    # or, with no pytest installed:
    python tests/test_repetition_guard.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.llm_service import RepetitionGuard  # noqa: E402


# --------------------------------------------------------------------------- #
# Repetition guard
# --------------------------------------------------------------------------- #
def test_catches_the_real_world_loop() -> None:
    """The exact failure reported by the user: a clause repeating forever."""
    guard = RepetitionGuard()
    prefix = "تفاوت مرخصی استحقاقی سالانه کارمند با کارگر در این قانون به شرح زیر است "
    assert guard.feed(prefix) is False

    tripped_at = None
    for i in range(200):
        if guard.feed("و مزی ثابت "):
            tripped_at = i
            break
    assert tripped_at is not None, "guard never fired on a repeating clause"
    assert tripped_at < 12, f"guard fired too late (after {tripped_at} repeats)"


def test_catches_single_word_loop() -> None:
    guard = RepetitionGuard()
    guard.feed("پاسخ این است که " * 6)
    fired = any(guard.feed("ثابت ") for _ in range(100))
    assert fired


def test_allows_a_normal_long_answer() -> None:
    """A genuine, varied Persian answer must stream through untouched."""
    guard = RepetitionGuard()
    answer = (
        "مرخصی استحقاقی سالانه کارگران مشمول قانون کار طبق ماده ۶۴ معادل یک ماه "
        "است که روزهای جمعه نیز جزو آن محسوب می‌شود. برای کارمندان مشمول قانون "
        "مدیریت خدمات کشوری این میزان سی روز در سال تعیین شده و ذخیره‌سازی آن "
        "تابع شرایط جداگانه‌ای است. تفاوت اصلی در مرجع قانونی حاکم، نحوه محاسبه "
        "روزهای تعطیل و سقف مجاز ذخیره مرخصی میان این دو گروه است. همچنین در "
        "کارهای سخت و زیان‌آور مدت مرخصی به پنج هفته افزایش می‌یابد و باید در "
        "دو نوبت استفاده شود تا سلامت نیروی کار حفظ گردد."
    )
    for word in answer.split():
        assert guard.feed(word + " ") is False, f"false positive near: {word}"


def test_allows_legitimate_short_repetition() -> None:
    """Natural repetition (bullet lists, legal phrasing) must not trip it."""
    guard = RepetitionGuard()
    text = (
        "ماده ۶۴ مرخصی استحقاقی سالانه کارگران یک ماه است "
        "ماده ۶۵ مرخصی کارهای سخت پنج هفته تعیین شده "
        "ماده ۶۶ کارگر نمی‌تواند بیش از نه روز ذخیره کند "
        "ماده ۶۷ در مورد کارهای فصلی ترتیب دیگری مقرر است "
    )
    for word in text.split():
        assert guard.feed(word + " ") is False


def test_empty_input_is_safe() -> None:
    guard = RepetitionGuard()
    assert guard.feed("") is False
    assert guard.feed("سلام") is False


# --------------------------------------------------------------------------- #
# Confidence scoring
# --------------------------------------------------------------------------- #
class _Chunk:
    def __init__(self, score: float) -> None:
        self.score = score


def test_confidence_reflects_the_best_match() -> None:
    """A perfect top hit must not be dragged to ~8% by weak filler."""
    from services.rag_service import average_confidence

    chunks = [_Chunk(1.0), _Chunk(0.05), _Chunk(0.03), _Chunk(0.02), _Chunk(0.01)]
    old_style = sum(c.score for c in chunks) / len(chunks)
    new = average_confidence(chunks)

    assert old_style < 0.25, "sanity: the old average really was this low"
    assert new > 0.8, f"expected a high confidence for a perfect hit, got {new}"


def test_confidence_stays_low_for_weak_results() -> None:
    from services.rag_service import average_confidence

    assert average_confidence([_Chunk(0.1), _Chunk(0.05)]) < 0.2


def test_confidence_handles_empty_and_single() -> None:
    from services.rag_service import average_confidence

    assert average_confidence([]) == 0.0
    assert average_confidence([_Chunk(0.9)]) == 0.9


def test_confidence_is_clamped() -> None:
    from services.rag_service import average_confidence

    assert 0.0 <= average_confidence([_Chunk(5.0), _Chunk(-2.0)]) <= 1.0


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  PASS  {name}")
            except AssertionError as exc:
                failures += 1
                print(f"  FAIL  {name}: {exc}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ERROR {name}: {type(exc).__name__}: {exc}")
    print("\nall tests passed" if not failures else f"\n{failures} test(s) failed")
    sys.exit(1 if failures else 0)
