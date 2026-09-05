# Scale Benchmark Suite

Measures RAG ingestion throughput, DB size, retrieval latency and recall at
several corpus scales, using throwaway databases (isolated via `XDG_DATA_HOME`).

## Setup (one time)

```bash
python3 -m venv bench-venv
bench-venv/bin/pip install numpy pyyaml httpx sqlite-vec beautifulsoup4
```

## Run

```bash
cd enterprise-ai-assistant/backend
../../bench-venv/bin/python -m benchmarks.run_all --scales-files 200,2000,20000 --embed-workers 4
```

Options:

| Flag | Default | Meaning |
|---|---|---|
| `--scales-files` | `200,2000,20000` | document counts (one fresh DB per scale) |
| `--sentences` | `60` | sentences per synthetic doc (~6 chunks) |
| `--embed-workers` | `4` | multiprocess embedding workers for bulk load |
| `--skip-ingest` | off | skip the real-pipeline ingestion sample |
| `--out` | `benchmarks/results/<ts>` | results directory |

## Outputs

* `results/<ts>/results.json` — all raw numbers
* `results/<ts>/scale-<N>.json` — per-scale detail
* `results/<ts>/REPORT_FA.md` — Persian report with tables + 100k projection

## Notes

* Embedding backend here is `hash` (no ONNX model files), so ingest/embed
  numbers are a **lower bound** — real ONNX on CPU is slower per text.
* sqlite-vec `vec0` in this version is a brute-force scan (O(N) per query),
  which is exactly what the benchmark demonstrates at scale.
