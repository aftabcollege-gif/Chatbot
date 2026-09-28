"""Pure scoring/selection helpers for retrieval (no DB, no settings, no I/O).

Kept in its own module so both the retriever (:mod:`services.rag_service`) and
the fallback reranker (:mod:`services.reranker_service`) share the same maths —
and so the rules that decide *which sources are shown* are unit-testable without
a database or an embedding model.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Protocol, Set


# Statistics of the last :func:`score_chunks` call (the candidate pool).  Kept
# module-level so the public function signature stays small; a single request
# scores one pool at a time.
_POOL: Dict[str, Any] = {}


class Scorable(Protocol):
    """What the scorer needs from a retrieved chunk."""

    source_id: str
    lexical_score: float
    vector_score: Optional[float]
    rerank_score: float
    score: float

    def body_text(self) -> str: ...

    def title_text(self) -> str: ...


def document_frequency(documents: List[Set[str]]) -> Dict[str, int]:
    """In how many of *documents* each term occurs."""
    df: Dict[str, int] = {}
    for tokens in documents:
        for token in tokens:
            df[token] = df.get(token, 0) + 1
    return df


def inverse_document_frequency(documents: List[Set[str]]) -> Dict[str, float]:
    """IDF of every term seen in *documents* (the candidate pool)."""
    total = max(1, len(documents))
    return {
        term: math.log(1 + (total - count + 0.5) / (count + 0.5))
        for term, count in document_frequency(documents).items()
    }


def lexical_coverage(
    terms: List[str], idf: Dict[str, float], title_tokens: Set[str], body_tokens: Set[str]
) -> float:
    """IDF-weighted share of the query terms present in the chunk (0..1).

    A term found in the title/heading counts extra, so «فرآیند PM» matches the
    document *about* PM rather than one that merely mentions the words.
    """
    unique = [t for t in dict.fromkeys(terms) if t]
    if not unique:
        return 0.0
    denominator = sum(idf.get(term, 1.0) for term in unique)
    if denominator <= 0:
        return 0.0
    covered = sum(
        idf.get(term, 1.0) for term in unique if term in body_tokens or term in title_tokens
    )
    in_title = sum(idf.get(term, 1.0) for term in unique if term in title_tokens)
    return max(0.0, min(1.0, covered / denominator + 0.4 * (in_title / denominator)))


def combine_evidence(lexical: float, vector: Optional[float], rerank: float) -> float:
    """Final relevance (0..1) from the signals that are available."""
    if vector is None:
        return max(0.0, min(1.0, 0.70 * lexical + 0.30 * rerank))
    return max(0.0, min(1.0, 0.50 * lexical + 0.30 * vector + 0.20 * rerank))


def jaccard(left: Set[str], right: Set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def score_chunks(chunks: List[Any], terms: List[str], tokenizer) -> Dict[str, float]:
    """Fill ``lexical_score``/``score`` of every chunk and return the IDF map."""
    body_tokens = [set(tokenizer(chunk.body_text())) for chunk in chunks]
    title_tokens = [set(tokenizer(chunk.title_text())) for chunk in chunks]
    _POOL["document_frequency"] = document_frequency(body_tokens)
    _POOL["total"] = max(1, len(chunks))
    idf = inverse_document_frequency(body_tokens)
    for index, chunk in enumerate(chunks):
        chunk.lexical_score = round(
            lexical_coverage(terms, idf, title_tokens[index], body_tokens[index]), 4
        )
        chunk.score = round(
            combine_evidence(chunk.lexical_score, chunk.vector_score, chunk.rerank_score), 4
        )
    return idf


def distinctive_terms(
    terms: List[str],
    idf: Dict[str, float],
    document_frequency_map: Optional[Dict[str, int]] = None,
    total: Optional[int] = None,
    max_share: float = 0.5,
    ratio: float = 0.5,
    limit: int = 3,
) -> List[str]:
    """The query terms that actually discriminate inside the candidate pool.

    A question such as «فرآیند pm را مختصر توضیح بده» reduces to the terms
    «فرآیند» (present in almost every procedure document) and «pm» (rare) — the
    rare one is what makes an answer relevant, so it becomes a *requirement*
    instead of yet another OR-ed word.  A term that occurs in most of the
    candidates cannot discriminate and is therefore not required.
    """
    present = [(term, idf[term]) for term in dict.fromkeys(terms) if term in idf]
    if not present:
        return []
    if document_frequency_map is not None and total:
        present = [
            (term, value)
            for term, value in present
            if document_frequency_map.get(term, total) <= max_share * total
        ]
        if not present:
            return []
    strongest = max(value for _term, value in present)
    if strongest <= 0:
        return []
    picked = [(term, value) for term, value in present if value >= ratio * strongest]
    picked.sort(key=lambda item: item[1], reverse=True)
    return [term for term, _value in picked[:limit]]


def _pick(
    chunks: List[Any],
    tokenizer,
    required: List[str],
    *,
    min_relevance: float,
    max_per_source: int,
    duplicate_similarity: float,
    limit: int,
    semantic_gate: float,
) -> List[Any]:
    """Filtering pass; ``required`` empty means "any lexical hit is enough"."""
    kept: List[Any] = []
    per_source: Dict[str, int] = {}
    kept_tokens: List[Set[str]] = []
    for chunk in sorted(chunks, key=lambda item: item.score, reverse=True):
        tokens = set(tokenizer(chunk.body_text()))
        covers_required = bool(required) and bool(tokens.intersection(required))
        lexical_ok = covers_required if required else chunk.lexical_score > 0
        semantic_ok = (chunk.vector_score or 0.0) >= semantic_gate
        if not (lexical_ok or semantic_ok):
            continue
        if chunk.score < min_relevance:
            continue
        if per_source.get(chunk.source_id, 0) >= max_per_source:
            continue
        if any(jaccard(tokens, other) >= duplicate_similarity for other in kept_tokens):
            continue
        per_source[chunk.source_id] = per_source.get(chunk.source_id, 0) + 1
        kept_tokens.append(tokens)
        kept.append(chunk)
        if len(kept) >= limit:
            break
    return kept


def select_sources(
    chunks: List[Any],
    terms: List[str],
    tokenizer,
    *,
    min_relevance: float,
    max_per_source: int,
    duplicate_similarity: float,
    limit: int,
    semantic_gate: float = 0.50,
) -> List[Any]:
    """Score, filter, deduplicate and rank the candidate chunks.

    A chunk becomes a source only when there is evidence for it:

    * it contains one of the query's *distinctive* terms — the rare words that
      make the question specific. This is what keeps «فرآیند pm» from citing
      every document that merely contains «فرآیند»;
    * or, when the wording does not appear literally, the vector search is
      confident about it (semantic match).

    If *no* chunk carries a distinctive term (synonym, abbreviation, or a typo
    in the question), the best lexical matches are used instead of answering
    "nothing found" — they still pass ``min_relevance``, so unrelated documents
    stay out. The same passage retrieved twice (overlapping chunks) is kept
    once, and one document contributes at most ``max_per_source`` chunks.
    """
    if not chunks:
        return []
    idf = score_chunks(chunks, terms, tokenizer)
    required = distinctive_terms(
        terms,
        idf,
        _POOL.get("document_frequency"),
        _POOL.get("total"),
    )
    options = dict(
        min_relevance=min_relevance,
        max_per_source=max_per_source,
        duplicate_similarity=duplicate_similarity,
        limit=limit,
        semantic_gate=semantic_gate,
    )
    kept = _pick(chunks, tokenizer, required, **options)
    if not kept and required:
        kept = _pick(chunks, tokenizer, [], **options)
    return kept
