# Downloads the Windows prerequisites bundled into the installer's prerequisites/ folder.
$ErrorActionPreference = "Stop"
# PS 5.1: the progress bar makes Invoke-WebRequest dramatically slower.
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $PSScriptRoot

try {
    New-Item -ItemType Directory -Force -Path "$Root\prerequisites" | Out-Null

    $files = @{
      "vc_redist.x64.exe" = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
      "MicrosoftEdgeWebView2Setup.exe" = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
    }
    foreach ($k in $files.Keys) {
        $dest = Join-Path "$Root\prerequisites" $k
        if (Test-Path $dest) { Write-Host "exists: $k"; continue }
        Write-Host "downloading $k..."
        Invoke-WebRequest -Uri $files[$k] -OutFile $dest -UseBasicParsing
        if ((Get-Item $dest).Length -lt 1MB) { throw "$k download looks truncated" }
    }

    # Verify the models step actually succeeded. In the CI workflows this script
    # runs last, so throwing here fails the step (otherwise a failed model
    # download would be silently masked by this script's exit code).
    if (-not (Test-Path "$Root\.models-download-ok")) {
        throw "Model download did not complete (missing .models-download-ok). Run scripts\download-models.ps1 and check its output."
    }

    Write-Host "Prerequisites ready." -ForegroundColor Green
} catch {
    if ($env:GITHUB_STEP_SUMMARY) {
        $lines = @(
            "## download-prerequisites.ps1 failed",
            "",
            "``````text",
            $_.Exception.ToString(),
            "``````"
        )
        try { Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $lines -Encoding UTF8 } catch { }
    }
    throw
}
