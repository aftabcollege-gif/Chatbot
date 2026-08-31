# Downloads the exact models and native binaries used by the offline installer.
# Run once on a connected Windows build machine. Everything is verified locally;
# at runtime the app makes zero network requests.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path "$Root\models\llm","$Root\models\embedding","$Root\models\reranker","$Root\llm","$Root\extensions" | Out-Null

function Download($url, $dest) {
    if (Test-Path $dest) {
        if ((Get-Item $dest).Length -gt 0) { Write-Host "  exists: $dest"; return }
        Remove-Item $dest -Force
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        Write-Host "  downloading $url (attempt $attempt)"
        try {
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        } catch {
            Write-Host "  attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt 3) { Start-Sleep -Seconds 5; continue }
            throw "Failed to download $url : $($_.Exception.Message)"
        }
        if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { return }
        Start-Sleep -Seconds 5
    }
    throw "Downloaded file is empty: $dest"
}

# --- llama.cpp pre-built Windows binary (CUDA 12.2) ---
# Note: asset name is *cu12.2.0* (with trailing .0) in llama.cpp release b3800.
$llamaVer = "b3800"
Download "https://github.com/ggml-org/llama.cpp/releases/download/$llamaVer/llama-$llamaVer-bin-win-cuda-cu12.2.0-x64.zip" "$Root\llm\llama.zip"
if (-not (Test-Path "$Root\llm\llama-server.exe")) {
    Expand-Archive "$Root\llm\llama.zip" -DestinationPath "$Root\llm" -Force
}
if (-not (Test-Path "$Root\llm\llama-server.exe")) {
    # Some builds nest the binaries in a subfolder - hoist them to $Root\llm.
    $server = Get-ChildItem -Path "$Root\llm" -Recurse -Filter llama-server.exe | Select-Object -First 1
    if (-not $server) { throw "llama-server.exe not found after extracting llama.zip" }
    Get-ChildItem -Path $server.DirectoryName -File | ForEach-Object {
        if (-not (Test-Path "$Root\llm\$($_.Name)")) { Copy-Item $_.FullName "$Root\llm\" -Force }
    }
}
if (-not (Test-Path "$Root\llm\llama-server.exe")) {
    throw "llama-server.exe not found after extracting llama.zip"
}
# Don't ship the downloaded archive in the installer.
Remove-Item "$Root\llm\llama.zip" -Force -ErrorAction SilentlyContinue

# --- LLM models ---
# Default lightweight model for 8GB systems (Qwen2.5 1.5B Instruct, ~1.1GB).
Download "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf" `
    "$Root\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf"
# Optional stronger model for 16GB+ systems (~4.7GB, split into two shards).
# The app auto-selects the strongest model present (7B preferred when both are available).
if ($env:EAI_LARGE_MODEL -eq "1") {
    Download "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf" `
        "$Root\models\llm\qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"
    Download "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf" `
        "$Root\models\llm\qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf"
}

# --- BGE-M3 embedding (ONNX graph + tokenizer) ---
# The backend falls back to hash embeddings if these cannot be loaded at runtime.
Download "https://huggingface.co/Xenova/bge-m3/resolve/main/onnx/model.onnx" "$Root\models\embedding\model.onnx"
Download "https://huggingface.co/Xenova/bge-m3/resolve/main/tokenizer.json" "$Root\models\embedding\tokenizer.json"

# --- Reranker (ONNX graph + tokenizer) ---
# Xenova/bge-reranker-v2-m3 does not exist; use Xenova/bge-reranker-large.
# The backend falls back to lexical reranking if the ONNX model cannot be loaded.
Download "https://huggingface.co/Xenova/bge-reranker-large/resolve/main/onnx/model.onnx" "$Root\models\reranker\model.onnx"
Download "https://huggingface.co/Xenova/bge-reranker-large/resolve/main/tokenizer.json" "$Root\models\reranker\tokenizer.json"

# --- sqlite-vec extension for Windows ---
# Windows loadable DLLs are shipped in the loadable-windows tarball (contains vec0.dll).
$vecVer = "v0.1.3"
Download "https://github.com/asg017/sqlite-vec/releases/download/$vecVer/sqlite-vec-0.1.3-loadable-windows-x86_64.tar.gz" "$Root\extensions\vec.tar.gz"
tar -xzf "$Root\extensions\vec.tar.gz" -C "$Root\extensions"
$vecDll = Get-ChildItem -Path "$Root\extensions" -Recurse -Filter vec0.dll | Select-Object -First 1
if (-not $vecDll) { throw "vec0.dll not found in sqlite-vec package" }
if ($vecDll.FullName -ne "$Root\extensions\sqlite_vec.dll") {
    Copy-Item $vecDll.FullName "$Root\extensions\sqlite_vec.dll" -Force
}
# Don't ship the downloaded archive in the installer.
Remove-Item "$Root\extensions\vec.tar.gz" -Force -ErrorAction SilentlyContinue

# --- Verify the critical files are present before packaging ---
$required = @(
    "$Root\llm\llama-server.exe",
    "$Root\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf"
)
if ($env:EAI_LARGE_MODEL -eq "1") {
    $required += @(
        "$Root\models\llm\qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
        "$Root\models\llm\qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf"
    )
}
foreach ($f in $required) {
    if (-not (Test-Path $f)) { throw "Missing required file after download: $f" }
    $size = [math]::Round((Get-Item $f).Length / 1MB, 1)
    Write-Host "  ok: $f ($size MB)"
}

Write-Host "Models and binaries ready." -ForegroundColor Green
