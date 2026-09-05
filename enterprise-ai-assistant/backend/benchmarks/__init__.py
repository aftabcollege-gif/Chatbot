"""Scale benchmark suite for the Enterprise AI Assistant RAG pipeline.

Measures, at several corpus scales (number of files / chunks):

* ingestion throughput  (bulk load + a real end-to-end sample via document_processor)
* on-disk database size
* retrieval latency     (FTS, vector, hybrid retrieve(), rerank) — mean / p50 / p95
* recall@k              (exact "needle" queries vs. paraphrased queries)

Everything runs against throwaway databases under a temp directory
(isolated via XDG_DATA_HOME), so production data is never touched.

Usage:
    cd enterprise-ai-assistant/backend
    ../../bench-venv/bin/python -m benchmarks.run_all --scales-files 200,2000,20000
"""
