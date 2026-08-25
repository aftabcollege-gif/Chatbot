"""Embedding service with two backends:

* ``onnx``   — BGE-M3 / MiniLM exported to ONNX (used on the Windows build).
* ``hash``   — deterministic offline feature-hashing embedding (default when no
  model is bundled). It needs zero downloads, is fully offline, and produces
  vectors where lexical overlap correlates with cosine similarity — good enough
  for hybrid retrieval and completely private.

The backend is auto-selected based on the presence of the model directory.
"""
from __future__ import annotations

import json
import math
import os
import struct
from pathlib import Path
from typing import List, Optional

import numpy as np

from core.config import settings
from utils.persian import normalize_persian, tokenize


class _HashEmbedder:
    """Deterministic signed feature-hashing embedder (no model required)."""

    def __init__(self, dim: int, ngrams: int = 2) -> None:
        self.dim = dim
        self.ngrams = ngrams

    def _features(self, text: str) -> List[str]:
        tokens = tokenize(normalize_persian(text))
        feats = list(tokens)
        for n in range(2, self.ngrams + 1):
            for i in range(len(tokens) - n + 1):
                feats.append("\x00".join(tokens[i : i + n]))
        return feats or [text.strip() or "empty"]

    def _hash(self, feature: str) -> tuple[int, int]:
        # 64-bit split into index + sign using two different seeds.
        h1 = struct.unpack("<q", __import__("hashlib").blake2b(
            feature.encode("utf-8"), digest_size=8, key=b"idx").digest())[0]
        h2 = struct.unpack("<q", __import__("hashlib").blake2b(
            feature.encode("utf-8"), digest_size=8, key=b"sgn").digest())[0]
        return h1 % self.dim, 1 if (h2 & 1) == 0 else -1

    def embed(self, texts: List[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            for feat in self._features(text):
                idx, sign = self._hash(feat)
                out[row, idx] += sign
            norm = float(np.linalg.norm(out[row]))
            if norm > 0:
                out[row] /= norm
        return out


class _OnnxEmbedder:
    """ONNX Runtime embedder (BGE-M3 / MiniLM style: input_ids + attention_mask)."""

    def __init__(self, model_dir: Path, dim: int) -> None:
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self.dim = dim
        self.session = ort.InferenceSession(
            str(model_dir / "model.onnx"),
            providers=["CPUExecutionProvider"],
        )
        self.tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        cfg = {}
        cfg_path = model_dir / "config.json"
        if cfg_path.exists():
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        self.max_length = int(cfg.get("max_position_embeddings", 512))
        self.input_name = self.session.get_inputs()[0].name

    def embed(self, texts: List[str]) -> np.ndarray:
        enc = self.tokenizer.encode_batch(
            [normalize_persian(t) for t in texts]
        )
        input_ids = np.array(
            [e.ids[: self.max_length] for e in enc], dtype=np.int64
        )
        attention_mask = np.array(
            [e.attention_mask[: self.max_length] for e in enc], dtype=np.int64
        )
        # Pad to common length.
        max_len = max(len(r) for r in input_ids)
        ids = np.zeros((len(texts), max_len), dtype=np.int64)
        mask = np.zeros((len(texts), max_len), dtype=np.int64)
        for i, row in enumerate(input_ids):
            ids[i, : len(row)] = row
            mask[i, : len(row)] = attention_mask[i]
        outputs = self.session.run(
            None, {self.input_name: ids, "attention_mask": mask}
        )
        # Mean pooling over token dimension.
        hidden = outputs[0]  # (batch, seq, dim) or (batch, dim)
        if hidden.ndim == 3:
            mask_exp = mask[:, :, None].astype(np.float32)
            summed = (hidden * mask_exp).sum(axis=1)
            counts = mask_exp.sum(axis=1).clip(min=1e-9)
            emb = summed / counts
        else:
            emb = hidden
        emb = emb.astype(np.float32)
        norms = np.linalg.norm(emb, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return emb / norms


class EmbeddingService:
    def __init__(self) -> None:
        self.backend = "hash"
        self.dim = settings.embedding_dim
        self._impl = _HashEmbedder(self.dim)
        model_dir = settings.embedding_path
        if (model_dir / "model.onnx").exists() and (model_dir / "tokenizer.json").exists():
            try:
                self._impl = _OnnxEmbedder(model_dir, self.dim)
                self.backend = "onnx"
            except Exception as exc:  # pragma: no cover - depends on model files
                print(f"[embedding] ONNX backend unavailable, using hash: {exc}")
                self.backend = "hash"

    def embed(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        arr = self._impl.embed(list(texts))
        return arr.astype(np.float32).tolist()

    def embed_one(self, text: str) -> List[float]:
        return self.embed([text])[0]

    def to_blob(self, vector: List[float]) -> bytes:
        return struct.pack(f"{len(vector)}f", *vector)


_service: Optional[EmbeddingService] = None


def get_embedding_service() -> EmbeddingService:
    global _service
    if _service is None:
        _service = EmbeddingService()
    return _service
