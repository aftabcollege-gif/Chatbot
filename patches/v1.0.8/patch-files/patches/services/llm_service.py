"""LLM service.

Talks to a locally running llama.cpp ``llama-server`` (OpenAI-compatible
``/v1/chat/completions``) when available. If the server is not reachable (e.g.
during the offline demo before models are placed, or on a low-resource machine),
it falls back to a fully local, dependency-free *extractive* answerer that
composes an answer directly from the retrieved RAG context. This guarantees the
chat experience — including streaming and citations — works 100% offline with
zero model downloads, while the real Qwen model is used automatically whenever
``llama-server.exe`` is running on the Windows install.

Context budget
--------------
``llama-server`` is started with ``--ctx-size 8192 --parallel 2``, i.e. 4096
tokens per request slot. A prompt that does not fit is rejected with HTTP 400 —
which used to surface in the UI as «LLM stream error». Therefore:

* every request is planned against :attr:`settings.llm_slot_tokens` *before* it
  is sent (see :meth:`LLMSession.plan`), and
* a rejected request is retried once with the optional sampling extensions
  removed, then the caller trims the context and retries
  (:class:`ContextOverflowError`), and only then does the answer degrade to the
  extractive mode — the user never sees a bare error instead of an answer.
"""
from __future__ import annotations

import json
import re
from typing import AsyncIterator, Dict, List, Optional, Tuple

import httpx

from core.config import settings
from utils.persian import (
    approximate_tokens,
    content_terms,
    normalize_persian,
    tokenize,
    truncate_words,
)

#: llama.cpp accepts a few extra sampling parameters next to the OpenAI fields.
_SAMPLING_EXTRAS: Dict[str, object] = {"top_p": 0.9, "repeat_penalty": 1.15}


def _setting(name: str, default):
    """Read a config value, tolerating an older ``core.config``.

    Patch builds replace only some modules, so a config key that exists in this
    tree may be missing from the frozen one — a missing key must degrade to its
    default, never raise ``AttributeError`` at request time.
    """
    value = getattr(settings, name, None)
    return default if value is None else value


class ContextOverflowError(RuntimeError):
    """The prompt does not fit into the llama-server slot."""

    def __init__(self, prompt_tokens: int, slot_tokens: int) -> None:
        super().__init__(
            f"prompt needs {prompt_tokens} tokens but the model slot has {slot_tokens}"
        )
        self.prompt_tokens = prompt_tokens
        self.slot_tokens = slot_tokens


class LLMRequestError(RuntimeError):
    """llama-server answered with an error status."""

    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"llama-server HTTP {status}: {body[:300]}")
        self.status = status
        self.body = body


def estimate_tokens(messages: List[Dict[str, str]]) -> int:
    """Cheap prompt size estimate (Persian/Latin words + role overhead)."""
    total = 0
    for message in messages:
        total += approximate_tokens(str(message.get("content", "")))
    return total + 4 * max(1, len(messages))


