# ============================================================
#  Enterprise AI Assistant — Electron + NSIS build
#  Requires: Python 3.11, Node 20+ (NO Rust required).
#  Produces dist-electron/EnterpriseAI-Setup-1.0.0.exe (NSIS).
# ============================================================
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "==> [1/6] Downloading models & native binaries..." -ForegroundColor Cyan
& "$PSScriptRoot\download-models.ps1"

Write-Host "==> [2/6] Building frontend..." -ForegroundColor Cyan
Push-Location frontend
npm install --no-audit --no-fund
npm run build
Pop-Location

Write-Host "==> [3/6] Building backend (PyInstaller)..." -ForegroundColor Cyan
Push-Location backend
python -m venv ..\.venv-build
..\.venv-build\Scripts\python.exe -m pip install --upgrade pip
..\.venv-build\Scripts\pip install -r requirements.txt pyinstaller
..\.venv-build\Scripts\pyinstaller --noconfirm backend-server.spec
Pop-Location

Write-Host "==> [4/6] Copying prerequisites into the Electron build resources..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path desktop-electron\build | Out-Null
if (Test-Path prerequisites\vc_redist.x64.exe) {
    Copy-Item prerequisites\vc_redist.x64.exe "$env:TEMP\vc_redist.x64.exe" -Force
}
if (Test-Path prerequisites\MicrosoftEdgeWebView2Setup.exe) {
    Copy-Item prerequisites\MicrosoftEdgeWebView2Setup.exe "$env:TEMP\MicrosoftEdgeWebView2Setup.exe" -Force
}

Write-Host "==> [5/6] Packaging Electron app (NSIS installer)..." -ForegroundColor Cyan
Push-Location desktop-electron
npm install
npm run dist
Pop-Location

Write-Host "==> [6/6] Packaging ZIP..." -ForegroundColor Cyan
$stage = "dist\Enterprise-AI-Assistant-Setup"
New-Item -ItemType Directory -Force -Path "$stage\prerequisites" | Out-Null
Copy-Item "dist-electron\EnterpriseAI-Setup-1.0.0.exe" "$stage\setup.exe" -Force
if (Test-Path prerequisites\vc_redist.x64.exe) {
    Copy-Item prerequisites\vc_redist.x64.exe "$stage\prerequisites\" -Force
}
Copy-Item README.txt, LICENSE.txt "$stage\" -Force
Compress-Archive -Path "$stage\*" -DestinationPath "dist\Enterprise-AI-Assistant-Setup-Electron.zip" -Force

Write-Host "Electron build complete: dist\Enterprise-AI-Assistant-Setup-Electron.zip" -ForegroundColor Green
