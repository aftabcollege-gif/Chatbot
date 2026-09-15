$ErrorActionPreference = (-join [char[]](83,116,111,112))
$MarkerStart = (-join [char[]](35,95,95,80,65,84,67,72,95,66,54,52,95,83,84,65,82,84,95,95))
$MarkerEnd = (-join [char[]](35,95,95,80,65,84,67,72,95,66,54,52,95,69,78,68,95,95))
$CfgName = (-join [char[]](100,101,102,97,117,108,116,46,121,97,109,108))
$PatchesDir = (-join [char[]](112,97,116,99,104,101,115))
$SiteCustomize = (-join [char[]](115,105,116,101,99,117,115,116,111,109,105,122,101,46,112,121))
$CfgDir = (-join [char[]](99,111,110,102,105,103))
$InternalCfg = (-join [char[]](95,105,110,116,101,114,110,97,108,92,99,111,110,102,105,103,92,100,101,102,97,117,108,116,46,121,97,109,108))
$RootCfg = (-join [char[]](99,111,110,102,105,103,92,100,101,102,97,117,108,116,46,121,97,109,108))
$DoneBanner = (-join [char[]](61,61,61,32,69,110,116,101,114,112,114,105,115,101,32,65,73,32,65,115,115,105,115,116,97,110,116,32,45,32,79,102,102,108,105,110,101,32,80,97,116,99,104,32,118,49,46,48,46,50,32,61,61,61))
$DoneMsg = (-join [char[]](61,61,61,32,68,111,110,101,46,32,89,111,117,32,99,97,110,32,108,97,117,110,99,104,32,116,104,101,32,97,112,112,32,110,111,119,46,32,61,61,61))
$EnterPrompt = (-join [char[]](69,110,116,101,114,32,105,110,115,116,97,108,108,32,102,111,108,100,101,114,32,40,99,111,110,116,97,105,110,105,110,103,32,116,104,101,32,97,112,112,108,105,99,97,116,105,111,110,32,46,101,120,101,44,32,101,46,103,46,32,67,58,92,80,114,111,103,114,97,109,32,70,105,108,101,115,92,67,104,97,116,98,111,116,32,69,110,116,101,114,112,114,105,115,101,41,58))
$NoPayload = (-join [char[]](69,109,98,101,100,100,101,100,32,112,97,116,99,104,32,112,97,121,108,111,97,100,32,110,111,116,32,102,111,117,110,100,46))
$InvalidZip = (-join [char[]](80,97,116,99,104,32,97,114,99,104,105,118,101,32,105,110,118,97,108,105,100,46))
$NotFound = (-join [char[]](78,111,32,115,117,112,112,111,114,116,101,100,32,97,112,112,108,105,99,97,116,105,111,110,32,101,120,101,99,117,116,97,98,108,101,32,102,111,117,110,100,32,105,110,32,116,104,97,116,32,102,111,108,100,101,114,46))
$InstallDirF = (-join [char[]](73,110,115,116,97,108,108,32,100,105,114,58,32))
$UpdatingCfg = (-join [char[]](117,112,100,97,116,101,100,32,99,111,110,102,105,103,58,32))
$AppliedPatches = (-join [char[]](97,112,112,108,105,101,100,32,112,97,116,99,104,58,32))
$NoPyNote = (-join [char[]](78,111,32,80,121,116,104,111,110,32,114,101,113,117,105,114,101,100,32,45,32,112,97,116,99,104,101,115,32,97,114,101,32,108,111,97,100,101,100,32,98,121,32,116,104,101,32,97,112,112,32,105,116,115,101,108,102,46))
$PressEnter = (-join [char[]](80,114,101,115,115,32,69,110,116,101,114,32,116,111,32,101,120,105,116))
$Note1 = (-join [char[]](78,79,84,69,58,32,70,111,114,32,100,111,99,117,109,101,110,116,115,32,117,112,108,111,97,100,101,100,32,66,69,70,79,82,69,32,116,104,105,115,32,112,97,116,99,104,44,32,114,101,45,117,112,108,111,97,100,32,116,104,101,109,32,111,114,32,100,101,108,101,116,101))
$Note2 = (-join [char[]](32,32,37,65,80,80,68,65,84,65,37,92,69,110,116,101,114,112,114,105,115,101,65,73,92,100,97,116,97,92,101,110,116,101,114,112,114,105,115,101,46,100,98,32,116,111,32,114,101,45,105,110,100,101,120,46))
$ZipName = (-join [char[]](112,97,116,99,104,46,122,105,112))
$TmpPre = (-join [char[]](101,97,105,45,112,97,116,99,104,45))
$Nformat = (-join [char[]](78))
$Green = (-join [char[]](71,114,101,101,110))
$Cyan = (-join [char[]](67,121,97,110))
$ProgFiles = (-join [char[]](80,114,111,103,114,97,109,70,105,108,101,115))
$ProgFilesX86 = (-join [char[]](80,114,111,103,114,97,109,70,105,108,101,115,88,56,54))
$LocalApp = (-join [char[]](76,111,99,97,108,65,112,112,108,105,99,97,116,105,111,110,68,97,116,97))
$UTF8 = (-join [char[]](85,84,70,56))
$BakLit = (-join [char[]](46,98,97,107,45))
$Exe1 = (-join [char[]](67,104,97,116,98,111,116,32,69,110,116,101,114,112,114,105,115,101,46,101,120,101))
$Exe2 = (-join [char[]](69,110,116,101,114,112,114,105,115,101,65,73,46,101,120,101))
$Exe3 = (-join [char[]](67,104,97,116,98,111,116,46,101,120,101))
$SubChatEnt = (-join [char[]](92,67,104,97,116,98,111,116,32,69,110,116,101,114,112,114,105,115,101))
$SubAI = (-join [char[]](92,69,110,116,101,114,112,114,105,115,101,65,73))
$SubLAChat = (-join [char[]](92,80,114,111,103,114,97,109,115,92,67,104,97,116,98,111,116,32,69,110,116,101,114,112,114,105,115,101))
$SubLAAI = (-join [char[]](92,80,114,111,103,114,97,109,115,92,69,110,116,101,114,112,114,105,115,101,65,73))
$SilentlyCont = (-join [char[]](83,105,108,101,110,116,108,121,67,111,110,116,105,110,117,101))
$Internal = (-join [char[]](95,105,110,116,101,114,110,97,108))
$DateFmt = (-join [char[]](121,121,121,121,77,77,100,100,45,72,72,109,109,115,115))
$BSName = (-join [char[]](98,97,99,107,101,110,100,45,115,101,114,118,101,114))
$LSName = (-join [char[]](108,108,97,109,97,45,115,101,114,118,101,114))
$ExeNames = @($Exe1,$Exe2,$Exe3)
$Empty = [string]::Empty

