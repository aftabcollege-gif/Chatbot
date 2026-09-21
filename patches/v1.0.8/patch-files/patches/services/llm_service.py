"""LLM service.

Talks to a locally running llama.cpp ``llama-server`` (OpenAI-compatible
``/v1/chat/completions``) when available. On startup the backend scans the
``models/llm/`` directory for any ``*.gguf`` file and auto-selects the
strongest model present, preferring larger parameter counts and instruct-
tuned variants. If the Electron launcher started llama-server with a
weaker model (e.g. the default 1.5B), this service kills it and re-spawns
llama-server with the best model it found. If no server is reachable at
all, it falls back to an extractive answerer so the chat still works 100%
offline with zero model downloads.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import AsyncIterator, Dict, List, Optional

import httpx

from core.config import settings
from utils.persian import (
    approximate_tokens,
    normalize_persian,
    remove_stopwords,
    tokenize,
)


# --------------------------------------------------------------------------- #
# Model auto-selection
# --------------------------------------------------------------------------- #

# Rank model filenames by quality so the biggest capable Instruct model wins.
# Order: larger param count > smaller; "instruct" > "chat" > base; Q4_K_M > Q4_K_S > Q3.
_PARAM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*b", re.IGNORECASE)
_QUALITY_RE = re.compile(r"(q[2-8]_k_[ms]|iq[2-4]_xs?|f16|q8_0)", re.IGNORECASE)
_QUANT_RANK = {
    "f16": 90, "q8_0": 85, "q6_k": 75, "q5_k_m": 70, "q5_k_s": 65,
    "q4_k_m": 60, "q4_k_s": 55, "q3_k_m": 45, "q3_k_s": 40,
    "iq4_xs": 50, "iq3_xs": 38, "iq2_xs": 30,
}


def _score_model(path: Path) -> tuple:
    """Return a tuple sortable descending: higher = better."""
    name = path.name.lower()
    m = _PARAM_RE.search(name)
    params = float(m.group(1)) if m else 0.0
    instruct = 3 if "instruct" in name else (2 if "chat" in name else 0)
    q = _QUALITY_RE.search(name)
    qrank = _QUANT_RANK.get(q.group(1).lower(), 50) if q else 50
    # Prefer single-file models over shards.
    single = 1 if ("-of-" not in name or "-00001-of-" in name) else 0
    # Prefer qwen2.5 family.
    family = 2 if "qwen2.5" in name else (1 if "qwen2" in name else 0)
    return (params, instruct, qrank, family, single, path.stat().st_size)


def _find_best_model() -> Optional[Path]:
    search_dirs = [settings.model_abspath("models/llm")]
    # Also look in %APPDATA%/EnterpriseAI/models/llm so users can drop new
    # models in without touching Program Files.
    appdata_models = settings.appdata / "models" / "llm"
    if appdata_models.exists():
        search_dirs.append(appdata_models)
    candidates: List[Path] = []
    for d in search_dirs:
        if not d.exists():
            continue
        for p in d.glob("*.gguf"):
            # Skip shard parts other than the first (llama-server loads
            # the rest automatically when pointed at -00001-of-...).
            if re.search(r"-0000[2-9]-of-", p.name):
                continue
            candidates.append(p)
    if not candidates:
        return None
    candidates.sort(key=_score_model, reverse=True)
    return candidates[0]


def _find_llama_server() -> Optional[Path]:
    candidates = [
        settings.root / "llm" / "llama-server.exe",
        settings.root / "llm" / "llama-server",
        settings.root / "bin" / "llama-server.exe",
        settings.root / "_internal" / "llm" / "llama-server.exe",
    ]
    for c in candidates:
        if c.exists():
            return c
    # PATH fallback (dev)
    for exe in ("llama-server.exe", "llama-server"):
        p = shutil_which(exe)
        if p:
            return Path(p)
    return None


def shutil_which(name: str) -> Optional[str]:
    # Lazy shutil.which import (kept out of top-level for frozen parity).
    import shutil
    return shutil.which(name)


def _recommended_ctx(model_path: Path) -> int:
    """Return a sensible ctx-size based on model size and total RAM."""
    m = _PARAM_RE.search(model_path.name)
    params = float(m.group(1)) if m else 1.5
    # For 7B on a 16GB box, 8192 ctx is comfortable. For 14B+, stick to 4096.
    if params >= 12:
        return 4096
    if params >= 6:
        return 8192
    return 4096


def _port_in_use(host: str, port: int) -> bool:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        try:
            s.connect((host, port))
            return True
        except OSError:
            return False


def _kill_existing_llama(port: int) -> None:
    """Best-effort: kill any llama-server process listening on the port so we
    can re-launch with the chosen model."""
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/IM", "llama-server.exe"],
                capture_output=True, timeout=5,
            )
        else:
            subprocess.run(
                ["pkill", "-f", "llama-server"], capture_output=True, timeout=5,
            )
    except Exception:
        pass


_model_proc: Optional[subprocess.Popen] = None


def ensure_llama_server() -> Optional[dict]:
    """Make sure llama-server is running with the best available model.

    Returns a dict {model_path, ctx_size} if successful, None otherwise.
    Safe to call repeatedly; only re-spawns when necessary.
    """
    global _model_proc
    exe = _find_llama_server()
    best = _find_best_model()
    if not exe or not best:
        return None

    host = settings.get("llm.server_host", "127.0.0.1")
    port = int(settings.get("llm.server_port", 8742))
    ctx = _recommended_ctx(best)
    threads = str(max(2, (os.cpu_count() or 4)))

    # Probe existing server to see which model it loaded.
    current_model: Optional[str] = None
    try:
        r = httpx.get(f"http://{host}:{port}/v1/models", timeout=2.0)
        if r.status_code == 200:
            data = r.json()
            models = data.get("data", [])
            if models:
                current_model = models[0].get("id")
    except Exception:
        pass

    # If already serving the right model (filename matches), leave it alone.
    if current_model and best.name.lower() in current_model.lower():
        return {"model_path": str(best), "ctx_size": ctx}

    # Otherwise (wrong model or not running), kill any existing and launch.
    _kill_existing_llama(port)
    import time as _t
    _t.sleep(1.0)
    try:
        _model_proc = subprocess.Popen(
            [
                str(exe),
                "--model", str(best),
                "--host", host,
                "--port", str(port),
                "--ctx-size", str(ctx),
                "--threads", threads,
                "--parallel", "2",
                "--flash-attn",
            ],
            cwd=str(exe.parent),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=(subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0),
        )
    except Exception as exc:
        print(f"[llm] failed to spawn llama-server: {exc}")
        return None

    # Wait until healthy (up to ~60s for a cold 7B load).
    for _ in range(120):
        _t.sleep(0.5)
        try:
            r = httpx.get(f"http://{host}:{port}/health", timeout=1.0)
            if r.status_code == 200:
                print(f"[llm] serving {best.name} ctx={ctx}")
                return {"model_path": str(best), "ctx_size": ctx}
        except Exception:
            continue
    print("[llm] llama-server did not become healthy")
    return None


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
        # First: make sure a llama-server with the best model is up.
        info = await asyncio.to_thread(ensure_llama_server)
        if info:
            # Pick a model name that matches what llama-server exposes.
            model_name = Path(info["model_path"]).stem
            self.model = model_name
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
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

_SENT_SPLIT = re.compile(r"(?<=[.!?؟。؟!])\s+|\n+")
_PERSIAN_SENT = re.compile(r"[.!?؟。]")


def _split_sentences(text: str) -> List[str]:
    text = re.sub(r"\s*\n\s*", " \n ", text)
    sents = [s.strip() for s in _SENT_SPLIT.split(text) if s and s.strip()]
    return sents


def _best_snippets(query_tokens: List[str], text: str, max_snippets: int = 2) -> List[tuple]:
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
        score = overlap / (len(qset) + len(stoks) - overlap + 1e-9)
        scored.append((score, sent.strip()))
    scored.sort(key=lambda x: x[0], reverse=True)
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

    per_source: List[tuple] = []
    for src in sources:
        snippets = _best_snippets(q_tokens, src.get("content", "") or "", max_snippets=2)
        if not snippets:
            continue
        total = sum(s[0] for s in snippets)
        per_source.append((total, snippets, src))
    per_source.sort(key=lambda x: x[0], reverse=True)

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
    """Build the LLM message list respecting the model's context budget."""
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
    instr_tokens = approximate_tokens(ctx_instruction)
    q_tokens = approximate_tokens(question)
    gen_reserve = settings.llm_max_tokens + 384
    # Detect actual ctx size from whatever llama-server ended up using.
    info = None
    try:
        info = ensure_llama_server()
    except Exception:
        info = None
    total_ctx = int(info["ctx_size"]) if info else int(settings.llm_context_size)

    available = total_ctx - system_tokens - instr_tokens - q_tokens - gen_reserve
    history_budget = int(available * 0.20)
    sources_budget = int(available * 0.80)
    if sources_budget < 400:
        sources_budget = 400
        history_budget = max(0, available - sources_budget)

    trimmed: List[Dict[str, str]] = []
    acc = 0
    for msg in reversed(history[-8:]):
        size = approximate_tokens(msg.get("content", "")) + 4
        if acc + size > history_budget:
            break
        trimmed.insert(0, msg)
        acc += size

    ctx_words = context.split()
    ctx_tok = approximate_tokens(context)
    if ctx_tok > sources_budget:
        keep = max(96, int(len(ctx_words) * (sources_budget / max(1, ctx_tok))))
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
