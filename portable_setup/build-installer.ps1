<#
.SYNOPSIS
  Builds Chatbot-Organizational-Offline-Setup.exe — the self-contained Windows
  installer (Node runtime + production build + dependencies + local models).

.DESCRIPTION
  Run on a Windows x64 machine (or the GitHub Actions windows-2022 runner)
  AFTER the application has been built:

      npm ci
      node scripts/install-model.mjs      # LLM + embedding GGUF + OCR data
      npm run build

  Steps performed:
    1. download (or reuse) the portable Node.js runtime → portable_bild\runtime\node.exe
    2. download (or reuse) poppler for Windows           → portable_bild\poppler\bin\pdftoppm.exe
    3. stage the bundle with stage-bundle.cjs            → portable_setup\release\app
       (.next, pruned production node_modules, models, drizzle, launcher,
        materialised Turbopack external aliases — no symlinks, no secrets)
    4. smoke-test the staged bundle with the embedded node.exe
       (boots the server on a temp database, logs in, searches, chats)
    5. compile the installer: Inno Setup (iscc) by default, NSIS (makensis)
       only for bundles < 2 GB. Writes <exe>.sha256 next to the output.

.PARAMETER NodeVersion   Node.js version to embed (default 22.12.0, LTS).
.PARAMETER SkipModels    Allow missing GGUF/OCR files (smaller "lite" installer,
                         keyword search + extractive answers only).
.PARAMETER SkipSmokeTest Skip step 4 (not recommended).
.PARAMETER Packager      auto | inno | nsis | none ("none" = stage only).
.PARAMETER Version       Version string (default: $env:PORTABLE_VERSION or package.json).
.PARAMETER Gpu           Keep CUDA/Vulkan llama.cpp binaries (+~600 MB).
#>
[CmdletBinding()]
param(
  [string]$NodeVersion = '22.12.0',
  [string]$PopplerVersion = '24.08.0-0',
  [switch]$SkipModels,
  [switch]$SkipSmokeTest,
  [switch]$Gpu,
  [ValidateSet('auto', 'inno', 'nsis', 'none')]
  [string]$Packager = 'auto',
  [string]$Version = $env:PORTABLE_VERSION
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$root = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $PSScriptRoot 'release'
$stage = Join-Path $releaseDir 'app'
$portable = Join-Path $root 'portable_bild'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }

function Get-DirSizeBytes([string]$Path) {
  if (!(Test-Path $Path)) { return 0 }
  return (Get-ChildItem -LiteralPath $Path -Recurse -File -Force | Measure-Object -Property Length -Sum).Sum
}

function Download-File([string]$Url, [string]$Destination) {
  Write-Host "    downloading $Url"
  $tmp = "$Destination.part"
  if (Test-Path $tmp) { Remove-Item $tmp -Force }
  try {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
      & $curl.Source -L --fail --silent --show-error --retry 3 --retry-delay 5 -o $tmp $Url
      if ($LASTEXITCODE -ne 0) { throw "curl failed with exit code $LASTEXITCODE" }
    } else {
      Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
    }
    Move-Item $tmp $Destination -Force
  } finally {
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
  }
}

