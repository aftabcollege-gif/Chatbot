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

# High-frequency Persian function words that dilute BM25/FTS ranking.
# We deliberately keep interrogatives (چرا, چه, چگونه, کجا, کی, چطور, ...) and
# content words; only the most common grammatical words are stripped.
_PERSIAN_STOPWORDS = frozenset(
    """
    از به در با بر برای بی بدون را که و یا نه
    ها می ای
    این آن او ما شما وی هم نیز حتی همان همین هنوز
    آن‌ها آنها این‌ها اینها آنان ایشانشان
    است هست بود باشد شده شود کرد
    روی زیر بالا پشت جلو پیش
    با بر
    the a an of to in on at for and or but is are was were be been being
    """.split()
)


def remove_stopwords(tokens: List[str]) -> List[str]:
    return [t for t in tokens if t and t not in _PERSIAN_STOPWORDS]


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
