"""LLM service.

Talks to a locally running llama.cpp ``llama-server`` (OpenAI-compatible
``/v1/chat/completions``) when available. If the server is not reachable (e.g.
during the offline demo before models are placed, or on a low-resource machine),
it falls back to a fully local, dependency-free *extractive* answerer that
composes an answer directly from the retrieved RAG context. This guarantees the
chat experience — including streaming and citations — works 100% offline with
zero model downloads, while the real Qwen model is used automatically whenever
``llama-server.exe`` is running on the Windows install.
"""
from __future__ import annotations

import json
import re
from typing import AsyncIterator, Dict, List, Optional

import httpx

from core.config import settings
from utils.persian import (
    approximate_tokens,
    normalize_persian,
    tokenize,
    truncate_words,
)


class RepetitionGuard:
    """Detects degenerate repetition in a token stream and stops it.

    Sampling penalties make loops unlikely but not impossible, so this is a
    hard backstop: even if the model starts cycling, the user never sees a
    wall of the same clause repeated hundreds of times.

    Two independent checks run over a rolling tail of the generated text:

    1. Phrase loop - the same normalized n-gram repeats ``max_phrase_repeats``
       times in a row (catches "و مزی ثابت و مزی ثابت و مزی ثابت ...").
    2. Low diversity - once the tail is long enough, the ratio of unique
       words to total words collapses below ``min_unique_ratio``.
    """

    def __init__(
        self,
        window_words: int = 60,
        max_phrase_repeats: int = 4,
        min_unique_ratio: float = 0.22,
        min_words_before_check: int = 40,
    ) -> None:
        self.window_words = window_words
        self.max_phrase_repeats = max_phrase_repeats
        self.min_unique_ratio = min_unique_ratio
        self.min_words_before_check = min_words_before_check
        self._words: List[str] = []

    def feed(self, text: str) -> bool:
        """Add streamed text. Returns True when the stream should be cut."""
        if not text:
            return False
        self._words.extend(text.split())
        if len(self._words) < self.min_words_before_check:
            return False
        tail = self._words[-self.window_words :]

        # 1) Repeating n-gram check, from longer to shorter phrases.
        for size in range(1, 7):
            if len(tail) < size * self.max_phrase_repeats:
                continue
            block = tail[-size:]
            repeats = 1
            pos = len(tail) - size
            while pos - size >= 0 and tail[pos - size : pos] == block:
                repeats += 1
                pos -= size
                if repeats >= self.max_phrase_repeats:
                    return True

        # 2) Vocabulary-collapse check.
        if len(tail) >= self.window_words:
            unique_ratio = len(set(tail)) / len(tail)
            if unique_ratio < self.min_unique_ratio:
                return True
        return False


class LLMSession:
    """OpenAI-compatible chat client bound to a per-request httpx client."""

    def __init__(self, base_url: str, model: str, timeout: float = 180.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self._available: Optional[bool] = None

    async def is_available(self) -> bool:
        if self._available is not None:
            return self._available
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                r = await client.get(f"{self.base_url}/models")
                self._available = r.status_code == 200
        except Exception:
            self._available = False
        return self._available

    async def stream_chat(
        self, messages: List[Dict[str, str]], temperature: Optional[float] = None
    ) -> AsyncIterator[str]:
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "temperature": settings.llm_temperature if temperature is None else temperature,
            "max_tokens": settings.llm_max_tokens,
            # Repetition control. Without these, llama.cpp defaults to
            # repeat_penalty=1.0 (disabled), and a small instruct model at
            # temperature 0.1 will collapse into an infinite loop, emitting
            # the same clause ("و مزی ثابت و مزی ثابت ...") until max_tokens
            # is exhausted. This is the single most common cause of the
            # "stuck answer" symptom on Persian RAG prompts.
            "repeat_penalty": settings.llm_repeat_penalty,
            "frequency_penalty": settings.llm_frequency_penalty,
            "presence_penalty": settings.llm_presence_penalty,
        }
        guard = RepetitionGuard()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0].get("delta", {})
                        content = delta.get("content")
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
                    if content:
                        yield content
                        if guard.feed(content):
                            # Degenerate loop detected - abandon the stream
                            # instead of flooding the user with repeats.
                            print("[llm] repetition loop detected, stopping stream")
                            return


