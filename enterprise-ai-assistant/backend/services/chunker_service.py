"""Smart text chunking with heading/section awareness and token overlap."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, List, Optional

from core.config import settings
from utils.persian import approximate_tokens


@dataclass
class Chunk:
    content: str
    page_number: Optional[int] = None
    section: Optional[str] = None
    heading: Optional[str] = None
    chunk_index: int = 0
    token_count: int = 0


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$|^(\d+(?:\.\d+)*[\.\)]\s+.+)$", re.MULTILINE)


def _split_by_heading(text: str) -> List[Any]:
    parts: List[Any] = []
    last = 0
    current_heading: Optional[str] = None
    for m in _HEADING_RE.finditer(text):
        if m.start() > last:
            parts.append((current_heading, text[last : m.start()].strip()))
        current_heading = (m.group(2) or m.group(3) or "").strip()
        last = m.end()
    parts.append((current_heading, text[last:].strip()))
    return [(h, t) for h, t in parts if t]


def _split_into_windows(text: str, max_tokens: int, overlap: int) -> List[str]:
    words = text.split()
    if not words:
        return []
    if approximate_tokens(text) <= max_tokens:
        return [text.strip()]
    windows: List[str] = []
    # Approximate tokens ~ words for mixed fa/en; use word counts scaled.
    size = max(1, max_tokens)
    step = max(1, size - overlap)
    i = 0
    while i < len(words):
        window = words[i : i + size]
        windows.append(" ".join(window))
        i += step
    return windows


def chunk_text(
    text: str,
    max_tokens: Optional[int] = None,
    overlap: Optional[int] = None,
    page_number: Optional[int] = None,
    section: Optional[str] = None,
) -> List[Chunk]:
    max_tokens = max_tokens or settings.rag_chunk_size
    overlap = overlap if overlap is not None else settings.rag_chunk_overlap
    chunks: List[Chunk] = []
    idx = 0
    for heading, section_text in _split_by_heading(text):
        for window in _split_into_windows(section_text, max_tokens, overlap):
            chunks.append(
                Chunk(
                    content=window,
                    page_number=page_number,
                    section=section,
                    heading=heading,
                    chunk_index=idx,
                    token_count=approximate_tokens(window),
                )
            )
            idx += 1
    if not chunks and text.strip():
        chunks.append(
            Chunk(
                content=text.strip(),
                page_number=page_number,
                section=section,
                chunk_index=0,
                token_count=approximate_tokens(text),
            )
        )
    return chunks
