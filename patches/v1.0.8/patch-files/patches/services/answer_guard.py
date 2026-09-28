"""Streaming repetition guard.

Small local models loop. When the same passage is present twice in the retrieved
context — which happens because chunks overlap — the model happily restates it,
so an answer could show the same paragraph two or three times.

:class:`RepetitionGuard` sits in front of the token stream: it buffers until a
sentence (or paragraph) is complete, then emits it only if it is not a verbatim
or near-verbatim repeat of something already emitted. A very long run-on
sentence is flushed after ``hard_limit`` characters so nothing is ever held back
forever.

The comparison is ZWNJ/space/punctuation-insensitive, so «می‌شود» and «می شود»
count as the same text.
"""
from __future__ import annotations

import re
from typing import List, Optional, Set

from utils.persian import fold_joiners, tokenize

#: Sentence/paragraph boundaries; the separator is preserved in the output.
_BOUNDARY = re.compile(r"(?<=[.!?؟…])\s+|\n+")

#: Below this length a fragment is emitted as-is (it cannot be judged).
_MIN_JUDGEABLE = 24

#: Jaccard similarity above which two sentences count as the same.
_DEFAULT_SIMILARITY = 0.85


def _fold(text: str) -> str:
    """Comparison key: no ZWNJ/space/case/punctuation differences."""
    return fold_joiners(text).lower()


def _jaccard(left: Set[str], right: Set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


class RepetitionGuard:
    """Filter repeated sentences out of a streamed answer."""

    def __init__(
        self,
        similarity: float = _DEFAULT_SIMILARITY,
        min_judgeable: int = _MIN_JUDGEABLE,
        hard_limit: int = 800,
    ) -> None:
        self.similarity = similarity
        self.min_judgeable = min_judgeable
        self.hard_limit = hard_limit
        self._buffer = ""
        self._keys: List[str] = []
        self._token_sets: List[Set[str]] = []
        self.dropped = 0
        self.emitted_chars = 0

    # -- internals ----------------------------------------------------------
    def _accept(self, text: str) -> bool:
        """True when *text* is new (and therefore worth emitting)."""
        stripped = text.strip()
        if not stripped:
            return False
        key = _fold(stripped)
        if not key:
            return True
        if len(key) < self.min_judgeable:
            # Short fragment: only an exact repeat is dropped.
            if key in self._keys:
                self.dropped += 1
                return False
        else:
            tokens = set(tokenize(stripped))
            for previous_key, previous_tokens in zip(self._keys, self._token_sets):
                # A sentence fully contained in an earlier one is a repeat too.
                if key in previous_key or previous_key in key:
                    self.dropped += 1
                    return False
                if _jaccard(tokens, previous_tokens) >= self.similarity:
                    self.dropped += 1
                    return False
        self._keys.append(key)
        self._token_sets.append(set(tokenize(stripped)))
        self.emitted_chars += len(text)
        return True

    # -- public API ---------------------------------------------------------
    def push(self, token: str) -> str:
        """Feed a token; return the text that is safe to emit *now*."""
        self._buffer += token
        out: List[str] = []
        while True:
            match = _BOUNDARY.search(self._buffer)
            if match is None:
                break
            piece = self._buffer[: match.end()]
            self._buffer = self._buffer[match.end() :]
            if self._accept(piece):
                out.append(piece)
        if len(self._buffer) > self.hard_limit:
            piece, self._buffer = self._buffer, ""
            if self._accept(piece):
                out.append(piece)
        return "".join(out)

    def flush(self) -> str:
        """Return the trailing text at the end of the stream."""
        piece, self._buffer = self._buffer, ""
        return piece if self._accept(piece) else ""

    @property
    def pending(self) -> str:
        return self._buffer


def dedupe_sentences(text: str, seen: Optional[Set[str]] = None) -> str:
    """Drop sentences of *text* that repeat (optionally: already seen ones).

    Used when the retrieved chunks are pasted into the model prompt: the same
    sentence often arrives twice through overlapping chunks, and the model then
    repeats it in the answer.
    """
    seen = seen if seen is not None else set()
    kept: List[str] = []
    for piece in _BOUNDARY.split(text or ""):
        stripped = piece.strip()
        if not stripped:
            continue
        key = _fold(stripped)
        if not key:
            continue
        if len(key) >= _MIN_JUDGEABLE:
            if any(key in previous or previous in key for previous in seen):
                continue
            seen.add(key)
        kept.append(stripped)
    return " ".join(kept)
