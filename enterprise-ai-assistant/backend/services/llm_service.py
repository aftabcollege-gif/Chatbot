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
from utils.persian import normalize_persian, tokenize, truncate_words


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
# Offline extractive fallback - IMPROVED MULTI-SOURCE SYNTHESIS
# --------------------------------------------------------------------------- #
def _split_sentences(text: str) -> List[str]:
    raw = re.split(r"(?<=[.!?؟。])\s+|\n+", text)
    out = []
    for s in raw:
        s = s.strip()
        if len(s) < 10:
            continue
        if len(s) > 300:
            parts = re.split(r"[؛;،,]\s+", s)
            for p in parts:
                p = p.strip()
                if len(p) >= 15:
                    out.append(p)
        else:
            out.append(s)
    return out


def _score_sentence(query_tokens: List[str], sentence: str) -> float:
    stoks = tokenize(sentence)
    if not stoks:
        return 0.0
    qset = set(query_tokens)
    sset = set(stoks)
    if not qset:
        return 0.0
    overlap = len(qset & sset)
    jaccard = overlap / len(qset | sset) if (qset | sset) else 0.0
    overlap_ratio = overlap / len(qset)
    length_factor = 1.0
    if len(stoks) < 5:
        length_factor = 0.5
    elif len(stoks) > 60:
        length_factor = 0.8
    return (overlap_ratio * 0.6 + jaccard * 0.4) * length_factor


def _best_snippet(query_tokens: List[str], text: str) -> tuple[str, float]:
    sentences = _split_sentences(text)
    best, best_score = "", 0.0
    for sent in sentences:
        score = _score_sentence(query_tokens, sent)
        if score > best_score:
            best, best_score = sent.strip(), score
    if not best and text:
        best = truncate_words(text.strip(), 40)
        best_score = 0.1
    return best, best_score


async def extractive_stream(
    question: str,
    sources: List[Dict],
    history: List[Dict[str, str]],
    language: str = "fa",
) -> AsyncIterator[str]:
    """Yield an answer composed from retrieved sources, word-by-word.
    
    Improved multi-source synthesis:
    - Scores all sentences across all sources
    - Picks diverse sentences from different sources
    - Combines them into a coherent answer with proper citations
    """
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

    all_scored: List[tuple[float, str, int, Dict]] = []
    for src_idx, src in enumerate(sources):
        content = src.get("content", "")
        sentences = _split_sentences(content)
        for sent in sentences:
            score = _score_sentence(q_tokens, sent)
            if score > 0.01:
                all_scored.append((score, sent, src_idx, src))

    all_scored.sort(key=lambda x: x[0], reverse=True)

    if not all_scored:
        ranked = []
        for src_idx, src in enumerate(sources):
            snippet, score = _best_snippet(q_tokens, src.get("content", ""))
            if snippet:
                ranked.append((score, snippet, src_idx, src))
        ranked.sort(key=lambda x: x[0], reverse=True)
        all_scored = ranked[:5]
        if not all_scored:
            noinfo = (
                "بر اساس منابع موجود، اطلاعات مرتبط یافت شد اما تطابق دقیق با پرسش کم است. "
                "لطفاً پرسش را دقیق‌تر مطرح کنید."
                if fa
                else "Relevant sources were found but with low exact match. Please refine your question."
            )
            for word in noinfo.split():
                yield word + " "
            return

    selected: List[tuple[float, str, int, Dict]] = []
    used_source_indices = set()
    for item in all_scored:
        _, _, src_idx, _ = item
        if src_idx not in used_source_indices:
            selected.append(item)
            used_source_indices.add(src_idx)
        if len(selected) >= 5:
            break
    if len(selected) < 7:
        for item in all_scored:
            if item not in selected:
                selected.append(item)
            if len(selected) >= 7:
                break

    selected.sort(key=lambda x: (x[2], -x[0]))

    if fa:
        if len(used_source_indices) > 1:
            intro = f"بر اساس {len(used_source_indices)} منبع مرتبط:\n\n"
        else:
            intro = "بر اساس منابع بازیابی‌شده:\n\n"
    else:
        if len(used_source_indices) > 1:
            intro = f"Based on {len(used_source_indices)} relevant sources:\n\n"
        else:
            intro = "Based on retrieved sources:\n\n"

    for word in intro.split():
        yield word + " "
    if "\n\n" in intro:
        yield "\n\n"

    from collections import defaultdict
    by_source: Dict[int, List[tuple[float, str, Dict]]] = defaultdict(list)
    for score, sent, src_idx, src in selected:
        by_source[src_idx].append((score, sent, src))

    for src_idx in sorted(by_source.keys()):
        sentences_in_source = by_source[src_idx]
        citation_num = src_idx + 1
        for score, sent, src in sentences_in_source:
            clean_sent = sent.strip()
            if not clean_sent.endswith((".", "!", "?", "؟", "。")):
                clean_sent += "."
            text_with_cite = f"{clean_sent} [{citation_num}] "
            for word in text_with_cite.split():
                yield word + " "
        if len(by_source) > 1:
            yield "\n\n"

    if fa and len(used_source_indices) > 1:
        outro = f"\n\n(این پاسخ از ترکیب اطلاعات {len(used_source_indices)} منبع استخراج شده است.)"
        for word in outro.split():
            yield word + " "
    elif not fa and len(used_source_indices) > 1:
        outro = f"\n\n(This answer synthesizes information from {len(used_source_indices)} sources.)"
        for word in outro.split():
            yield word + " "


