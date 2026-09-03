# Downloads the exact offline runtime assets used by the Windows installer.
# This runs only during CI/build time. The installed application makes no network requests.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Remove-Item "$Root\.models-download-ok" -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$Root\models\llm","$Root\models\embedding","$Root\models\reranker","$Root\llm","$Root\extensions" | Out-Null

function Download($url, $dest) {
    if (Test-Path $dest) {
        if ((Get-Item $dest).Length -gt 0) { Write-Host "exists: $dest"; return }
        Remove-Item $dest -Force
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Write-Host "downloading $url (attempt $attempt)"
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
            if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { return }
        } catch {
            if ($attempt -eq 3) { throw "Failed to download $url : $($_.Exception.Message)" }
            Start-Sleep -Seconds 5
        }
    }
    throw "Downloaded file is empty: $dest"
}

# CPU-only runtime so the standalone product works without CUDA/NVIDIA.
$llamaVer = "b3800"
Download "https://github.com/ggml-org/llama.cpp/releases/download/$llamaVer/llama-$llamaVer-bin-win-cpu-x64.zip" "$Root\llm\llama.zip"
Expand-Archive "$Root\llm\llama.zip" -DestinationPath "$Root\llm" -Force
$server = Get-ChildItem -Path "$Root\llm" -Recurse -Filter llama-server.exe | Select-Object -First 1
if (-not $server) { throw "llama-server.exe not found after extracting llama.cpp" }
Get-ChildItem -Path $server.DirectoryName -File | ForEach-Object { Copy-Item $_.FullName "$Root\llm\$($_.Name)" -Force }
if (-not (Test-Path "$Root\llm\llama-server.exe")) { throw "llama-server.exe missing" }
Remove-Item "$Root\llm\llama.zip" -Force -ErrorAction SilentlyContinue

# Default lightweight LLM.
Download "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf" "$Root\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf"
if ($env:EAI_LARGE_MODEL -eq "1") {
    Download "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf" "$Root\models\llm\qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"
    Download "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf" "$Root\models\llm\qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf"
}

# Embedding and reranker.
Download "https://huggingface.co/Xenova/bge-m3/resolve/main/onnx/model.onnx" "$Root\models\embedding\model.onnx"
Download "https://huggingface.co/Xenova/bge-m3/resolve/main/tokenizer.json" "$Root\models\embedding\tokenizer.json"
Download "https://huggingface.co/Xenova/bge-reranker-large/resolve/main/onnx/model.onnx" "$Root\models\reranker\model.onnx"
Download "https://huggingface.co/Xenova/bge-reranker-large/resolve/main/tokenizer.json" "$Root\models\reranker\tokenizer.json"

# sqlite-vec native extension.
$vecVer = "v0.1.3"
Download "https://github.com/asg017/sqlite-vec/releases/download/$vecVer/sqlite-vec-0.1.3-loadable-windows-x86_64.tar.gz" "$Root\extensions\vec.tar.gz"
tar -xzf "$Root\extensions\vec.tar.gz" -C "$Root\extensions"
$vecDll = Get-ChildItem -Path "$Root\extensions" -Recurse -Filter vec0.dll | Select-Object -First 1
if (-not $vecDll) { throw "vec0.dll not found" }
Copy-Item $vecDll.FullName "$Root\extensions\sqlite_vec.dll" -Force
Remove-Item "$Root\extensions\vec.tar.gz" -Force -ErrorAction SilentlyContinue

$required = @(
    "$Root\llm\llama-server.exe",
    "$Root\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf",
    "$Root\models\embedding\model.onnx",
    "$Root\models\embedding\tokenizer.json",
    "$Root\models\reranker\model.onnx",
    "$Root\models\reranker\tokenizer.json",
    "$Root\extensions\sqlite_vec.dll"
)
if ($env:EAI_LARGE_MODEL -eq "1") {
    $required += "$Root\models\llm\qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"
    $required += "$Root\models\llm\qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf"
}
foreach ($f in $required) {
    if (-not (Test-Path $f)) { throw "Missing required file: $f" }
    Write-Host "ok: $f ($([math]::Round((Get-Item $f).Length / 1MB, 1)) MB)"
}
Set-Content -Path "$Root\.models-download-ok" -Value (Get-Date -Format o)
Write-Host "Offline runtime assets ready." -ForegroundColor Green
