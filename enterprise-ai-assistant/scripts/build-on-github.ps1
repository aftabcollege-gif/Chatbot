# ============================================================
#  Build the Windows installer(s) in GitHub Actions and download
#  the result — no local Windows, Rust, Python, or model download
#  required.
#
#  Produces per model:
#    setup.exe        (NSIS one-click/per-machine installer)
#    EnterpriseAI.msi (MSI package for enterprise deployment)
#    Enterprise-AI-Assistant-Setup-<model>.zip (bundle with
#      prerequisites and README/LICENSE)
#
#  Usage:
#    gh auth login                                 # one-time
#    powershell -File scripts\build-on-github.ps1               # 1.5B (default)
#    powershell -File scripts\build-on-github.ps1 -Model 7b     # 7B model
#    powershell -File scripts\build-on-github.ps1 -Model both   # both models
#    powershell -File scripts\build-on-github.ps1 -Tauri         # Tauri/Inno build
# ============================================================
param(
  [string]$Repo = "",
  [string]$Ref = "main",
  [ValidateSet("1.5b","7b","both")]
  [string]$Model = "1.5b",
  [switch]$Tauri
)

$ErrorActionPreference = "Stop"

if (-not $Repo) {
  $remote = git remote get-url origin 2>$null
  if ($remote -match "github\.com[:/](.+?)(?:\.git)?$") { $Repo = $Matches[1] }
  else { Write-Error "Could not detect repo. Pass -Repo owner/name." }
}
Write-Host "Repo: $Repo  ref: $Ref  model: $Model" -ForegroundColor Cyan

$wfDir = ".github/workflows"
if (-not (Test-Path $wfDir)) {
  Write-Host "==> Copying workflows to .github/workflows at repo root..." -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $wfDir | Out-Null
  Copy-Item "enterprise-ai-assistant\.github\workflows\*.yml" $wfDir -Force
  git add $wfDir
  git commit -m "ci: add Windows build workflows"
  git push origin $Ref
}

$workflow = if ($Tauri) { "tauri.yml" } else { "build-windows.yml" }
$inputs = @{ model = $Model }

Write-Host "==> Triggering $workflow (model=$Model)..." -ForegroundColor Cyan
gh workflow run $workflow --repo $Repo --ref $Ref -f "model=$Model"

Write-Host "Waiting for run to start..." -ForegroundColor Cyan
Start-Sleep -Seconds 7
$run = gh run list --repo $Repo --workflow $workflow --limit 1 --json databaseId,displayTitle | ConvertFrom-Json
$runId = $run[0].databaseId
Write-Host "Run #$runId — $($run[0].displayTitle)" -ForegroundColor Cyan
gh run watch $runId --repo $Repo --exit-status

Write-Host "==> Downloading artifacts..." -ForegroundColor Green
$out = "release"
New-Item -ItemType Directory -Force -Path $out | Out-Null
gh run download $runId --repo $Repo --dir $out

Write-Host "`nArtifacts (NSIS .exe + MSI + ZIP) downloaded to:" -ForegroundColor Green
Write-Host (Resolve-Path $out)
Get-ChildItem -Path $out -Recurse -Include *.exe,*.msi,*.zip | ForEach-Object {
  Write-Host "  $($_.FullName)" -ForegroundColor Green
}