class LLMSession:
    """OpenAI-compatible chat client bound to a per-request httpx client."""

    def __init__(self, base_url: str, model: str, timeout: float = 180.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self._available: Optional[bool] = None
        self._slot_tokens: Optional[int] = None
        self._slot_probed = False

    # ---- budget -----------------------------------------------------------
    @property
    def slot_tokens(self) -> int:
        """Tokens one request may use.

        Prefers what the running server actually reports (``/props``): the
        shells start llama-server themselves, so the configured value can be
        out of date — and planning against a wrong number is what produced
        HTTP 400 «LLM stream error» before.
        """
        if self._slot_tokens:
            return self._slot_tokens
        configured = _setting("llm_slot_tokens", 0)
        if configured:
            return int(configured)
        context = int(_setting("llm_context_size", 4096))
        parallel = max(1, int(_setting("llm_parallel", 1)))
        return max(512, context // parallel)

    async def refresh_limits(self) -> None:
        """Ask llama-server for its real context size and slot count."""
        if self._slot_probed:
            return
        self._slot_probed = True
        def _as_int(value: object) -> Optional[int]:
            try:
                number = int(value)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                return None
            return number if number > 0 else None

        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                response = await client.get(f"{self.base_url}/props")
            if response.status_code != 200:
                return
            props = response.json()
        except Exception:
            return
        generation = props.get("default_generation_settings") or {}
        per_slot = _as_int(generation.get("n_ctx_per_seq")) or _as_int(props.get("n_ctx_per_seq"))
        total = _as_int(props.get("n_ctx")) or _as_int(generation.get("n_ctx"))
        slots = _as_int(props.get("total_slots")) or _as_int(generation.get("total_slots"))
        if per_slot:
            self._slot_tokens = per_slot
        elif total and slots:
            self._slot_tokens = max(512, total // slots)
        elif total:
            self._slot_tokens = total
        if self._slot_tokens:
            print(f"[llm] context per request: {self._slot_tokens} tokens")

    def plan(
        self,
        messages: List[Dict[str, str]],
        max_tokens: Optional[int] = None,
    ) -> Tuple[int, int]:
        """Return ``(allowed_max_tokens, prompt_tokens)`` for this request.

        Raises :class:`ContextOverflowError` when even a minimal answer would
        not fit — the caller then trims the retrieved context and retries
        instead of sending a request llama-server will reject.
        """
        prompt_tokens = estimate_tokens(messages)
        slot = self.slot_tokens
        ceiling = int(_setting("llm_max_tokens", 1024))
        wanted = min(max_tokens or ceiling, ceiling)
        room = slot - prompt_tokens - int(_setting("llm_reserve_tokens", 320))
        if room < 64:
            raise ContextOverflowError(prompt_tokens, slot)
        return min(wanted, room), prompt_tokens

    async def is_available(self) -> bool:
        if self._available is None:
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    r = await client.get(f"{self.base_url}/models")
                    self._available = r.status_code == 200
            except Exception:
                self._available = False
        if self._available:
            await self.refresh_limits()
        return self._available

    # ---- streaming --------------------------------------------------------
    def _payload(
        self,
        messages: List[Dict[str, str]],
        max_tokens: int,
        temperature: Optional[float],
        extras: bool,
    ) -> Dict[str, object]:
        payload: Dict[str, object] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "temperature": settings.llm_temperature if temperature is None else temperature,
            "max_tokens": max_tokens,
        }
        if extras:
            payload.update(_SAMPLING_EXTRAS)
        return payload

    async def _stream_once(
        self, payload: Dict[str, object]
    ) -> AsyncIterator[str]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST", f"{self.base_url}/chat/completions", json=payload
            ) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", "replace")
                    raise LLMRequestError(resp.status_code, body)
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
                        if content:
                            yield content
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> AsyncIterator[str]:
        """Stream an answer, keeping the request inside the model's context.

        A 400 is retried once without the optional sampling extensions (some
        OpenAI-compatible servers reject them) before it is reported.
        """
        allowed, _ = self.plan(messages, max_tokens)
        yielded = False
        try:
            async for token in self._stream_once(
                self._payload(messages, allowed, temperature, extras=True)
            ):
                yielded = True
                yield token
            return
        except LLMRequestError as exc:
            if yielded or exc.status != 400:
                raise
            # The extras were the problem: retry with the plain OpenAI payload.
            async for token in self._stream_once(
                self._payload(messages, allowed, temperature, extras=False)
            ):
                yield token

    async def complete(
        self,
        messages: List[Dict[str, str]],
        max_tokens: int = 256,
        temperature: float = 0.0,
    ) -> str:
        """One-shot completion (no streaming).

        Used for the small helper tasks the chat pipeline needs — rewriting a
        follow-up question into a standalone one, for example — where the whole
        answer has to be parsed before continuing.
        """
        try:
            allowed, _ = self.plan(messages, max_tokens)
        except ContextOverflowError:
            allowed = min(max_tokens, 128)
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "temperature": temperature,
            "max_tokens": allowed,
        }
        async with httpx.AsyncClient(timeout=min(self.timeout, 60.0)) as client:
            resp = await client.post(f"{self.base_url}/chat/completions", json=payload)
            if resp.status_code >= 400:
                raise LLMRequestError(resp.status_code, resp.text)
            data = resp.json()
        try:
            return (data["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError):
            return ""


# --------------------------------------------------------------------------- #
# Offline extractive fallback
# --------------------------------------------------------------------------- #
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?؟。])\s+|\n+")
_COMPARE_RE = re.compile(r"[\s\u200c\u200d.,،؛;:!?؟«»\"'()\[\]-]+")


