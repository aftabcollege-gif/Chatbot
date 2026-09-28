"""Resolve follow-up questions against the conversation before retrieving.

A user rarely repeats the subject: after "مرخصی استحقاقی چند روز است؟" the next
message is "برای مدیران هم همینطور است؟" — the retrieval query alone carries no
subject, so the vector search finds the wrong chunks (or nothing) even though the
answer is in the knowledge base.

:func:`standalone_query` turns such a message into a self-contained query:

* when the local LLM is available it is asked (in Persian) to rewrite the last
  user message into a standalone question using the previous turns — the model
  is the only component that can resolve pronouns and elided subjects reliably;
* when the LLM is not running yet, a conservative heuristic keeps the behaviour
  useful: a short question or one that starts with a conjunction / contains a
  referring expression ("آن", "این", "همان", "چطور", "بیشتر", ...) is combined
  with the previous user question.

The rewritten query is only used for **retrieval**.  The answer is still
generated from the user's own wording (plus the history that is already sent to
the model), so the reply reads naturally.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

#: Words that cannot stand alone: seeing one of these means the message refers
#: back to something already said ("همینطور", "آن را", "بیشتر", ...).
_REFERENCE_MARKERS = (
    "همین‌طور",
    "همینطور",
    "همین",
    "همان",
    "آن‌ها",
    "آنها",
    "آن را",
    "آنرا",
    "این‌ها",
    "اینها",
    "درباره‌اش",
    "درباره آن",
    "مورد آن",
    "موردش",
    "بیشتر",
    "ادامه",
    "توضیح بده",
    "توضیح دهید",
    "مثال بزن",
    "یعنی",
    "اش ",
    "شان ",
    "ایشان",
)

#: A message that starts with one of these continues the previous turn.
_CONJUNCTION_STARTS = ("و ", "و‌", "اما ", "پس ", "خب ", "نیز ", "در این مورد", "درباره این")

#: Short questions that open with these words have no subject of their own
#: ("چطور درخواست بدهیم؟" right after a question about leave requests).
_ANAPHORIC_OPENERS = ("چطور", "چگونه", "چرا", "یعنی", "بیشتر", "ادامه بده")

#: very short questions usually omit their subject — but only count them as a
#: follow-up when they also reuse a word from the previous question (or carry a
#: reference marker), otherwise a topic change would inherit the old subject.
_SHORT_QUESTION_WORDS = 4

#: words ignored when comparing the two questions
_STOPWORDS = {
    "است", "هست", "هستند", "داریم", "دارد", "دارند", "شود", "شده", "می", "با", "برای",
    "از", "به", "در", "که", "این", "آن", "را", "هم", "یا", "و", "چه", "چی", "چند",
    "کدام", "چطور", "چگونه", "چرا", "کجا", "کی", "آیا", "تا", "بر", "یک", "های",
}

#: how many previous turns are handed to the rewriter
_HISTORY_TURNS = 6

_REWRITE_PROMPT_FA = (
    "تو یک دستیار بازنویسی پرسش هستی. با توجه به گفت‌وگوی زیر، آخرین پیام کاربر را "
    "به یک پرسش مستقل و کامل به فارسی بازنویسی کن؛ طوری که بدون خواندن گفت‌وگو هم "
    "موضوع آن روشن باشد. قواعد:\n"
    "- فقط خودِ پرسش بازنویسی‌شده را بنویس؛ هیچ توضیح، مقدمه یا نقل‌قولی اضافه نکن.\n"
    "- اگر آخرین پیام کاربر خودش مستقل و کامل است، همان را بی‌کم‌وکاست برگردان.\n"
    "- زمان، عدد یا شرطی از خودت اضافه نکن.\n"
)

_REWRITE_PROMPT_EN = (
    "You rewrite questions. Given the conversation below, rewrite the user's last "
    "message as a standalone question that makes sense without the conversation. "
    "Output only the rewritten question, with no explanation. If the last message "
    "is already standalone, return it unchanged. Do not invent facts."
)


def _content_words(text: str) -> set:
    words = re.findall(r"[\w\u0600-\u06FF]+", text or "")
    return {w for w in words if len(w) > 2 and w not in _STOPWORDS}


def _has_reference_marker(text: str) -> bool:
    lowered = f" {text.strip()} "
    return any(marker in lowered for marker in _REFERENCE_MARKERS)


def _is_followup(question: str, history: Optional[List[Dict[str, str]]] = None) -> bool:
    """True when *question* only makes sense together with the previous turn."""
    text = (question or "").strip()
    if not text:
        return False
    if _has_reference_marker(text):
        return True
    if text.startswith(_CONJUNCTION_STARTS):
        return True
    if len(text.split()) <= 6 and text.startswith(_ANAPHORIC_OPENERS):
        return True
    previous = _last_user_question(history or [])
    shares_topic = bool(_content_words(text) & _content_words(previous)) if previous else False
    if len(text.split()) <= _SHORT_QUESTION_WORDS and (shares_topic or not previous):
        return True
    # A very short question that *contains* an anaphoric word ("مدیران چطور؟")
    # has no subject of its own either, even when it shares no word with the
    # previous question.
    if len(text.split()) <= _SHORT_QUESTION_WORDS and any(
        opener in text for opener in _ANAPHORIC_OPENERS
    ):
        return True
    return False


def _last_user_question(history: List[Dict[str, str]]) -> str:
    for message in reversed(history):
        if message.get("role") == "user":
            return (message.get("content") or "").strip()
    return ""


def _heuristic_query(question: str, history: List[Dict[str, str]]) -> str:
    """Combine the follow-up with the previous question (no LLM needed)."""
    previous = _last_user_question(history)
    if not previous or previous == question.strip():
        return question.strip()
    if not _is_followup(question, history):
        return question.strip()
    return f"{previous} — {question.strip()}"


def _as_prompt(history: List[Dict[str, str]], question: str, language: str) -> List[Dict[str, str]]:
    prompt = _REWRITE_PROMPT_FA if language.startswith("fa") else _REWRITE_PROMPT_EN
    lines: List[str] = []
    for message in history[-_HISTORY_TURNS:]:
        role = "کاربر" if message.get("role") == "user" else "دستیار"
        content = (message.get("content") or "").strip().replace("\n", " ")
        if len(content) > 500:
            content = content[:500] + "…"
        lines.append(f"{role}: {content}")
    conversation = "\n".join(lines)
    return [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": (
                f"گفت‌وگو:\n{conversation}\n\nآخرین پیام کاربر: {question.strip()}\n\n"
                "پرسش بازنویسی‌شده:"
            ),
        },
    ]


async def standalone_query(
    question: str,
    history: Optional[List[Dict[str, str]]] = None,
    language: str = "fa",
) -> Dict[str, Any]:
    """Return ``{query, rewritten, method}`` for the retrieval step.

    ``method`` is ``"llm"``, ``"heuristic"`` or ``"none"`` so the UI/logs can
    explain how the query was produced.
    """
    question = (question or "").strip()
    history = history or []
    previous = _last_user_question(history)
    if not question or not previous:
        return {"query": question, "rewritten": False, "method": "none"}

    # A standalone question is used verbatim (no need to bother the model).
    if not _is_followup(question, history):
        return {"query": question, "rewritten": False, "method": "none"}

    try:
        from services import llm_service

        llm = llm_service.get_llm_service()
        if await llm.is_available():
            text = await llm.complete(
                _as_prompt(history, question, language),
                max_tokens=120,
                temperature=0.0,
            )
            candidate = _clean(text)
            if candidate and 2 <= len(candidate.split()) <= 60:
                return {"query": candidate, "rewritten": True, "method": "llm"}
    except Exception:
        pass

    fallback = _heuristic_query(question, history)
    return {
        "query": fallback,
        "rewritten": fallback != question,
        "method": "heuristic" if fallback != question else "none",
    }


def _clean(text: str) -> str:
    """Strip the noise small models like to add around the rewritten question."""
    text = (text or "").strip()
    text = re.sub(r"^(پرسش بازنویسی‌شده|پرسش مستقل|Rewrite|Question)\s*[:：]\s*", "", text, flags=re.I)
    text = text.strip().strip('"').strip("«»").strip("'").strip()
    # keep the first line only
    return text.splitlines()[0].strip() if text else ""


__all__ = ["standalone_query"]