$payloadLines = @()
$inPayload = $false
foreach ($raw in Get-Content -LiteralPath $PSCommandPath -Encoding $UTF8) {
    if ($raw -eq $MarkerStart) { $inPayload = $true; continue }
    if ($raw -eq $MarkerEnd)   { $inPayload = $false; continue }
    if ($inPayload -and $raw.Trim().Length -gt 0) { $payloadLines += $raw.Trim() }
}
if ($payloadLines.Count -eq 0) { Write-Error $NoPayload; exit 1 }
$zipB64 = ($payloadLines -join $Empty)

Write-Host $DoneBanner -ForegroundColor $Cyan

$WorkDir = Join-Path $env:TEMP ($TmpPre + [guid]::NewGuid().ToString($Nformat))
try { New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null } catch {}
$zipPath = Join-Path $WorkDir $ZipName
[System.IO.File]::WriteAllBytes($zipPath, [System.Convert]::FromBase64String($zipB64))
Expand-Archive -LiteralPath $zipPath -DestinationPath $WorkDir -Force
$patchFolder = Join-Path $WorkDir $PatchesDir
$scSource    = Join-Path $WorkDir $SiteCustomize
$cfgSource   = Join-Path $WorkDir $CfgDir
if (-not (Test-Path -LiteralPath $patchFolder)) { Write-Error $InvalidZip; exit 1 }
if (-not (Test-Path -LiteralPath $scSource))    { Write-Error $InvalidZip; exit 1 }
if (-not (Test-Path -LiteralPath $cfgSource))   { Write-Error $InvalidZip; exit 1 }

