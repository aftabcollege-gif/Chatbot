"""Normalizer service — wraps Persian/multilingual text normalization."""
from __future__ import annotations

from utils.persian import detect_language, normalize_persian, normalize_light


def normalize_for_index(text: str) -> str:
    return normalize_persian(text)


def normalize_for_display(text: str) -> str:
    return normalize_light(text)


def detect(text: str) -> str:
    return detect_language(text)
