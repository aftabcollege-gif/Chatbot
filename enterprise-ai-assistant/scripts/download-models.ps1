# Downloads the exact models and native binaries used by the offline installer.
# Run once on a connected Windows build machine. Everything is verified locally;
# at runtime the app makes zero network requests.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path "$Root\models\llm","$Root\models\embedding","$Root\models\reranker","$Root\llm","$Root\extensions" | Out-Null

function Download($url, $dest) {
    if (Test-Path $dest) { Write-Host "  exists: $dest"; return }
    Write-Host "  downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

# --- llama.cpp pre-built Windows binary (CPU, CUDA variant can be swapped in) ---
$llamaVer = "b3800"
Download "https://github.com/ggerganov/llama.cpp/releases/download/$llamaVer/llama-$llamaVer-bin-win-cuda-cu12.2-x64.zip" "$Root\llm\llama.zip"
if (-not (Test-Path "$Root\llm\llama-server.exe")) {
    Expand-Archive "$Root\llm\llama.zip" -DestinationPath "$Root\llm" -Force
}

# --- LLM models ---
# Default lightweight model for 8GB systems (Qwen2.5 1.5B Instruct, ~1GB).
Download "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf" `
    "$Root\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf"
# Optional stronger model for 16GB+ systems (~5GB). The app auto-selects the
# strongest model present (7B preferred when both are available).
if ($env:EAI_LARGE_MODEL -eq "1") {
    Download "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf" `
        "$Root\models\llm\qwen2.5-7b-instruct-q4_k_m.gguf"
}

# --- BGE-M3 embedding (ONNX) and reranker ---
Download "https://huggingface.co/Xenova/bge-m3/resolve/main/onnx/model.onnx" "$Root\models\embedding\model.onnx"
Download "https://huggingface.co/Xenova/bge-m3/resolve/main/tokenizer.json" "$Root\models\embedding\tokenizer.json"
Download "https://huggingface.co/Xenova/bge-reranker-v2-m3/resolve/main/onnx/model.onnx" "$Root\models\reranker\model.onnx"
Download "https://huggingface.co/Xenova/bge-reranker-v2-m3/resolve/main/tokenizer.json" "$Root\models\reranker\tokenizer.json"

# --- sqlite-vec extension for Windows ---
$vecVer = "v0.1.3"
Download "https://github.com/asg017/sqlite-vec/releases/download/$vecVer/sqlite-vec-0.1.3.tar.gz" "$Root\extensions\vec.tar.gz"
# The tarball contains vec0.dll under packages/...; extract and copy.
tar -xzf "$Root\extensions\vec.tar.gz" -C "$Root\extensions"
Get-ChildItem -Path "$Root\extensions" -Recurse -Filter vec0.dll | ForEach-Object {
    Copy-Item $_.FullName "$Root\extensions\sqlite_vec.dll" -Force
}

Write-Host "Models and binaries ready." -ForegroundColor Green