def build_messages(
    system_prompt: str,
    history: List[Dict[str, str]],
    question: str,
    context: str,
    language: str = "fa",
) -> List[Dict[str, str]]:
    # Strong, explicit instruction for multi-source synthesis and grounding
    if language.startswith("fa"):
        ctx_instruction = (
            "دستورالعمل حیاتی - باید دقیقاً رعایت شود:\n"
            "۱. تو فقط بر اساس منابع زیر پاسخ می‌دهی. هیچ اطلاعات خارج از منابع را اضافه نکن.\n"
            "۲. اگر پاسخ در چند منبع پخش شده، اطلاعات آن‌ها را ترکیب کن. مثال: اگر منبع [۱] بخشی و منبع [۲] بخش دیگر را دارد، هر دو را بیاور.\n"
            "۳. هر جمله مهم باید استناد داشته باشد: [۱] یا [۱، ۲] یا [۲، ۳]\n"
            "۴. شماره منبع را دقیقاً همان‌طور که در برچسب منبع آمده استفاده کن.\n"
            "۵. اعداد، تاریخ‌ها، اسامی را دقیقاً از منبع کپی کن - تحریف نکن.\n"
            "۶. اگر منابع تناقض دارند، تناقض را بگو.\n"
            "۷. اگر اطلاعات کافی نیست، صریحاً بگو «اطلاعات کافی در منابع موجود نیست».\n"
            "۸. پاسخ را به صورت ساختاریافته، دقیق و کوتاه بنویس.\n"
            "\n"
            "فرمت منابع: هر منبع با برچسب --- منبع [شماره]: عنوان --- شروع می‌شود و با --- پایان منبع [شماره] --- تمام می‌شود.\n"
            "تو باید از محتوای داخل این برچسب‌ها استفاده کنی و با همان شماره استناد کنی."
        )
    else:
        ctx_instruction = (
            "CRITICAL INSTRUCTIONS - MUST FOLLOW:\n"
            "1. Answer ONLY based on the sources below. Do not add external knowledge.\n"
            "2. If the answer is spread across multiple sources, SYNTHESIZE them. Example: if source [1] has part A and source [2] has part B, combine both.\n"
            "3. Every important sentence MUST have a citation: [1] or [1, 2] or [2, 3]\n"
            "4. Use the exact source numbers as labeled.\n"
            "5. Copy numbers, dates, names exactly as in sources - do not distort.\n"
            "6. If sources contradict, mention the contradiction.\n"
            "7. If insufficient info, explicitly say 'Insufficient information in available sources'.\n"
            "8. Be structured, accurate and concise.\n"
            "\n"
            "Source format: Each source starts with --- Source [number]: title --- and ends with --- End Source [number] ---.\n"
            "You must use content inside these tags and cite with the same number."
        )

    user_block = f"{ctx_instruction}\n\n{context}\n\n{'پرسش' if language.startswith('fa') else 'Question'}: {question}\n\n{'پاسخ (با استناد دقیق به منابع):' if language.startswith('fa') else 'Answer (with precise citations):'}"

    messages = [{"role": "system", "content": system_prompt}]
    budget = settings.rag_history_max_tokens
    acc = 0
    trimmed: List[Dict[str, str]] = []
    for msg in reversed(history[-6:]):
        size = len(msg.get("content", "").split())
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
