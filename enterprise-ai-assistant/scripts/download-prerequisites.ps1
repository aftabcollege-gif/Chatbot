# Downloads the Windows prerequisites bundled into the installer's prerequisites/ folder.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
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
}

# Verify the models step actually succeeded. In the CI workflows this script
# runs last, so throwing here fails the step (otherwise a failed model
# download would be silently masked by this script's exit code).
if (-not (Test-Path "$Root\.models-download-ok")) {
    throw "Model download did not complete (missing .models-download-ok). Run scripts\download-models.ps1 and check its output."
}

Write-Host "Prerequisites ready." -ForegroundColor Green