function Find-Tool([string]$Name, [string[]]$Candidates) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($c in $Candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

# ---------------------------------------------------------------------------
# Version
# ---------------------------------------------------------------------------
if (-not $Version) {
  try { $Version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version } catch { }
  if (-not $Version) { $Version = '1.0.0' }
}
$Version = "$Version" -replace '^v', ''
Write-Host "Chatbot offline installer build — version $Version" -ForegroundColor Green

# Host node (used only to run the build helpers; the bundle gets its own runtime).
$hostNode = Find-Tool 'node.exe' @()
if (-not $hostNode) { throw 'node.exe is required on the build machine (Node.js 20+).' }

# ---------------------------------------------------------------------------
# 1. Portable Node.js runtime
# ---------------------------------------------------------------------------
Write-Step "Portable Node.js runtime v$NodeVersion"
$runtimeDir = Join-Path $portable 'runtime'
$nodeExe = Join-Path $runtimeDir 'node.exe'
if (Test-Path $nodeExe) {
  Write-Host "    reusing $nodeExe ($(& $nodeExe -v))"
} else {
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  $zipName = "node-v$NodeVersion-win-x64.zip"
  $zipPath = Join-Path $releaseDir $zipName
  if (!(Test-Path $zipPath)) { Download-File "https://nodejs.org/dist/v$NodeVersion/$zipName" $zipPath }

  # Verify against the official SHASUMS256.txt (fail closed on mismatch, warn when unreachable).
  try {
    $sumsPath = Join-Path $releaseDir "SHASUMS256-$NodeVersion.txt"
    Download-File "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" $sumsPath
    $line = Get-Content $sumsPath | Where-Object { $_ -match ("\s" + [regex]::Escape($zipName) + "$") } | Select-Object -First 1
    if ($line) {
      $expected = ($line -split '\s+')[0].ToLowerInvariant()
      $actual = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($expected -ne $actual) { throw "SHA-256 mismatch for $zipName (expected $expected, got $actual)" }
      Write-Host '    ✓ SHA-256 verified'
    }
  } catch {
    if ($_.Exception.Message -like 'SHA-256 mismatch*') { throw }
    Write-Warning "Checksum verification skipped: $($_.Exception.Message)"
  }

  $extract = Join-Path $releaseDir 'node-extract'
  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
  Expand-Archive -Path $zipPath -DestinationPath $extract -Force
  $inner = Get-ChildItem $extract -Directory | Select-Object -First 1
  # Only node.exe (+ licence) ships: npm/npx are never used offline.
  Copy-Item (Join-Path $inner.FullName 'node.exe') $nodeExe -Force
  Copy-Item (Join-Path $inner.FullName 'LICENSE') (Join-Path $runtimeDir 'LICENSE') -Force
  Remove-Item $extract -Recurse -Force
  Write-Host "    ✓ $(& $nodeExe -v) staged"
}

# ---------------------------------------------------------------------------
# 2. poppler (pdftoppm) for scanned-PDF OCR
# ---------------------------------------------------------------------------
Write-Step "poppler for Windows $PopplerVersion (pdftoppm)"
$popplerDir = Join-Path $portable 'poppler'
$pdftoppm = Join-Path $popplerDir 'bin\pdftoppm.exe'
if (Test-Path $pdftoppm) {
  Write-Host "    reusing $pdftoppm"
} else {
  try {
    $popplerZip = Join-Path $releaseDir "poppler-$PopplerVersion.zip"
    if (!(Test-Path $popplerZip)) {
      Download-File "https://github.com/oschwartz10612/poppler-windows/releases/download/v$PopplerVersion/Release-$PopplerVersion.zip" $popplerZip
    }
    $extract = Join-Path $releaseDir 'poppler-extract'
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive -Path $popplerZip -DestinationPath $extract -Force
    $binDir = Get-ChildItem $extract -Recurse -Filter 'pdftoppm.exe' | Select-Object -First 1 | ForEach-Object { $_.DirectoryName }
    if (-not $binDir) { throw 'pdftoppm.exe not found inside the poppler archive' }
    if (Test-Path $popplerDir) { Remove-Item $popplerDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $popplerDir | Out-Null
    Copy-Item $binDir (Join-Path $popplerDir 'bin') -Recurse -Force
    $lic = Get-ChildItem $extract -Recurse -File | Where-Object { $_.Name -match '^(COPYING|LICENSE)' } | Select-Object -First 1
    if ($lic) { Copy-Item $lic.FullName (Join-Path $popplerDir 'LICENSE') -Force }
    Remove-Item $extract -Recurse -Force
    Write-Host '    ✓ pdftoppm.exe staged'
  } catch {
    Write-Warning "poppler could not be prepared ($($_.Exception.Message)). Scanned-PDF OCR will be unavailable in this build; text PDFs, DOCX and images still work."
  }
}

# ---------------------------------------------------------------------------
# 3. Stage the bundle (shared, cross-platform logic)
# ---------------------------------------------------------------------------
Write-Step "Staging bundle in $stage"
$stageArgs = @((Join-Path $PSScriptRoot 'stage-bundle.cjs'), $root, $stage, '--platform', 'win32', '--arch', 'x64', '--version', $Version)
if ($SkipModels) { $stageArgs += '--skip-models' }
if ($Gpu) { $stageArgs += '--gpu' }
& $hostNode @stageArgs
if ($LASTEXITCODE -ne 0) { throw 'stage-bundle.cjs failed' }

$stageBytes = Get-DirSizeBytes $stage
$stageGB = [math]::Round($stageBytes / 1GB, 2)
Write-Host ("    staged size: {0} GB" -f $stageGB)

# ---------------------------------------------------------------------------
# 4. Smoke test with the embedded runtime
# ---------------------------------------------------------------------------
if (-not $SkipSmokeTest) {
  Write-Step 'Smoke-testing the staged bundle with the embedded node.exe'
  & (Join-Path $stage 'portable_bild\runtime\node.exe') (Join-Path $PSScriptRoot 'smoke-test.cjs') $stage --port 3899
  if ($LASTEXITCODE -ne 0) { throw 'Smoke test of the staged bundle FAILED — refusing to build an installer from a broken bundle.' }
}

if ($Packager -eq 'none') {
  Write-Host "`nStaging complete (no installer requested): $stage" -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------------------
# 5. Compile the installer
# ---------------------------------------------------------------------------
$iscc = Find-Tool 'iscc.exe' @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe")
$makensis = Find-Tool 'makensis.exe' @(
  "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
  "$env:ProgramFiles\NSIS\makensis.exe")

$nsisLimit = 1.9GB
$useInno = switch ($Packager) {
  'inno' { $true }
  'nsis' { $false }
  default { [bool]$iscc -or ($stageBytes -gt $nsisLimit) }
}
if (-not $useInno -and $stageBytes -gt $nsisLimit) {
  throw 'Bundle exceeds the 2 GB NSIS limit. Install Inno Setup 6.5+ (iscc.exe) or pass -SkipModels.'
}

# Persian translation for the Inno wizard (community file from the Inno Setup repo).
$farsi = Join-Path $PSScriptRoot 'Farsi.isl'
if ($useInno -and !(Test-Path $farsi)) {
  try { Download-File 'https://raw.githubusercontent.com/jrsoftware/issrc/main/Files/Languages/Unofficial/Farsi.isl' $farsi }
  catch { Write-Warning "Farsi.isl could not be downloaded — the installer UI will be English only ($($_.Exception.Message))" }
}

$exe = Join-Path $PSScriptRoot 'Chatbot-Organizational-Offline-Setup.exe'
Get-ChildItem $PSScriptRoot -Filter 'Chatbot-Organizational-Offline-Setup*' -File | Remove-Item -Force

Push-Location $PSScriptRoot
try {
  if ($useInno) {
    if (-not $iscc) { throw 'Inno Setup 6.5+ is required (iscc.exe not found). https://jrsoftware.org/isdl.php' }
    Write-Step "Compiling with Inno Setup ($iscc)"
    $isccArgs = @("/DAppVersion=$Version", "/DSourceDir=$stage", "/O$PSScriptRoot", '/Qp')
    # Single-file installers are limited to ~4 GB; larger bundles need slices.
    if ($stageBytes -gt 3.8GB) { $isccArgs += '/DDiskSpanning=yes'; Write-Warning 'Bundle > 3.8 GB — enabling disk spanning (Setup-*.bin slices will be produced).' }
    & $iscc @isccArgs 'installer.iss'
    if ($LASTEXITCODE -ne 0) { throw "iscc failed with exit code $LASTEXITCODE" }
  } else {
    if (-not $makensis) { throw 'NSIS 3.x is required (makensis.exe not found).' }
    Write-Step "Compiling with NSIS ($makensis)"
    & $makensis '/V2' "/DAPP_VERSION=$Version" "/DSOURCE_DIR=$stage" 'installer.nsi'
    if ($LASTEXITCODE -ne 0) { throw "makensis failed with exit code $LASTEXITCODE" }
  }
} finally {
  Pop-Location
}

if (!(Test-Path $exe)) { throw "Installer was not produced: $exe" }
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path "$exe.sha256" -Value "$hash  $(Split-Path $exe -Leaf)" -Encoding ASCII
Write-Host ("`n✓ {0}  ({1:N0} MB)`n  SHA-256 {2}" -f $exe, ((Get-Item $exe).Length / 1MB), $hash) -ForegroundColor Green
Get-ChildItem $PSScriptRoot -Filter 'Chatbot-Organizational-Offline-Setup-*.bin' -File | ForEach-Object {
  $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  Add-Content -Path "$exe.sha256" -Value "$h  $($_.Name)" -Encoding ASCII
  Write-Host ("  + {0} ({1:N0} MB) — distribute together with the .exe" -f $_.Name, ($_.Length / 1MB))
}
