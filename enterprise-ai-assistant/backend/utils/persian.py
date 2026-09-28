"""Persian / multilingual text utilities (self-contained, no heavy NLP deps)."""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable, List, Optional

# Common Persian/Arabic character normalization map.
_PERSIAN_MAP = str.maketrans(
    {
        "\u064a": "\u06cc",  # ي -> ی
        "\u0649": "\u06cc",  # ى -> ی
        "\u0643": "\u06a9",  # ك -> ک
        "\u0629": "\u0647",  # ة -> ه
        "\u0621": "",  # standalone hamza removal (optional)
        "\u0654": "",
        "\u0655": "",
        "\u0656": "",
        "\u0670": "",
        "\xa0": " ",  # NBSP -> space
        "\u200f": "",  # RLM
        "\u200e": "",  # LRM
    }
)

#: Invisible joiners/spaces.  ZWNJ (نیم‌فاصله, U+200C) is the important one:
#: SQLite's ``unicode61`` tokenizer treats it as a *word character*, so the index
#: keeps «می‌رود» as a single token while the same text typed with a plain space
#: arrives as two tokens («می» + «رود») — and the other way round.  Everything
#: here becomes a space, and :func:`fts_query` additionally emits the *joined*
#: spelling so both forms match each other regardless of which one the document
#: (or the user) used.
_INVISIBLE_RE = re.compile(r"[\u200b\u200c\u200d\u200e\u200f\ufeff\u2060]")

_DIACRITICS = re.compile(r"[\u064b-\u0652\u0670\u0640]")
_PUNCT = re.compile(r"[،٫«»\[\](){}<>\\|!?,.;:؟*#@\n\r\t]+")
_MULTISPACE = re.compile(r"\s+")
_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

#: Words that carry no topic information: function words, question words and the
#: verbs/phrases a question is wrapped in («... را توضیح بده»).  Matching the FTS
#: index on them matches almost every document — the main reason the assistant
#: used to cite irrelevant sources for a question such as
#: «فرآیند pm را مختصر توضیح بده».
_FA_STOPWORDS = {
    "و", "در", "به", "از", "که", "این", "آن", "را", "با", "برای", "بر", "تا", "هم",
    "یا", "اگر", "اما", "ولی", "چون", "زیرا", "پس", "نیز", "هر", "همه", "چه", "چی",
    "کدام", "چگونه", "چطور", "چرا", "کجا", "کی", "آیا", "هست", "است", "بود", "بوده",
    "باشد", "باشند", "شد", "شده", "شوند", "شود", "کرد", "کرده", "کند", "کنند",
    "می", "نمی", "تر", "ترین", "های", "ها", "هایی", "یک", "دو", "نه", "بله",
    "خب", "دیگر", "فقط", "لطفا", "لطفاً", "بده", "بدهید", "بگو", "بگویید", "بنویس",
    "توضیح", "شرح", "خلاصه", "مختصر", "کن", "کنید", "نمایید", "بفرمایید", "درباره",
    "مورد", "نسبت", "طبق", "جهت", "بابت", "خیلی", "بسیار", "حدود", "تقریبا", "تقریباً",
    "مانند", "مثل", "الان", "اکنون", "بعد", "قبل", "حال", "ضمن", "همان", "همین",
    "چنین", "چنان", "اینکه", "آنجا", "اینجا", "یعنی", "بیشتر", "کمتر",
}

_EN_STOPWORDS = {
    "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with", "is",
    "are", "was", "were", "be", "been", "do", "does", "did", "please", "explain",
    "briefly", "brief", "summary", "summarize", "what", "which", "how", "why",
    "when", "where", "who", "this", "that", "these", "those", "it", "its", "as",
    "at", "by", "from", "about", "into", "over", "under", "me", "my", "we", "our",
    "you", "your", "tell", "show", "give",
}

STOPWORDS = _FA_STOPWORDS | _EN_STOPWORDS


def normalize_persian(text: str) -> str:
    """Normalize Persian text for indexing/searching."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.translate(_DIGIT_MAP)
    text = text.translate(_PERSIAN_MAP)
    text = _INVISIBLE_RE.sub(" ", text)
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
    text = _INVISIBLE_RE.sub(" ", text)
    return text.strip()


def fold_joiners(text: str) -> str:
    """Drop every invisible joiner/space — used for ZWNJ-insensitive compare.

    ``fold_joiners("می‌شود") == fold_joiners("می شود") == "میشود"``
    """
    if not text:
        return ""
    return _INVISIBLE_RE.sub("", normalize_persian(text)).replace(" ", "")


def tokenize(text: str) -> List[str]:
    text = normalize_persian(text).lower()
    text = _PUNCT.sub(" ", text)
    return [t for t in text.split() if t]


def content_terms(text: str, limit: int = 24, min_length: int = 2) -> List[str]:
    """The *meaningful* words of a query/document (stop-words removed).

    These are the terms retrieval may match on: searching for «را»، «توضیح» or
    «مختصر» would otherwise return every procedure document in the corpus.
    """
    terms: List[str] = []
    seen = set()
    for token in tokenize(text):
        if len(token) < min_length:
            continue
        if token in STOPWORDS:
            continue
        if token in seen:
            continue
        seen.add(token)
        terms.append(token)
        if len(terms) >= limit:
            break
    return terms


def term_variants(text: str, limit: int = 24) -> List[str]:
    """Query terms plus their ZWNJ-joined spellings.

    The FTS ``content`` column keeps «می‌رود»/«میرود» as one token while the
    query is normalized to two («می» + «رود»); adding the joined form of every
    adjacent pair makes the two spellings find each other — in both directions,
    because the *split* terms are searched as well.
    """
    raw = tokenize(text)
    terms = content_terms(text, limit=limit) or raw[:limit]
    variants = list(terms)
    for left, right in zip(raw, raw[1:]):
        if len(left) >= 2 and len(right) >= 2:
            variants.append(left + right)
    for token in raw:
        if len(token) >= 3:
            variants.append(token)
    out: List[str] = []
    seen = set()
    for variant in variants:
        if variant and variant not in seen:
            seen.add(variant)
            out.append(variant)
    return out


def fts_query(text: str, limit: int = 24, max_chars: int = 900) -> str:
    """Build a safe FTS5 ``MATCH`` expression for *text*.

    Every term is quoted (so punctuation can never break the query) and joined
    with ``OR`` for recall; precision comes from the coverage-based ranking in
    :mod:`services.rag_service`, not from the FTS operator.
    """
    variants = term_variants(text, limit=limit)
    if not variants:
        cleaned = normalize_persian(text).replace('"', " ").strip()
        return cleaned[:max_chars]
    quoted = [f'"{v.replace(chr(34), "")}"' for v in variants if v]
    return " OR ".join(quoted)[:max_chars]


def joined_forms(tokens: Iterable[str]) -> List[str]:
    """Helper for tests/tools: the joined spelling of adjacent token pairs."""
    items = list(tokens)
    return [a + b for a, b in zip(items, items[1:]) if len(a) >= 2 and len(b) >= 2]


def same_word(left: str, right: str) -> bool:
    """True when two spellings differ only by ZWNJ/space placement."""
    return bool(left) and fold_joiners(left) == fold_joiners(right)


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
