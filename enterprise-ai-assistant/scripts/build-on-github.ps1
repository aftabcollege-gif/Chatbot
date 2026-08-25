# ============================================================
#  Build the Windows setup.exe in GitHub Actions (no local
#  Windows / Rust / Python needed) and download the result.
#
#  Usage:
#    # one-time (only if gh isn't authenticated):
#    gh auth login
#
#    powershell -ExecutionPolicy Bypass -File scripts\build-on-github.ps1
#
#  Optional: -LargeModel to bundle Qwen2.5-7B (~5GB) instead of 1.5B.
# ============================================================
param(
  [string]$Repo = "",            # e.g. "owner/repo"; defaults to the git remote
  [string]$Ref = "main",
  [switch]$LargeModel,
  [switch]$Tauri                 # build Tauri/Inno instead of Electron/NSIS
)

$ErrorActionPreference = "Stop"

if (-not $Repo) {
  $remote = git remote get-url origin 2>$null
  if ($remote -match "github\.com[:/](.+?)(?:\.git)?$") {
    $Repo = $Matches[1]
  } else {
    Write-Error "Could not detect repo. Pass -Repo owner/name."
  }
}
Write-Host "Repository: $Repo  ref: $Ref" -ForegroundColor Cyan

# GitHub Actions only recognises workflows at <repo>/.github/workflows.
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
$inputs = if ($LargeModel) { @{ large_model = "true" } } else { @{} }

Write-Host "==> Triggering $workflow ..." -ForegroundColor Cyan
gh workflow run $workflow --repo $Repo --ref $Ref `
  $(if ($LargeModel) { @('-f', 'large_model=true') } else { @() })

Write-Host "Waiting for run to start..." -ForegroundColor Cyan
Start-Sleep -Seconds 6
$run = gh run list --repo $Repo --workflow $workflow --limit 1 --json databaseId,status | ConvertFrom-Json
$runId = $run[0].databaseId
Write-Host "Run #$runId — streaming logs:" -ForegroundColor Cyan
gh run watch $runId --repo $Repo --exit-status

Write-Host "==> Downloading setup artifacts..." -ForegroundColor Green
$out = "release"
New-Item -ItemType Directory -Force -Path $out | Out-Null
gh run download $runId --repo $Repo --dir $out

$zip = Get-ChildItem -Path $out -Recurse -Filter "Enterprise-AI-Assistant-Setup.zip" | Select-Object -First 1
if ($zip) {
  Write-Host "`nDone: $($zip.FullName)" -ForegroundColor Green
  explorer /select,$zip.FullName
} else {
  Write-Host "Artifacts downloaded to: $(Resolve-Path $out)" -ForegroundColor Green
}
