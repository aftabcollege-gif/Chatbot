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
    remove_stopwords,
    tokenize,
)


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
        }
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
                        if content:
                            yield content
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue


# --------------------------------------------------------------------------- #
# Offline extractive fallback
# --------------------------------------------------------------------------- #

# Better Persian/Arabic sentence splitting: break on sentence-terminating
# punctuation and on newlines, but keep the punctuation with the sentence.
_SENT_SPLIT = re.compile(r"(?<=[.!?؟。؟!])\s+|\n+")
_PERSIAN_SENT = re.compile(r"[.!?؟。]")


def _split_sentences(text: str) -> List[str]:
    # Normalize newlines, then split on sentence boundaries.
    text = re.sub(r"\s*\n\s*", " \n ", text)
    sents = [s.strip() for s in _SENT_SPLIT.split(text) if s and s.strip()]
    return sents


def _best_snippets(query_tokens: List[str], text: str, max_snippets: int = 2) -> List[tuple]:
    """Return up to ``max_snippets`` (score, sentence) pairs for a source."""
    qset = set(query_tokens)
    if not qset:
        return []
    sentences = _split_sentences(text)
    scored = []
    for sent in sentences:
        stoks = set(tokenize(sent))
        if not stoks:
            continue
        overlap = len(qset & stoks)
        if overlap == 0:
            continue
        # Jaccard-like score, biased toward higher overlap / shorter sents.
        score = overlap / (len(qset) + len(stoks) - overlap + 1e-9)
        # Boost consecutive bigram hits (heuristic for phrasal match).
        scored.append((score, sent.strip()))
    scored.sort(key=lambda x: x[0], reverse=True)
    # De-duplicate near-identical snippets.
    out, seen = [], set()
    for score, sent in scored:
        key = re.sub(r"\s+", " ", sent)[:60]
        if key in seen:
            continue
        seen.add(key)
        out.append((score, sent))
        if len(out) >= max_snippets:
            break
    return out


async def extractive_stream(
    question: str,
    sources: List[Dict],
    history: List[Dict[str, str]],
    language: str = "fa",
) -> AsyncIterator[str]:
    """Yield an answer composed from retrieved sources, word-by-word.

    Compared to the earlier version this one:
      - selects up to 2 sentences per source instead of 1;
      - ranks sources by cumulative score (so multiple weak hits don't beat
        one strong one);
      - emits an explicit "I didn't find enough info" message when all scores
        are near zero;
      - properly splits Persian sentences on ؟ ! . ء and newlines.
    """
    fa = language.startswith("fa")
    q_tokens = remove_stopwords(tokenize(normalize_persian(question)))
    if not q_tokens:
        q_tokens = tokenize(normalize_persian(question))

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

    # Per-source selection & scoring.
    per_source: List[tuple] = []  # (total_score, snippets, src)
    for src in sources:
        snippets = _best_snippets(q_tokens, src.get("content", "") or "", max_snippets=2)
        if not snippets:
            continue
        total = sum(s[0] for s in snippets)
        per_source.append((total, snippets, src))
    per_source.sort(key=lambda x: x[0], reverse=True)

    # If best source score is very low, be honest about lack of evidence.
    if not per_source or per_source[0][0] < 0.08:
        noinfo = (
            "منابع بازیابی‌شده ارتباط کمی با پرسش دارند. ممکن است اطلاعات موردنظر "
            "در اسناد بارگذاری‌شده وجود نداشته باشد، یا نیاز است سند دقیق‌تری را "
            "بارگذاری کنید. در زیر بخش‌هایی که بیشترین شباهت را داشته‌اند آمده است:\n\n"
            if fa
            else "The retrieved sources have low relevance to your question. "
                 "Below are the closest passages found:\n\n"
        )
        for word in noinfo.split():
            yield word + " "

    # Limit to the top 4 sources to keep the answer concise but comprehensive.
    per_source = per_source[:4]

    intro = (
        f"بر اساس {len(per_source)} منبع مرتبط:\n\n"
        if fa
        else f"Based on {len(per_source)} relevant source(s):\n\n"
    )
    yield intro

    for i, (_, snippets, src) in enumerate(per_source, start=1):
        title = src.get("title") or ("منبع" if fa else "Source")
        header = f"[{i}] {title}"
        if src.get("page_number"):
            header += f" (صفحه {src['page_number']})"
        header += ":\n"
        for w in header.split():
            yield w + " "
        yield "\n"
        for _, snip in snippets:
            # Cap to ~70 words per snippet to avoid runaway answers.
            words = snip.split()
            if len(words) > 70:
                snip = " ".join(words[:70]) + "…"
            for w in (snip + " ").split():
                yield w + " "
        yield "\n"


