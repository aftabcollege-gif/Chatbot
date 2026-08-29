"""Reranker service (ONNX cross-encoder) with a lexical fallback.

When no ONNX reranker model is bundled (the offline demo / environments without
the model), a BM25-lite scorer is used so the pipeline still functions and ranks
results meaningfully. On the Windows build with ``bge-reranker-v2-m3`` exported
to ONNX, the real model is loaded automatically.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from core.config import settings
from utils.persian import tokenize


class _LexicalReranker:
    def rerank(
        self, query: str, documents: List[str], top_k: int
    ) -> List[Tuple[int, float]]:
        q_tokens = tokenize(query)
        if not q_tokens:
            return [(i, 0.0) for i in range(len(documents))][:top_k]
        scores: List[float] = []
        # IDF over the provided candidate set.
        df: dict[str, int] = {}
        tokenized = [tokenize(d) for d in documents]
        for toks in tokenized:
            for term in set(toks):
                df[term] = df.get(term, 0) + 1
        N = max(1, len(documents))
        for toks in tokenized:
            if not toks:
                scores.append(0.0)
                continue
            tf: dict[str, int] = {}
            for t in toks:
                tf[t] = tf.get(t, 0) + 1
            score = 0.0
            for qt in q_tokens:
                if qt in tf:
                    idf = math.log(1 + N / (df.get(qt, 0) + 1))
                    score += (1 + math.log(tf[qt])) * idf
            # Normalize by document length to avoid bias toward long chunks.
            scores.append(score / math.sqrt(len(toks)))
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        if not ranked:
            return ranked
        max_score = ranked[0][1] or 1.0
        return [(idx, round(score / max_score, 4)) for idx, score in ranked[:top_k]]


class _OnnxReranker:
    def __init__(self, model_dir: Path) -> None:
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self.session = ort.InferenceSession(
            str(model_dir / "model.onnx"), providers=["CPUExecutionProvider"]
        )
        self.tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self.input_name = self.session.get_inputs()[0].name

    def rerank(
        self, query: str, documents: List[str], top_k: int
    ) -> List[Tuple[int, float]]:
        if not documents:
            return []
        scores: List[float] = []
        for doc in documents:
            enc = self.tokenizer.encode(query, doc)
            ids = np.array([enc.ids[:512]], dtype=np.int64)
            mask = np.array([enc.attention_mask[:512]], dtype=np.int64)
            out = self.session.run(None, {self.input_name: ids, "attention_mask": mask})[0]
            # Cross-encoders typically output a single logit or 2-class probs.
            arr = np.asarray(out).reshape(-1)
            if arr.shape[0] == 1:
                score = float(1 / (1 + math.exp(-float(arr[0]))))
            else:
                score = float(arr[1]) if arr.shape[0] > 1 else float(arr[0])
            scores.append(score)
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        return ranked[:top_k]


class RerankerService:
    def __init__(self) -> None:
        self.backend = "lexical"
        self._impl = _LexicalReranker()
        model_dir = settings.reranker_path
        if (model_dir / "model.onnx").exists() and (model_dir / "tokenizer.json").exists():
            try:
                self._impl = _OnnxReranker(model_dir)
                self.backend = "onnx"
            except Exception as exc:  # pragma: no cover
                print(f"[reranker] ONNX unavailable, using lexical: {exc}")

    def rerank(
        self, query: str, documents: List[str], top_k: Optional[int] = None
    ) -> List[Tuple[int, float]]:
        return self._impl.rerank(
            query, documents, top_k or settings.reranker_top_k
        )


_service: Optional[RerankerService] = None


def get_reranker_service() -> RerankerService:
    global _service
    if _service is None:
        _service = RerankerService()
    return _service