def _compare_key(text: str) -> str:
    """ZWNJ/punctuation-insensitive key used to detect repeated text."""
    return _COMPARE_RE.sub("", normalize_persian(text)).lower()


def _best_snippet(terms: List[str], text: str) -> Tuple[str, float]:
    """The sentence of *text* that covers the query terms best."""
    qset = set(terms)
    if not qset:
        return (text.strip()[:280], 0.0)
    best, best_score = "", 0.0
    for sentence in _SENTENCE_SPLIT.split(text or ""):
        sentence = sentence.strip()
        if len(sentence) < 8:
            continue
        stoks = set(tokenize(sentence))
        if not stoks:
            continue
        overlap = len(qset & stoks)
        if overlap == 0:
            continue
        score = overlap / len(qset)
        # Prefer sentences that are not just a heading and are reasonably long.
        score += min(len(sentence), 220) / 2200
        if score > best_score:
            best, best_score = sentence, score
    return best, best_score


async def extractive_stream(
    question: str,
    sources: List[Dict],
    history: List[Dict[str, str]],
    language: str = "fa",
    note: Optional[str] = None,
) -> AsyncIterator[str]:
    """Yield an answer composed from retrieved sources, word-by-word.

    Repeated sentences/sections are dropped, so the answer never quotes the same
    passage twice (chunk overlap used to make that happen).
    """
    fa = language.startswith("fa")
    q_terms = content_terms(question) or tokenize(normalize_persian(question))

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

    ranked: List[Tuple[float, str, Dict]] = []
    for src in sources:
        snippet, score = _best_snippet(q_terms, src.get("content", ""))
        if snippet and score > 0:
            ranked.append((score, snippet, src))
    ranked.sort(key=lambda item: item[0], reverse=True)

    picked: List[Tuple[str, Dict]] = []
    seen: List[str] = []
    for _score, snippet, src in ranked:
        if len(picked) >= 3:
            break
        key = _compare_key(snippet)
        if not key or any(key in other or other in key for other in seen):
            continue
        seen.append(key)
        picked.append((snippet, src))

    if note:
        for word in note.split():
            yield word + " "
        yield "\n\n"

    if not picked:
        fallback = truncate_words((sources[0].get("content") or "").strip(), 80)
        picked = [(fallback, sources[0])]

    for index, (snippet, _src) in enumerate(picked, start=1):
        for word in f"[{index}] ".split():
            yield word + " "
        for word in truncate_words(snippet, 80).split():
            yield word + " "
        yield "\n"


def build_messages(
    system_prompt: str,
    history: List[Dict[str, str]],
    question: str,
    context: str,
    language: str = "fa",
    history_budget_tokens: Optional[int] = None,
) -> List[Dict[str, str]]:
    """Assemble the chat request (system + trimmed history + context + question).

    The context itself is already trimmed by the caller against the model slot;
    here only the conversation history is budgeted, so a long chat cannot push
    the retrieved sources out of the window.
    """
    ctx_instruction = (
        "پاسخ خود را تنها بر اساس متن منابع زیر بنویس و به شماره منبع ([1]، [2] و ...) استناد کن. "
        "هر مطلب را فقط یک بار بنویس و جمله‌ها را تکرار نکن. "
        "اگر اطلاعات کافی نیست، صریحاً بگو."
        if language.startswith("fa")
        else "Answer strictly using the source context below, cite the source numbers, "
        "never repeat a sentence, and say so explicitly when the context is insufficient."
    )
    user_block = f"{ctx_instruction}\n\nمنابع:\n{context}\n\nپرسش: {question}"
    budget = history_budget_tokens or settings.rag_history_max_tokens
    acc = 0
    trimmed: List[Dict[str, str]] = []
    for msg in reversed(history[-10:]):
        size = approximate_tokens(str(msg.get("content", "")))
        if acc + size > budget:
            break
        trimmed.insert(0, msg)
        acc += size
    return [
        {"role": "system", "content": system_prompt},
        *trimmed,
        {"role": "user", "content": user_block},
    ]


_service: Optional[LLMSession] = None


def get_llm_service() -> LLMSession:
    global _service
    if _service is None:
        _service = LLMSession(settings.llm_server_url, settings.llm_model_name)
    return _service


def reset_llm_service() -> None:
    """Forget the cached availability (used by the admin health page/tests)."""
    global _service
    _service = None
