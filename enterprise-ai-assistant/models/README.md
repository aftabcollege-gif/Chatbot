# Models directory

This folder is populated at **build time** by `scripts/download-models.ps1` (run
on a Windows build machine with internet access). The installer then bundles the
contents:

```
models/
├── llm/
│   └── qwen2.5-7b-instruct-q4_k_m.gguf   (~5 GB)
├── embedding/
│   ├── model.onnx                        (BGE-M3)
│   ├── tokenizer.json
│   └── config.json
├── reranker/
│   ├── model.onnx                        (bge-reranker-v2-m3)
│   └── tokenizer.json
└── ocr/                                  (optional Tesseract data)
    ├── tesseract.exe
    └── tessdata/fas.traineddata, eng.traineddata
```

The app is designed to **degrade gracefully** when these files are absent:

- If the ONNX embedding model is missing, a deterministic offline feature-hashing
  embedder is used (no download, fully private).
- If the reranker ONNX is missing, a BM25-lite lexical reranker is used.
- If `llama-server.exe` / the GGUF model is missing, answers are composed
  **extractive** directly from the retrieved chunks, with citations intact.

So the development/demo experience works without downloading any models, while
the production Windows build bundles the real models for full local LLM quality.
