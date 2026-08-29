# ============================================================
#  Enterprise AI Assistant — One-click Windows build
#  Run from the repository root in PowerShell:
#     powershell -ExecutionPolicy Bypass -File scripts\build.ps1
#  Requires: Python 3.11, Node 20+, Rust (for Tauri), Inno Setup 6
# ============================================================
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "==> [1/7] Checking prerequisites..." -ForegroundColor Cyan
foreach ($cmd in @("python", "npm", "cargo", "iscc")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Warning "$cmd not found in PATH. Please install it before continuing."
    }
}

Write-Host "==> [2/7] Downloading models & native binaries..." -ForegroundColor Cyan
& "$PSScriptRoot\download-models.ps1"

Write-Host "==> [3/7] Building frontend..." -ForegroundColor Cyan
Push-Location frontend
npm install --no-audit --no-fund
npm run build
Pop-Location

Write-Host "==> [4/7] Building backend (PyInstaller)..." -ForegroundColor Cyan
Push-Location backend
python -m venv ..\.venv-build
..\.venv-build\Scripts\python.exe -m pip install --upgrade pip
..\.venv-build\Scripts\pip install -r requirements.txt pyinstaller
..\.venv-build\Scripts\pyinstaller --noconfirm backend-server.spec
Pop-Location

Write-Host "==> [5/7] Building Tauri desktop shell..." -ForegroundColor Cyan
Push-Location desktop
npm install
npm run tauri build
Pop-Location

# Copy the Tauri exe to where the Inno script expects it.
New-Item -ItemType Directory -Force -Path desktop\src-tauri\target\release | Out-Null

Write-Host "==> [6/7] Compiling installer with Inno Setup..." -ForegroundColor Cyan
$iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) { $iscc = "iscc" }
& $iscc "installer\EnterpriseAI.iss"

Write-Host "==> [7/7] Packaging ZIP..." -ForegroundColor Cyan
$stage = "dist\Enterprise-AI-Assistant-Setup"
New-Item -ItemType Directory -Force -Path "$stage\prerequisites" | Out-Null
Copy-Item "dist-installer\setup.exe" "$stage\setup.exe" -Force
if (Test-Path "prerequisites\vc_redist.x64.exe") {
    Copy-Item "prerequisites\vc_redist.x64.exe" "$stage\prerequisites\" -Force
}
if (Test-Path "prerequisites\MicrosoftEdgeWebView2Setup.exe") {
    Copy-Item "prerequisites\MicrosoftEdgeWebView2Setup.exe" "$stage\prerequisites\" -Force
}
Copy-Item "README.txt" "$stage\" -Force
Copy-Item "LICENSE.txt" "$stage\" -Force
Compress-Archive -Path "$stage\*" -DestinationPath "dist\Enterprise-AI-Assistant-Setup.zip" -Force

Write-Host "Build complete: dist\Enterprise-AI-Assistant-Setup.zip" -ForegroundColor Green
