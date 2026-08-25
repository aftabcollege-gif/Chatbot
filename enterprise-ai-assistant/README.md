# دستیار هوشمند سازمانی (Enterprise AI Assistant)

A **100% offline**, on-premise enterprise chatbot / RAG assistant for Windows 10+.
Built with Tauri (desktop shell) + React/TypeScript (RTL Persian UI) + Python
FastAPI (backend) + SQLite with **sqlite-vec** (vector search) + **FTS5**
(full-text search) + llama.cpp / Qwen2.5 (local LLM) + ONNX BGE-M3 (embeddings).

```
desktop/   Tauri 2 shell — starts/stops backend + llama-server, system tray, splash
frontend/  React 18 + Vite + TS + Tailwind, dark/light, RTL فارسی
backend/   FastAPI: auth (Argon2+JWT), RBAC, documents, RAG, streaming SSE, admin
config/    default.yaml + system-prompt.txt
installer/ Inno Setup script producing setup.exe
scripts/   One-click Windows build + model/prerequisite downloaders
models/    Populated at build time (GGUF LLM, ONNX embedder/reranker)
```

## Quick start (development, any OS)

```bash
# Backend
cd backend
python3.11 -m venv ../.venv && source ../.venv/bin/activate
pip install -r requirements.txt
python main.py            # http://127.0.0.1:8741

# Frontend (separate terminal)
cd frontend
npm install
npm run dev               # http://127.0.0.1:5173  (proxies /api → 8741)
```

The first run shows a **setup wizard** (create admin + organization), then you
can log in, upload documents, and chat. Everything works with **zero model
downloads** in dev: a deterministic offline embedding and an extractive answerer
stand in for the real models; place the real GGUF/ONNX files in `models/` and
run `llama-server` to get full local-LLM quality.

## Production Windows build

Two desktop shells are provided — **both wrap the same backend + frontend**:

| Shell | Requirements | Installer | Binary size |
|-------|--------------|-----------|-------------|
| **Tauri 2** (preferred) | Rust + WebView2 | Inno Setup / NSIS | ~5 MB |
| **Electron** (fallback) | Node only (no Rust) | electron-builder NSIS | ~90 MB |

### Option A — Tauri (Inno Setup)

On a Windows machine with Python 3.11, Node 20+, Rust and Inno Setup 6:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\download-models.ps1
powershell -ExecutionPolicy Bypass -File scripts\download-prerequisites.ps1
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

### Option B — Electron + NSIS (no Rust needed)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\download-models.ps1
powershell -ExecutionPolicy Bypass -File scripts\build-electron.ps1
```

Both produce `dist/Enterprise-AI-Assistant-Setup.zip` (or `...-Electron.zip`)
containing `setup.exe`, `prerequisites/`, `README.txt` and `LICENSE.txt`.
Installing requires **no** Python, Node, Docker or internet on the target.

### Model selection

By default the lightweight **Qwen2.5-1.5B-Instruct (Q4_K_M, ~1 GB)** is bundled,
which runs well on 8 GB machines. To bundle the stronger 7B model (~5 GB, 16 GB
recommended), set `$env:EAI_LARGE_MODEL="1"` before running
`download-models.ps1`. The desktop shells auto-detect and prefer the strongest
model present.

## Security

- All services bind to `127.0.0.1` only; no ports exposed to the network.
- Argon2 password hashing, JWT (access + rotating refresh) sessions, RBAC.
- Object-level authorization on documents/knowledge; full audit log.
- No telemetry; no outbound calls.

See `README.txt` (Persian) for the end-user guide.