$pf  = [Environment]::GetFolderPath($ProgFiles)
$pfx = [Environment]::GetFolderPath($ProgFilesX86)
$la  = [Environment]::GetFolderPath($LocalApp)
$folderCandidates = @(
    ($pf  + $SubChatEnt), ($pfx + $SubChatEnt),
    ($pf  + $SubAI),      ($pfx + $SubAI),
    ($la  + $SubLAChat),  ($la  + $SubLAAI)
)

function Find-AppInFolder([string]$folder, [ref]$foundExe) {
    if (-not $folder) { return $false }
    if (-not (Test-Path -LiteralPath $folder)) { return $false }
    foreach ($name in $ExeNames) {
        $p = Join-Path $folder $name
        if (Test-Path -LiteralPath $p) { $foundExe.Value = $p; return $true }
    }
    return $false
}

$InstallDir = $null
foreach ($folder in $folderCandidates) {
    $found = $null
    if (Find-AppInFolder $folder ([ref]$found)) { $InstallDir = $folder; break }
}
if (-not $InstallDir) {
    $InstallDir = Read-Host $EnterPrompt
    $found = $null
    if (-not (Find-AppInFolder $InstallDir ([ref]$found))) { Write-Error $NotFound; exit 1 }
}
Write-Host ($InstallDirF + $InstallDir) -ForegroundColor $Green

foreach ($name in $ExeNames) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($name)
    Get-Process -Name $base -ErrorAction $SilentlyCont | Stop-Process -Force -ErrorAction $SilentlyCont
}
Get-Process -Name $BSName -ErrorAction $SilentlyCont | Stop-Process -Force -ErrorAction $SilentlyCont
Get-Process -Name $LSName -ErrorAction $SilentlyCont | Stop-Process -Force -ErrorAction $SilentlyCont
Start-Sleep -Seconds 2

$internalDir = Join-Path $InstallDir $Internal
$cfgTargets = @((Join-Path $InstallDir $InternalCfg))
$rootCfgPath = Join-Path $InstallDir $RootCfg
if (Test-Path -LiteralPath $rootCfgPath) { $cfgTargets += $rootCfgPath }
foreach ($tgt in $cfgTargets) {
    if (Test-Path -LiteralPath $tgt) {
        $bak = $tgt + $BakLit + (Get-Date -Format $DateFmt)
        Copy-Item -LiteralPath $tgt -Destination $bak -Force
    } else {
        New-Item -ItemType Directory -Force -Path (Split-Path $tgt) | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $cfgSource $CfgName) -Destination $tgt -Force
    Write-Host ($UpdatingCfg + $tgt)
}

$destPatches = Join-Path $internalDir $PatchesDir
if (Test-Path -LiteralPath $destPatches) {
    Remove-Item -Recurse -Force -LiteralPath $destPatches -ErrorAction $SilentlyCont
}
Copy-Item -Recurse -Force -LiteralPath $patchFolder -Destination $destPatches
Write-Host ($AppliedPatches + $destPatches)

$scDest = Join-Path $internalDir $SiteCustomize
if (Test-Path -LiteralPath $scDest) {
    $bak = $scDest + $BakLit + (Get-Date -Format $DateFmt)
    Copy-Item -LiteralPath $scDest -Destination $bak -Force
}
Copy-Item -LiteralPath $scSource -Destination $scDest -Force
Write-Host ($AppliedPatches + $scDest)

Write-Host $Empty
Write-Host $DoneMsg -ForegroundColor $Green
Write-Host $NoPyNote
Write-Host $Note1
Write-Host $Note2
if (Test-Path -LiteralPath $WorkDir) {
    try { Remove-Item -Recurse -Force -LiteralPath $WorkDir -ErrorAction $SilentlyCont } catch {}
}
Read-Host $PressEnter

<#
#__PATCH_B64_START__

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
SwUGAAAAAAcABwDwAQAA9TsAAAAA
#__PATCH_B64_END__
#>
