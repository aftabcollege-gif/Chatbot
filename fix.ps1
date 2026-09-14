#Requires -Version 5.1
# Hotfix: stops the chatbot repeating the same phrase forever.
# Patches an INSTALLED app in place. No reinstall, no internet, no downloads.
#
# Runs correctly from an elevated shell whose admin account is NOT the person
# who installed the app: it never reads $env:LOCALAPPDATA / $env:USERPROFILE /
# $env:TEMP, because under "Run as administrator" those point at the ADMIN's
# profile. Install detection walks every user profile on the machine instead.
#
# This file is pure ASCII on purpose, so it survives Notepad, email and
# copy-paste with any encoding. The Persian text is base64 inside.
#
# Usage:  .\fix.ps1                 auto-detect
#         .\fix.ps1 -List           only show the installs it can see
#         .\fix.ps1 -InstallDir "C:\Program Files\EnterpriseAI"
#         .\fix.ps1 -Revert         undo everything
param([string]$InstallDir,[switch]$Revert,[switch]$List)
$ErrorActionPreference="Stop"
function I($m){Write-Host $m -ForegroundColor Cyan}
function G($m){Write-Host "   $m" -ForegroundColor Green}
function Y($m){Write-Host "   $m" -ForegroundColor Yellow}
function R($m){Write-Host $m -ForegroundColor Red}
function U($b){[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))}

# --- locate install (works from ANY admin account) ------------------------
$NAMES=@("EnterpriseAI","chatbot-enterprise","Chatbot Enterprise","Enterprise AI")

