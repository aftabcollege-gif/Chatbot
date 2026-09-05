"""Latency + recall measurements against a loaded benchmark database.

Stages measured per query (milliseconds):
  * embed      — query embedding (hash backend here; ONNX would be slower)
  * fts        — BM25 full-text search over chunks_fts (top-20)
  * vec        — sqlite-vec KNN scan over chunks_vec (top-60)
  * retrieve   — full hybrid pipeline services.rag_service.retrieve()
  * rerank     — isolated lexical rerank over 20 candidates
  * assemble   — context assembly for the LLM prompt (constant w.r.t. scale)
"""
from __future__ import annotations

import statistics
import sys
import time
from pathlib import Path
from typing import Dict, List

BACKEND_DIR = str(Path(__file__).resolve().parent.parent)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from core.config import settings  # noqa: E402
from services import rag_service  # noqa: E402
from services.embedding_service import get_embedding_service  # noqa: E402
from services.reranker_service import get_reranker_service  # noqa: E402
from utils.persian import normalize_persian  # noqa: E402

TOP_K = 20
VEC_POOL = 60


def pct(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * (p / 100.0)
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return round(ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo), 2)


def summarize_ms(values: List[float]) -> Dict[str, float]:
    return {
        "mean": round(statistics.fmean(values), 2) if values else 0.0,
        "p50": pct(values, 50),
        "p95": pct(values, 95),
        "max": round(max(values), 2) if values else 0.0,
        "n": len(values),
    }


def measure_latency(queries: List[str], user: Dict) -> Dict:
    embedder = get_embedding_service()
    reranker = get_reranker_service()
    t_embed, t_fts, t_vec, t_retrieve, t_rerank, t_assemble = [], [], [], [], [], []

    for q in queries:
        # --- embed ---
        t0 = time.perf_counter()
        q_vec = embedder.embed_one(normalize_persian(q))
        t_embed.append((time.perf_counter() - t0) * 1000)

        # --- fts ---
        t0 = time.perf_counter()
        fts_rows = rag_service._fts_chunks(q, TOP_K, "", [])
        t_fts.append((time.perf_counter() - t0) * 1000)

        # --- vec ---
        t0 = time.perf_counter()
        vec_rows = rag_service._vec_search(q_vec, "chunks_vec", "chunk_id", VEC_POOL, "", [])
        t_vec.append((time.perf_counter() - t0) * 1000)

        # --- full hybrid retrieve ---
        t0 = time.perf_counter()
        chunks = rag_service.retrieve(q, user)
        t_retrieve.append((time.perf_counter() - t0) * 1000)

        # --- isolated rerank over up to 20 candidates ---
        docs = [f"{c.title}\n{c.content}" for c in chunks[:TOP_K]] or ["سند خالی"]
        while len(docs) < TOP_K:
            docs.append(docs[0])
        t0 = time.perf_counter()
        reranker.rerank(q, docs[:TOP_K], top_k=settings.reranker_top_k)
        t_rerank.append((time.perf_counter() - t0) * 1000)

        # --- context assembly ---
        t0 = time.perf_counter()
        rag_service.assemble_context(chunks)
        t_assemble.append((time.perf_counter() - t0) * 1000)

    return {
        "embed_ms": summarize_ms(t_embed),
        "fts_ms": summarize_ms(t_fts),
        "vec_ms": summarize_ms(t_vec),
        "retrieve_ms": summarize_ms(t_retrieve),
        "rerank20_ms": summarize_ms(t_rerank),
        "assemble_ms": summarize_ms(t_assemble),
    }


def measure_recall(exact_queries: List[str], para_queries: List[str],
                   gold: Dict[str, str], user: Dict) -> Dict:
    """Recall: is the gold needle doc inside hybrid top-5 / FTS top-20 / vec top-60?"""
    embedder = get_embedding_service()
    from core import database as db

    def hits(query: str, doc_id: str) -> Dict[str, bool]:
        chunks = rag_service.retrieve(query, user)
        hybrid_ids = [c.source_id for c in chunks[:5]]
        fts_rows = rag_service._fts_chunks(query, TOP_K, "", [])
        fts_ids = {r["document_id"] for r in fts_rows}
        q_vec = embedder.embed_one(normalize_persian(query))
        vec_rows = rag_service._vec_search(q_vec, "chunks_vec", "chunk_id", VEC_POOL, "", [])
        vec_doc_ids = set()
        if vec_rows:
            ids = [v["id"] for v in vec_rows]
            ph = ",".join("?" for _ in ids)
            for r in db.query_all(
                    f"SELECT document_id FROM document_chunks WHERE id IN ({ph})", ids):
                vec_doc_ids.add(r["document_id"])
        return {
            "hybrid_top5": doc_id in hybrid_ids,
            "fts_top20": doc_id in fts_ids,
            "vec_top60": doc_id in vec_doc_ids,
        }

    out: Dict[str, Dict[str, float]] = {}
    for name, qs, key in (("exact", exact_queries, lambda q: q),
                          ("paraphrase", para_queries, lambda q: "PARA:" + q)):
        agg = {"hybrid_top5": 0, "fts_top20": 0, "vec_top60": 0}
        for q in qs:
            r = hits(q, gold[key(q)])
            for k, v in r.items():
                agg[k] += int(v)
        n = max(1, len(qs))
        out[name] = {"n": len(qs), **{k: round(v / n, 3) for k, v in agg.items()}}
    return out
