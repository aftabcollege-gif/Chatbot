"""Persian / multilingual text utilities (self-contained, no heavy NLP deps)."""
from __future__ import annotations

import re
import unicodedata
from typing import List

# Common Persian/Arabic character normalization map.
_PERSIAN_MAP = str.maketrans(
    {
        "\u064a": "\u06cc",  # ي -> ی
        "\u0649": "\u06cc",  # ى -> ی
        "\u0643": "\u06a9",  # ك -> ک
        "\u0643": "\u06a9",
        "\u0629": "\u0647",  # ة -> ه
        "\u0621": "",  # standalone hamza removal (optional)
        "\u0654": "",
        "\u0655": "",
        "\u0656": "",
        "\u0670": "",
        "\u200c": " ",  # ZWNJ -> space for FTS/token consistency
        "\u200f": "",
        "\u200e": "",
        "\xa0": " ",
    }
)

_DIACRITICS = re.compile(r"[\u064b-\u0652\u0670\u0640]")
_PUNCT = re.compile(r"[،٫«»\[\](){}<>\|!?,.;:؟*#@\n\r\t]+")
_MULTISPACE = re.compile(r"\s+")
_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def normalize_persian(text: str) -> str:
    """Normalize Persian text for indexing/searching."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.translate(_DIGIT_MAP)
    text = text.translate(_PERSIAN_MAP)
    text = _DIACRITICS.sub("", text)
    text = _MULTISPACE.sub(" ", text)
    return text.strip()


def normalize_light(text: str) -> str:
    """Lighter normalization for display-friendly comparisons."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.translate(_DIGIT_MAP)
    text = text.translate(_PERSIAN_MAP)
    return text.strip()


def tokenize(text: str) -> List[str]:
    text = normalize_persian(text).lower()
    text = _PUNCT.sub(" ", text)
    return [t for t in text.split() if t]


_PERSIAN_RANGE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\uFB8A-\uFCF2\uFE70-\uFEFC]")


def is_persian(text: str) -> bool:
    if not text:
        return False
    sample = text[:400]
    persian = len(_PERSIAN_RANGE.findall(sample))
    return persian > max(8, len(sample) * 0.2)


def detect_language(text: str) -> str:
    """Detect language with a cheap heuristic; falls back to langdetect."""
    if is_persian(text):
        return "fa"
    try:
        from langdetect import detect, DetectorFactory

        DetectorFactory.seed = 0
        return detect(text[:1000])
    except Exception:
        return "en"


def approximate_tokens(text: str) -> int:
    if not text:
        return 0
    return len(tokenize(text))


def truncate_words(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "…"


def fts5_or_query(text: str, limit: int = 1000) -> str:
    """Build a safe FTS5 MATCH expression from free text.

    Every token is wrapped as a quoted phrase so that characters with a
    special meaning in the FTS5 query language (``-``, ``*``, ``:``, ``(``,
    quotes, …) can never break the query or change its semantics — e.g. an
    unquoted ``GT-4821`` raises ``no such column: 4821``. Returns ``""``
    when the text yields no tokens (callers must skip the MATCH query then).
    """
    parts: List[str] = []
    for tok in tokenize(text):
        t = tok.replace('"', '""').strip()
        if t:
            parts.append(f'"{t}"')
    return " OR ".join(parts)[:limit]