# --------------------------------------------------------------------------- #
# Offline extractive fallback
# --------------------------------------------------------------------------- #
def _best_snippet(query_tokens: List[str], text: str) -> tuple[str, float]:
    sentences = re.split(r"(?<=[.!?؟。])\s+|\n+", text)
    best, best_score = "", 0.0
    qset = set(query_tokens)
    for sent in sentences:
        stoks = set(tokenize(sent))
        if not stoks:
            continue
        overlap = len(qset & stoks)
        score = overlap / (len(qset) + 1e-9)
        if score > best_score:
            best, best_score = sent.strip(), score
    return best, best_score


async def extractive_stream(
    question: str,
    sources: List[Dict],
    history: List[Dict[str, str]],
    language: str = "fa",
) -> AsyncIterator[str]:
    """Yield an answer composed from retrieved sources, word-by-word."""
    q_tokens = tokenize(normalize_persian(question))
    fa = language.startswith("fa")

    if not sources:
        noinfo = (
            "بر اساس منابع موجود، اطلاعاتی برای پاسخ به این پرسش یافت نشد. "
            "لطفاً سند مرتبط را بارگذاری کنید یا پرسش را دقیق‌تر مطرح سازید."
            if fa
            else "I could not find information in the available sources to answer this question."
        )
        for word in noinfo.split():
            yield word + " "
        return

    # Pick the most relevant snippets.
    ranked = []
    for src in sources:
        snippet, score = _best_snippet(q_tokens, src.get("content", ""))
        ranked.append((score, snippet, src))
    ranked.sort(key=lambda x: x[0], reverse=True)
    ranked = [r for r in ranked if r[1]][:3]

    intro = (
        f"بر اساس {len(ranked)} منبع بازیابی‌شده، " if fa else f"Based on {len(ranked)} retrieved source(s), "
    )
    yield intro

    for i, (_, snippet, src) in enumerate(ranked, start=1):
        marker = f"[{i}] "
        text = marker + truncate_words(snippet, 60) + " "
        for word in text.split():
            yield word + " "


def build_messages(
    system_prompt: str,
    history: List[Dict[str, str]],
    question: str,
    context: str,
    language: str = "fa",
) -> List[Dict[str, str]]:
    ctx_instruction = (
        "پاسخ خود را تنها بر اساس متن منبع زیر بنویس و به شماره منبع استناد کن. "
        "اگر اطلاعات کافی نیست، صریحاً بگو."
        if language.startswith("fa")
        else "Answer strictly using the source context below and cite the source numbers. "
        "If the context is insufficient, say so explicitly."
    )
    user_block = f"{ctx_instruction}\n\nمنابع:\n{context}\n\nپرسش: {question}"
    messages = [{"role": "system", "content": system_prompt}]

    # Trim history to stay within budget. The budget must also account for
    # what the system prompt and the source block already consume, otherwise
    # history alone could push the request past the model's context window
    # and silently evict the instructions.
    fixed_cost = approximate_tokens(system_prompt) + approximate_tokens(user_block)
    reserve_for_output = settings.llm_max_tokens
    available = settings.llm_context_size - fixed_cost - reserve_for_output
    budget = max(0, min(settings.rag_history_max_tokens, available))

    acc = 0
    trimmed: List[Dict[str, str]] = []
    for msg in reversed(history[-10:]):
        size = approximate_tokens(msg.get("content", ""))
        if acc + size > budget:
            break
        trimmed.insert(0, msg)
        acc += size
    messages.extend(trimmed)
    messages.append({"role": "user", "content": user_block})
    return messages


_service: Optional[LLMSession] = None


def get_llm_service() -> LLMSession:
    global _service
    if _service is None:
        _service = LLMSession(settings.llm_server_url, settings.llm_model_name)
    return _service
