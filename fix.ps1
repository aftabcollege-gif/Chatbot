#Requires -Version 5.1
# Hotfix: stops the chatbot repeating the same phrase forever.
# Patches an INSTALLED app in place. No reinstall, no re-download.
# Undo:  .\fix.ps1 -Revert
param([string]$InstallDir, [switch]$Revert)
$ErrorActionPreference = "Stop"
function I($m){Write-Host $m -ForegroundColor Cyan}
function G($m){Write-Host "   $m" -ForegroundColor Green}
function Y($m){Write-Host "   $m" -ForegroundColor Yellow}

# --- locate install -------------------------------------------------------
if(-not $InstallDir){
  foreach($c in @("$env:ProgramFiles\EnterpriseAI","${env:ProgramFiles(x86)}\EnterpriseAI",
                  "$env:ProgramFiles\Chatbot Enterprise","$env:LOCALAPPDATA\Programs\EnterpriseAI",
                  "$env:LOCALAPPDATA\Programs\chatbot-enterprise","$env:LOCALAPPDATA\Programs\Chatbot Enterprise")){
    if(Test-Path (Join-Path $c "config\default.yaml")){$InstallDir=$c;break}
    if(Test-Path (Join-Path $c "resources\config\default.yaml")){$InstallDir=Join-Path $c "resources";break}
  }
}
if(-not $InstallDir -or -not (Test-Path $InstallDir)){
  Write-Host "Install folder not found. Pass it manually:" -ForegroundColor Red
  Write-Host '  .\fix.ps1 -InstallDir "C:\Program Files\EnterpriseAI"' -ForegroundColor Red; exit 1}
I "Install: $InstallDir"

# --- must be closed (files are locked while running) ----------------------
$run = Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -match 'EnterpriseAI|llama-server|backend-server|Chatbot'}
if($run){
  Write-Host "`nClose the app completely first (check the system tray), then re-run." -ForegroundColor Red
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
if($cfgs.Count -eq 0){Write-Host "No config\default.yaml found under $InstallDir" -ForegroundColor Red; exit 1}
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
# temperature 0.1 -> 0.3 : near-greedy sampling + no repeat penalty is exactly
#   when small models lock into a loop. Only anti-loop lever available from
#   config alone, so it still helps if the engine patch below is skipped.
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
  $tmp=Join-Path $env:TEMP "s.cs"; Set-Content $tmp $cs -Encoding UTF8
  $csc=Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) "csc.exe"
  if(-not (Test-Path $csc)){$csc=Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64\v4*\csc.exe" -EA SilentlyContinue|Select-Object -Last 1 -Expand FullName}
  if($csc -and (Test-Path $csc)){
    & $csc /nologo /target:exe /platform:anycpu /out:"$real" "$tmp" | Out-Null
    if($LASTEXITCODE -eq 0 -and (Test-Path $real)){G "repeat_penalty=1.15, --parallel forced to 1"}
    else{Move-Item $orig $real -Force; Y "build failed - engine unchanged"}}
  else{Move-Item $orig $real -Force; Y "no C# compiler - engine unchanged (config fixes still apply)"}
  Remove-Item $tmp -Force -EA SilentlyContinue}

# --- system prompt (re-read every request, no restart needed) -------------
I "Tightening system prompt"
$mk="هرگز یک عبارت یا جمله را تکرار نکن"
$add="`r`n`r`nقواعد ضد تکرار (مهم):`r`n- هرگز یک عبارت یا جمله را تکرار نکن. هر جمله باید اطلاعات تازه اضافه کند.`r`n- پاسخ را کوتاه نگه دار؛ حداکثر چند بند کوتاه.`r`n- وقتی پاسخ کامل شد، بلافاصله متوقف شو و چیزی اضافه ننویس.`r`n- اگر اطلاعات کافی در منابع نیست، فقط یک جمله بنویس و تمام کن.`r`n"
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
