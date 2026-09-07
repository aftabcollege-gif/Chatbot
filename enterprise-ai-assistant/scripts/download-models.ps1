# Downloads the exact offline runtime assets used by the Windows installer.
# This runs only during CI/build time. The installed application makes no network requests.
$ErrorActionPreference = "Stop"
# PS 5.1: the progress bar makes Invoke-WebRequest 10-50x slower for big files,
# and TLS 1.2 must be forced on some hosts.
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $PSScriptRoot

# When running on GitHub Actions, mirror any fatal error into the run's public
# Step Summary (the full logs require signing in, the summary page does not).
function Write-SummaryFailure($Stage, $ErrorRecord) {
    if (-not $env:GITHUB_STEP_SUMMARY) { return }
    $lines = @(
        "## download-models.ps1 failed at: $Stage",
        "",
        "``````text",
        $ErrorRecord.Exception.ToString(),
        "``````"
    )
    try { Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $lines -Encoding UTF8 } catch { }
}

function Download($url, $dest, $minBytes = 1) {
    if (Test-Path $dest) {
        if ((Get-Item $dest).Length -ge $minBytes) { Write-Host "exists: $dest"; return }
        Remove-Item $dest -Force
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Write-Host "downloading $url (attempt $attempt)"
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
            if ((Test-Path $dest) -and ((Get-Item $dest).Length -ge $minBytes)) { return }
            $got = 0; if (Test-Path $dest) { $got = (Get-Item $dest).Length }
            throw "incomplete download ($got bytes, expected >= $minBytes)"
        } catch {
            # 404/410 are permanent: retrying cannot help, so fail immediately
            # (lets DownloadFirst move on to the next candidate URL).
            $status = 0
            if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
                $status = [int]$_.Exception.Response.StatusCode
            }
            if ($status -eq 404 -or $status -eq 410) {
                throw "Failed to download $url : $($_.Exception.Message)"
            }
            if ($attempt -eq 3) { throw "Failed to download $url : $($_.Exception.Message)" }
            Start-Sleep -Seconds (5 * $attempt)
        }
    }
    throw "Downloaded file is empty: $dest"
}

# Try a list of mirror/candidate URLs and keep the first one that succeeds.
function DownloadFirst($urls, $dest, $minBytes = 1) {
    foreach ($url in $urls) {
        try {
            Download $url $dest $minBytes
            return
        } catch {
            Write-Warning "candidate unavailable, trying next: $url ($($_.Exception.Message))"
        }
    }
    throw "All candidate downloads failed for $dest"
}

try {
    Remove-Item "$Root\.models-download-ok" -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path "$Root\models\llm","$Root\models\embedding","$Root\models\reranker","$Root\llm","$Root\extensions" | Out-Null

    # CPU-only runtime so the standalone product works without CUDA/NVIDIA.
    # llama.cpp renamed their prebuilt CPU artifacts: older tags shipped
    # "llama-<tag>-bin-win-cpu-x64.zip" while newer tags (like b3800) ship
    # instruction-set variants instead (avx2 / avx / avx512 / noavx).
    # AVX2 covers virtually every x64 CPU since ~2013, so prefer it and fall
    # back to the other names for robustness.
    $llamaVer = "b3800"
    $llamaCandidates = @(
        "https://github.com/ggml-org/llama.cpp/releases/download/$llamaVer/llama-$llamaVer-bin-win-avx2-x64.zip",
        "https://github.com/ggml-org/llama.cpp/releases/download/$llamaVer/llama-$llamaVer-bin-win-cpu-x64.zip",
        "https://github.com/ggml-org/llama.cpp/releases/download/$llamaVer/llama-$llamaVer-bin-win-avx-x64.zip",
        "https://github.com/ggml-org/llama.cpp/releases/download/$llamaVer/llama-$llamaVer-bin-win-noavx-x64.zip"
    )
    DownloadFirst $llamaCandidates "$Root\llm\llama.zip" 5MB
    Expand-Archive "$Root\llm\llama.zip" -DestinationPath "$Root\llm" -Force
    $server = Get-ChildItem -Path "$Root\llm" -Recurse -Filter llama-server.exe | Select-Object -First 1
    if (-not $server) { throw "llama-server.exe not found after extracting llama.cpp" }
    Get-ChildItem -Path $server.DirectoryName -File | ForEach-Object { Copy-Item $_.FullName "$Root\llm\$($_.Name)" -Force }
    if (-not (Test-Path "$Root\llm\llama-server.exe")) { throw "llama-server.exe missing" }
    Remove-Item "$Root\llm\llama.zip" -Force -ErrorAction SilentlyContinue

    # Default lightweight LLM.
    Download "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf" "$Root\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf" 900MB
    if ($env:EAI_LARGE_MODEL -eq "1") {
        Download "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf" "$Root\models\llm\qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf" 3000MB
        Download "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf" "$Root\models\llm\qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf" 600MB
    }

    # Embedding and reranker.
    # NOTE: on the Xenova HF repos the fp32 "onnx/model.onnx" is only a tiny
    # external-data stub (~600 KB) whose real weights live in a separate
    # "model.onnx_data" file (~2.2 GB), so downloading model.onnx alone yields an
    # unusable model. The int8 exports (model_quantized.onnx / model_int8.onnx)
    # are self-contained single files, ~4x smaller and a better fit for a fully
    # offline CPU product. They are saved locally as model.onnx, which is the
    # filename the backend's ONNX runtime loader expects.
    DownloadFirst @(
        "https://huggingface.co/Xenova/bge-m3/resolve/main/onnx/model_quantized.onnx",
        "https://huggingface.co/Xenova/bge-m3/resolve/main/onnx/model_int8.onnx"
    ) "$Root\models\embedding\model.onnx" 400MB
    Download "https://huggingface.co/Xenova/bge-m3/resolve/main/tokenizer.json" "$Root\models\embedding\tokenizer.json" 1MB
    DownloadFirst @(
        "https://huggingface.co/Xenova/bge-reranker-large/resolve/main/onnx/model_quantized.onnx",
        "https://huggingface.co/Xenova/bge-reranker-large/resolve/main/onnx/model_int8.onnx"
    ) "$Root\models\reranker\model.onnx" 400MB
    Download "https://huggingface.co/Xenova/bge-reranker-large/resolve/main/tokenizer.json" "$Root\models\reranker\tokenizer.json" 1MB

    # sqlite-vec native extension.
    $vecVer = "v0.1.3"
    Download "https://github.com/asg017/sqlite-vec/releases/download/$vecVer/sqlite-vec-0.1.3-loadable-windows-x86_64.tar.gz" "$Root\extensions\vec.tar.gz" 50KB
    tar -xzf "$Root\extensions\vec.tar.gz" -C "$Root\extensions"
    if ($LASTEXITCODE -ne 0) { throw "tar failed to extract sqlite-vec (exit $LASTEXITCODE)" }
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
} catch {
    Write-SummaryFailure "download/verification" $_
    throw
}
