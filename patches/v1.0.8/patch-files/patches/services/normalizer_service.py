"""Normalizer service — wraps Persian/multilingual text normalization."""
from __future__ import annotations

from utils.persian import detect_language, normalize_persian, normalize_light


def normalize_for_index(text: str) -> str:
    # For indexing (FTS / embeddings) we additionally drop ZWNJ so that words
    # written with or without it collapse to the same token. We keep ZWNJ in
    # the user-facing content column so Persian output displays correctly.
    return normalize_persian(text, remove_zwnj=True)


def normalize_for_display(text: str) -> str:
    return normalize_light(text)


def detect(text: str) -> str:
    return detect_language(text)