# A folder counts as an install if it holds a config\default.yaml, either at
# the root, under resources\ (Electron), or under backend\ (PyInstaller).
function Valid($p){
  if(-not $p){return $null}
  $p=([string]$p).Trim('"').TrimEnd('\')
  if(-not (Test-Path $p)){return $null}
  foreach($s in @("","resources")){
    $q=if($s){Join-Path $p $s}else{$p}
    if(Test-Path (Join-Path $q "config\default.yaml")){return $q}
    if(Test-Path (Join-Path $q "backend\config\default.yaml")){return $q}}
  return $null}

function Candidates{
  $c=New-Object Collections.Generic.List[string]
  # machine-wide (these env vars are NOT per-user, so they are safe)
  foreach($b in @($env:ProgramFiles,${env:ProgramFiles(x86)})){
    if($b){foreach($n in $NAMES){$c.Add((Join-Path $b $n))}}}
  # every user profile, read from the registry rather than from $env:
  foreach($k in (Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList' -EA SilentlyContinue)){
    $d=(Get-ItemProperty $k.PSPath -EA SilentlyContinue).ProfileImagePath
    if(-not ($d -and (Test-Path $d))){continue}
    foreach($n in $NAMES){$c.Add("$d\AppData\Local\Programs\$n")}
    # resolve that user's Start Menu shortcut -> catches custom folders
    $sm="$d\AppData\Roaming\Microsoft\Windows\Start Menu\Programs"
    if(Test-Path $sm){
      foreach($l in (Get-ChildItem $sm -Recurse -Filter *.lnk -EA SilentlyContinue |
                     Where-Object {$_.Name -match 'Enterprise|Chatbot'})){
        try{$t=(New-Object -ComObject WScript.Shell).CreateShortcut($l.FullName).TargetPath
            if($t){$c.Add((Split-Path $t -Parent))}}catch{}}}}
  # uninstall entries: machine-wide + every user hive currently loaded
  $ks=@('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
  foreach($h in (Get-ChildItem Registry::HKEY_USERS -EA SilentlyContinue)){
    $ks+="Registry::$($h.Name)\Software\Microsoft\Windows\CurrentVersion\Uninstall"}
  foreach($k in $ks){
    foreach($e in (Get-ChildItem $k -EA SilentlyContinue)){
      $v=Get-ItemProperty $e.PSPath -EA SilentlyContinue
      if($v -and $v.DisplayName -match 'Enterprise\s*AI|Chatbot' -and $v.InstallLocation){
        $c.Add($v.InstallLocation)}}}
  $c}

$found=@()
foreach($x in (Candidates)){$v=Valid $x; if($v -and ($found -notcontains $v)){$found+=$v}}

if($List){
  I "Running as: $env:USERDOMAIN\$env:USERNAME"
  I "Installs found:"
  if($found.Count -gt 0){foreach($f in $found){G $f}}else{Y "none"}
  exit 0}

if($InstallDir){
  $v=Valid $InstallDir
  if(-not $v){R "Not an install folder: $InstallDir"
    R "Expected config\default.yaml or backend\config\default.yaml inside it."; exit 1}
  $InstallDir=$v}
elseif($found.Count -eq 1){$InstallDir=$found[0]}
elseif($found.Count -gt 1){
  R "More than one install found. Re-run naming the right one:"
  foreach($f in $found){R "  .\fix.ps1 -InstallDir `"$f`""}
  exit 1}
else{
  R "Install folder not found automatically."
  R ""
  R "This shell is running as $env:USERDOMAIN\$env:USERNAME. If the app was"
  R "installed by a different user, give the path yourself:"
  R '  .\fix.ps1 -InstallDir "C:\Program Files\EnterpriseAI"'
  R ""
  R "To find it: start the app, open Task Manager, right-click the app,"
  R "choose 'Open file location', and use that folder."
  exit 1}
I "Install: $InstallDir"

# --- must be closed (files are locked while running) ----------------------
$run = Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -match 'EnterpriseAI|llama-server|backend-server|Chatbot'}
if($run){
  R "`nClose the app completely first (check the system tray), then re-run."
  $run | Select-Object -Expand ProcessName -Unique | ForEach-Object {Write-Host "  - $_"}; exit 1}

$bk = Join-Path $InstallDir "hotfix-backup"
$llm = Join-Path $InstallDir "llm"
$real = Join-Path $llm "llama-server.exe"
$orig = Join-Path $llm "llama-server-original.exe"

# --- revert ---------------------------------------------------------------
if($Revert){
  I "Reverting"
  foreach($m in @("cfg","prm")){
    $mf = Join-Path $bk "$m.txt"
    if(Test-Path $mf){foreach($l in Get-Content $mf){
      $p=$l -split '\|',2; if($p.Count -ne 2){continue}
      $s=Join-Path $bk "$m.$($p[0])"; if(Test-Path $s){Copy-Item $s $p[1] -Force; G "restored $($p[1])"}}}}
  if(Test-Path $orig){Remove-Item $real -Force -EA SilentlyContinue; Move-Item $orig $real -Force; G "engine restored"}
  Write-Host "`nDone. Start the app normally." -ForegroundColor Green; exit 0}

# --- find every config copy ----------------------------------------------
# The PyInstaller spec bundles ../config into the onedir output, so there are
# TWO copies. The frozen backend resolves <exe folder>\config first, and
# backend-server.exe lives in {app}\backend -- so the backend copy is the one
# actually read. Patch them all.
$cfgs = @(Get-ChildItem $InstallDir -Recurse -Filter default.yaml -EA SilentlyContinue |
          Where-Object {$_.DirectoryName -match '\\config$'} | Select-Object -Expand FullName)
if($cfgs.Count -eq 0){R "No config\default.yaml found under $InstallDir"; exit 1}
I "Config files: $($cfgs.Count)"
foreach($c in $cfgs){
  $r=$c.Substring($InstallDir.Length).TrimStart('\')
  if($c -match '\\backend\\config\\'){G "$r   <- backend reads this"}else{G $r}}

New-Item -ItemType Directory -Force -Path $bk | Out-Null

function SetY($t,$sec,$key,$val){
  $p="(?ms)^($sec\s*:.*?)^(\s+$key\s*:)[^\r\n]*"
  if($t -match $p){return [regex]::Replace($t,$p,{param($m)"$($m.Groups[1].Value)$($m.Groups[2].Value) $val"},1)}
  return $t}

# --- patch configs --------------------------------------------------------
# temperature 0.1 -> 0.3 : near-greedy sampling with no repeat penalty is
#   exactly when small models lock into a loop. Only anti-loop lever available
#   from config alone, so it still helps if the engine patch below is skipped.
# max_tokens 2048 -> 700, reranker.top_k 5 -> 2 : the prompt did not fit in
#   the window (see --parallel note below), so llama.cpp evicted the
#   instructions at the start of the prompt.
# NOTE: reranker.top_k is the live key; rag.reranker_top_k is never read.
I "Patching config"
$n=0
foreach($c in $cfgs){
  $n++
  $d=Join-Path $bk "cfg.$n"
  if(-not (Test-Path $d)){Copy-Item $c $d -Force; Add-Content (Join-Path $bk "cfg.txt") "$n|$c"}
  $y=Get-Content $c -Raw -Encoding UTF8; $b=$y
  $y=SetY $y 'llm' 'temperature' '0.3'
  $y=SetY $y 'llm' 'max_tokens' '700'
  $y=SetY $y 'reranker' 'top_k' '2'
  $y=SetY $y 'rag' 'chat_history_max_tokens' '200'
  $r=$c.Substring($InstallDir.Length).TrimStart('\')
  # in-place rewrite: keeps the file's existing owner and permissions, so the
  # real user can still read it after this admin account edits it
  if($y -ne $b){[IO.File]::WriteAllText($c,$y,(New-Object Text.UTF8Encoding $false)); G "patched $r"}
  else{Y "already patched: $r"}}

# --- engine: add repetition penalties + undo the context split ------------
# The backend sends no penalty fields, and llama.cpp defaults repeat_penalty
# to 1.0 (disabled) -- the root cause of the loop. server.cpp resolves each
# request as json_value(data,"repeat_penalty",default_sparams.penalty_repeat),
# so server-level CLI defaults apply when the body omits them.
# Also: the launcher hardcodes --parallel 2, and llama.cpp splits the window
# per slot (n_ctx_slot = n_ctx / n_parallel), silently halving 4096 -> 2048.
# This is a single-user app, so forcing 1 restores the full window.
I "Patching LLM engine"
if(-not (Test-Path $real)){Y "llama-server.exe not found - config changes still apply"}
elseif(Test-Path $orig){Y "already patched"}
else{
  Move-Item $real $orig -Force
  $cs=@'
using System;using System.Diagnostics;using System.IO;using System.Text;
class S{static int Main(string[] a){
 string d=AppDomain.CurrentDomain.BaseDirectory;
 StringBuilder b=new StringBuilder();
 for(int i=0;i<a.Length;i++){
  if(a[i]=="--parallel"&&i+1<a.Length){b.Append("\"--parallel\" \"1\" ");i++;continue;}
  b.Append('"').Append(a[i].Replace("\"","\\\"")).Append("\" ");}
 b.Append("--repeat-penalty 1.15 --repeat-last-n 256 --frequency-penalty 0.3 --presence-penalty 0.3");
 ProcessStartInfo p=new ProcessStartInfo(Path.Combine(d,"llama-server-original.exe"),b.ToString());
 p.UseShellExecute=false;p.WorkingDirectory=d;
 Process x=Process.Start(p);x.WaitForExit();return x.ExitCode;}}
'@
  # scratch file goes in the backup folder, NOT $env:TEMP: under "Run as
  # administrator" $env:TEMP belongs to the admin's profile, which the real
  # user may not be able to reach.
  $tmp=Join-Path $bk "s.cs"; Set-Content $tmp $cs -Encoding UTF8
  # csc.exe ships with .NET Framework 4.x, which is part of Windows 10/11 --
  # nothing is downloaded here.
  $csc=Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) "csc.exe"
  if(-not (Test-Path $csc)){$csc=Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64\v4*\csc.exe" -EA SilentlyContinue|Select-Object -Last 1 -Expand FullName}
  if(-not ($csc -and (Test-Path $csc))){$csc=Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework\v4*\csc.exe" -EA SilentlyContinue|Select-Object -Last 1 -Expand FullName}
  if($csc -and (Test-Path $csc)){
    & $csc /nologo /target:exe /platform:anycpu /out:"$real" "$tmp" | Out-Null
    if($LASTEXITCODE -eq 0 -and (Test-Path $real)){
      # the new exe is created by THIS admin; copy the original binary's
      # permissions onto it so the real user can still launch the app
      try{Set-Acl -Path $real -AclObject (Get-Acl $orig)}catch{Y "could not copy permissions to the new exe"}
      G "repeat_penalty=1.15, --parallel forced to 1"}
    else{Move-Item $orig $real -Force; Y "build failed - engine unchanged"}}
  else{Move-Item $orig $real -Force; Y "no C# compiler - engine unchanged (config fixes still apply)"}
  Remove-Item $tmp -Force -EA SilentlyContinue}

# --- system prompt (re-read every request, no restart needed) -------------
I "Tightening system prompt"
$mk=U "2YfYsdqv2LIg24zaqSDYudio2KfYsdiqINuM2Kcg2KzZhdmE2Ycg2LHYpyDYqtqp2LHYp9ixINmG2qnZhg=="
$add=U "DQoNCtmC2YjYp9i52K8g2LbYryDYqtqp2LHYp9ixICjZhdmH2YUpOg0KLSDZh9ix2q/YsiDbjNqpINi52KjYp9ix2Kog24zYpyDYrNmF2YTZhyDYsdinINiq2qnYsdin2LEg2YbaqdmGLiDZh9ixINis2YXZhNmHINio2KfbjNivINin2LfZhNin2LnYp9iqINiq2KfYstmHINin2LbYp9mB2Ycg2qnZhtivLg0KLSDZvtin2LPYriDYsdinINqp2YjYqtin2Ycg2Ybar9mHINiv2KfYsdibINit2K/Yp9qp2KvYsSDahtmG2K8g2KjZhtivINqp2YjYqtin2YcuDQotINmI2YLYqtuMINm+2KfYs9iuINqp2KfZhdmEINi02K/YjCDYqNmE2KfZgdin2LXZhNmHINmF2KrZiNmC2YEg2LTZiCDZiCDahtuM2LLbjCDYp9i22KfZgdmHINmG2YbZiNuM2LMuDQotINin2q/YsSDYp9i32YTYp9i52KfYqiDaqdin2YHbjCDYr9ixINmF2YbYp9io2Lkg2YbbjNiz2KrYjCDZgdmC2Lcg24zaqSDYrNmF2YTZhyDYqNmG2YjbjNizINmIINiq2YXYp9mFINqp2YYuDQo="
$ps=@(Get-ChildItem $InstallDir -Recurse -Filter system-prompt.txt -EA SilentlyContinue|Select-Object -Expand FullName)
if($ps.Count -eq 0){Y "system-prompt.txt not found"}
else{$n=0
  foreach($p in $ps){$n++
    $d=Join-Path $bk "prm.$n"
    if(-not (Test-Path $d)){Copy-Item $p $d -Force; Add-Content (Join-Path $bk "prm.txt") "$n|$p"}
    $t=Get-Content $p -Raw -Encoding UTF8
    $r=$p.Substring($InstallDir.Length).TrimStart('\')
    if($t -notmatch [regex]::Escape($mk)){[IO.File]::WriteAllText($p,$t+$add,(New-Object Text.UTF8Encoding $false)); G "patched $r"}
    else{Y "already tightened: $r"}}}

Write-Host "`nDone. Start the app and ask the question again." -ForegroundColor Green
Write-Host "Undo:  .\fix.ps1 -Revert" -ForegroundColor DarkGray