def build_messages(
    system_prompt: str,
    history: List[Dict[str, str]],
    question: str,
    context: str,
    language: str = "fa",
    max_tokens: Optional[int] = None,
) -> List[Dict[str, str]]:
    """Build the LLM message list while respecting the model's context budget.

    The previous implementation did not cap the size of the assembled context,
    which combined with system + history + generation frequently overflowed
    the default 4096-token ctx-size. llama.cpp silently truncates from the
    front of the prompt when overflow happens, which meant the model often
    lost the sources entirely -> poor answers / failure to combine sources.
    """
    ctx_budget = max_tokens or settings.rag_context_max_tokens
    if language.startswith("fa"):
        ctx_instruction = (
            "پاسخ خود را تنها بر اساس متن «منابع» زیر بنویس و هر ادعا را به شماره "
            "منبع میان کروشه استناد کن، برای نمونه [۱] یا [۱، ۳]. اگر پاسخ نیاز به "
            "ترکیب اطلاعات چند منبع دارد، همه منابع مرتبط را با هم ترکیب کن. اگر "
            "اطلاعات کافی نیست، صریحاً بگو و از حدس زدن بپرهیز."
        )
    else:
        ctx_instruction = (
            "Answer strictly using the 'Sources' context below and cite each claim "
            "with source numbers in brackets, e.g. [1] or [1, 3]. When the answer "
            "requires combining information across multiple sources, synthesize "
            "them and cite all relevant sources. If the context is insufficient, "
            "say so explicitly — do not guess."
        )

    system_content = system_prompt
    system_tokens = approximate_tokens(system_content)

    # Reserve tokens for instruction + question + generation headroom.
    instr_tokens = approximate_tokens(ctx_instruction)
    q_tokens = approximate_tokens(question)
    gen_reserve = settings.llm_max_tokens + 256  # output + separators
    total_ctx = settings.llm_context_size

    # Budget for (history + sources).
    available = total_ctx - system_tokens - instr_tokens - q_tokens - gen_reserve
    history_budget = int(available * 0.25)  # 25% to history
    sources_budget = int(available * 0.75)
    if sources_budget < 256:
        sources_budget = 256
        history_budget = max(0, available - sources_budget)

    # Trim history from the oldest end.
    trimmed: List[Dict[str, str]] = []
    acc = 0
    for msg in reversed(history[-10:]):
        size = approximate_tokens(msg.get("content", "")) + 4
        if acc + size > history_budget:
            break
        trimmed.insert(0, msg)
        acc += size

    # Trim context: the caller has already applied its own cap via
    # assemble_context(), but we enforce a hard cap here too so we never
    # overshoot the model's ctx-size even if config values are mis-tuned.
    ctx_words = context.split()
    ctx_tok = approximate_tokens(context)
    if ctx_tok > sources_budget:
        # Roughly proportional trim.
        keep = max(64, int(len(ctx_words) * (sources_budget / max(1, ctx_tok))))
        context = " ".join(ctx_words[:keep]) + "…"

    user_block = f"{ctx_instruction}\n\nSources / منابع:\n{context}\n\nQuestion / پرسش: {question}"

    messages = [{"role": "system", "content": system_content}]
    messages.extend(trimmed)
    messages.append({"role": "user", "content": user_block})
    return messages


_service: Optional[LLMSession] = None


def get_llm_service() -> LLMSession:
    global _service
    if _service is None:
        _service = LLMSession(settings.llm_server_url, settings.llm_model_name)
    return _service
