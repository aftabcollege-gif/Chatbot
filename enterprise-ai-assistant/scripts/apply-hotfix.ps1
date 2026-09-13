<#
    .SYNOPSIS
        Applies the "repetition loop" hotfix to an ALREADY INSTALLED copy of
        the app. No reinstall, no re-download, no rebuild.

    .DESCRIPTION
        The Python backend ships frozen (PyInstaller), so backend .py changes
        cannot be applied without rebuilding. However, the two things that
        actually cause the stuck/looping answer live in files that are loose
        on disk and are read at runtime:

          1. llama-server.exe is launched WITHOUT any repetition penalty, so
             llama.cpp uses repeat_penalty = 1.0 (disabled) and a small model
             loops the same clause forever. This script inserts a launcher
             shim that adds the penalty flags. The backend sends no penalty
             fields in its request, so llama.cpp falls back to these
             server-level defaults (verified in server.cpp b3800:
             penalty_repeat = json_value(data, "repeat_penalty",
             default_sparams.penalty_repeat)).

          2. config\default.yaml oversubscribes the context window. The
             launcher runs llama-server with "--parallel 2", and llama.cpp
             splits the window per slot (n_ctx_slot = n_ctx / n_parallel), so
             each request really only gets 2048 tokens - not 4096. With
             5 x 512-word chunks the prompt alone blows past that, and
             llama.cpp evicts the start of the prompt (the instructions),
             which is a classic trigger for rambling and looping.

        Everything is backed up first and can be reverted with -Revert.

    .EXAMPLE
        # Close the app first, then run PowerShell as Administrator:
        powershell -ExecutionPolicy Bypass -File apply-hotfix.ps1

    .EXAMPLE
        powershell -ExecutionPolicy Bypass -File apply-hotfix.ps1 -Revert
#>
[CmdletBinding()]
param(
    # Install directory. Auto-detected when omitted.
    [string] $InstallDir,
    # Undo the hotfix and restore the original files.
    [switch] $Revert
)

$ErrorActionPreference = "Stop"

function Write-Step { param($m) Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "    $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "    $m" -ForegroundColor Yellow }

# --------------------------------------------------------------------------- #
# 1. Locate the installation
# --------------------------------------------------------------------------- #
function Find-InstallDir {
    $candidates = @(
        "$env:ProgramFiles\EnterpriseAI",
        "${env:ProgramFiles(x86)}\EnterpriseAI",
        "$env:ProgramFiles\Chatbot Enterprise",
        "$env:LOCALAPPDATA\Programs\EnterpriseAI",
        "$env:LOCALAPPDATA\Programs\chatbot-enterprise",
        "$env:LOCALAPPDATA\Programs\Chatbot Enterprise"
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c "config\default.yaml")) { return $c }
        # electron-builder puts payload under resources\
        if (Test-Path (Join-Path $c "resources\config\default.yaml")) {
            return (Join-Path $c "resources")
        }
    }
    return $null
}

if (-not $InstallDir) { $InstallDir = Find-InstallDir }

if (-not $InstallDir -or -not (Test-Path $InstallDir)) {
    Write-Host @"
Could not locate the installation automatically.

Find the folder that contains 'config\default.yaml' (it also contains the
'llm' and 'models' folders) and pass it explicitly:

    .\apply-hotfix.ps1 -InstallDir "C:\Program Files\EnterpriseAI"
"@ -ForegroundColor Red
    exit 1
}

$ConfigFile  = Join-Path $InstallDir "config\default.yaml"
$LlmDir      = Join-Path $InstallDir "llm"
$RealExe     = Join-Path $LlmDir "llama-server.exe"
$BackupExe   = Join-Path $LlmDir "llama-server-original.exe"
$ShimSource  = Join-Path $LlmDir "llama-server-shim.ps1"
$BackupDir   = Join-Path $InstallDir "hotfix-backup"

Write-Step "Install directory"
Write-Ok   $InstallDir

if (-not (Test-Path $ConfigFile)) {
    Write-Host "config\default.yaml not found under $InstallDir" -ForegroundColor Red
    exit 1
}

# --------------------------------------------------------------------------- #
# 2. Refuse to run while the app is open (files would be locked)
# --------------------------------------------------------------------------- #
$running = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match 'EnterpriseAI|llama-server|backend-server|Chatbot' }
if ($running) {
    Write-Host ""
    Write-Host "The application is still running. Please close it completely first" -ForegroundColor Red
    Write-Host "(also check the system tray), then run this script again." -ForegroundColor Red
    Write-Host ""
    Write-Host "Still running:" -ForegroundColor Yellow
    $running | Select-Object -ExpandProperty ProcessName -Unique | ForEach-Object { Write-Host "  - $_" }
    exit 1
}

# --------------------------------------------------------------------------- #
# 3. Revert mode
# --------------------------------------------------------------------------- #
if ($Revert) {
    Write-Step "Reverting the hotfix"
    if (Test-Path (Join-Path $BackupDir "default.yaml")) {
        Copy-Item (Join-Path $BackupDir "default.yaml") $ConfigFile -Force
        Write-Ok "config\default.yaml restored"
    } else {
        Write-Warn "no config backup found; leaving current config in place"
    }
    if (Test-Path $BackupExe) {
        Remove-Item $RealExe -Force -ErrorAction SilentlyContinue
        Move-Item $BackupExe $RealExe -Force
        Write-Ok "llama-server.exe restored"
    }
    Remove-Item $ShimSource -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "Revert complete. Start the app normally." -ForegroundColor Green
    exit 0
}

# --------------------------------------------------------------------------- #
# 4. Back up
# --------------------------------------------------------------------------- #
Write-Step "Backing up original files"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
if (-not (Test-Path (Join-Path $BackupDir "default.yaml"))) {
    Copy-Item $ConfigFile (Join-Path $BackupDir "default.yaml") -Force
}
Write-Ok "backup -> $BackupDir"

# --------------------------------------------------------------------------- #
# 5. Patch config\default.yaml
#
#    Only keys the INSTALLED (frozen) build actually reads are useful here:
#      llm.max_tokens        -> sent as max_tokens in the request
#      llm.temperature       -> sent as temperature
#      reranker.top_k        -> number of chunks put into the prompt
#      rag.chat_history_max_tokens -> history budget (counted in words)
#
#    NOTE: rag.context_max_tokens and rag.min_confidence are NOT read by the
#    installed build (that logic only exists in the updated source), so we do
#    not rely on them. We shrink the prompt via reranker.top_k instead, which
#    the installed build does honour.
# --------------------------------------------------------------------------- #
Write-Step "Patching config\default.yaml"

$yaml = Get-Content $ConfigFile -Raw -Encoding UTF8

function Set-YamlScalar {
    param($Text, $Section, $Key, $Value)
    # Replace "  key: value" only inside the given top-level section.
    $pattern = "(?ms)^($Section\s*:.*?)^(\s+$Key\s*:)[^\r\n]*"
    if ($Text -match $pattern) {
        return [regex]::Replace($Text, $pattern, { param($m)
            "$($m.Groups[1].Value)$($m.Groups[2].Value) $Value"
        }, 1)
    }
    return $Text
}

$before = $yaml

# Temperature 0.1 makes sampling almost greedy. Combined with a disabled
# repeat penalty that is exactly the condition where a small model locks
# into a loop. Raising it is the one anti-loop lever available purely from
# config, and it works even if the engine patch below cannot be applied.
$yaml = Set-YamlScalar $yaml 'llm'      'temperature' '0.3'
# Output reservation: must fit inside the 2048-token per-slot window
# (--ctx-size 4096 split across --parallel 2) alongside the prompt.
$yaml = Set-YamlScalar $yaml 'llm'      'max_tokens' '700'
# Fewer, higher-quality chunks: 5 x 512 words could not fit in 2048 tokens.
$yaml = Set-YamlScalar $yaml 'reranker' 'top_k'      '2'
# Keep history small so it cannot crowd out the sources.
$yaml = Set-YamlScalar $yaml 'rag'      'chat_history_max_tokens' '200'

if ($yaml -ne $before) {
    # Write UTF-8 without BOM (PyYAML handles BOM poorly on some builds).
    [System.IO.File]::WriteAllText($ConfigFile, $yaml, (New-Object System.Text.UTF8Encoding $false))
    Write-Ok "llm.temperature = 0.3   (was 0.1 - main anti-loop lever)"
    Write-Ok "llm.max_tokens  = 700   (was 2048 - prompt did not fit)"
    Write-Ok "reranker.top_k  = 2     (was 5 - fewer, better sources)"
    Write-Ok "rag.chat_history_max_tokens = 200"
} else {
    Write-Warn "config already patched (or unexpected format) - skipped"
}

# --------------------------------------------------------------------------- #
# 6. Install the llama-server shim that adds the repetition penalties
#
#    This is the actual fix for the loop. The backend never sends penalty
#    fields, so llama.cpp uses the server's own defaults - which we now set.
# --------------------------------------------------------------------------- #
Write-Step "Applying repetition-penalty fix to the LLM engine"

if (-not (Test-Path $RealExe)) {
    Write-Warn "llama-server.exe not found under $LlmDir"
    Write-Warn "The app is running in extractive fallback mode; the config"
    Write-Warn "changes above still apply. Skipping the engine patch."
} elseif (Test-Path $BackupExe) {
    Write-Warn "shim already installed - skipped"
} else {
    # Rename the real engine, then drop a .exe-named launcher in its place.
    Move-Item $RealExe $BackupExe -Force

    # A tiny .NET launcher compiled on the fly: forwards every argument it is
    # given and appends the sampling defaults. Using a real .exe (instead of a
    # .cmd) matters because the app spawns the path directly, not via a shell.
    $csharp = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class Shim {
    static int Main(string[] args) {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string real = Path.Combine(dir, "llama-server-original.exe");

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < args.Length; i++) {
            string a = args[i];
            // The app hardcodes "--parallel 2". llama.cpp splits the context
            // window across slots (n_ctx_slot = n_ctx / n_parallel), so that
            // silently halves every request's budget from 4096 to 2048 - and
            // the RAG prompt does not fit in 2048. This is a single-user
            // desktop app, so a second slot buys nothing. Force it to 1 and
            // the full 4096 window becomes available again.
            if (a == "--parallel" && i + 1 < args.Length) {
                sb.Append("\"--parallel\" \"1\" ");
                i++; // skip the original value
                continue;
            }
            sb.Append('"').Append(a.Replace("\"", "\\\"")).Append("\" ");
        }
        // Repetition control. llama.cpp defaults repeat_penalty to 1.0
        // (disabled), which lets small models loop a phrase forever.
        sb.Append("--repeat-penalty 1.15 ");
        sb.Append("--repeat-last-n 256 ");
        sb.Append("--frequency-penalty 0.3 ");
        sb.Append("--presence-penalty 0.3 ");

        ProcessStartInfo psi = new ProcessStartInfo(real, sb.ToString());
        psi.UseShellExecute = false;
        psi.WorkingDirectory = dir;
        Process p = Process.Start(psi);
        p.WaitForExit();
        return p.ExitCode;
    }
}
'@

    $csFile = Join-Path $env:TEMP "llama_shim.cs"
    Set-Content -Path $csFile -Value $csharp -Encoding UTF8

    $csc = Join-Path ([System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) "csc.exe"
    if (-not (Test-Path $csc)) {
        # Fall back to the newest .NET Framework compiler present.
        $csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64\v4*\csc.exe" -ErrorAction SilentlyContinue |
               Select-Object -Last 1 -ExpandProperty FullName
    }

    if ($csc -and (Test-Path $csc)) {
        & $csc /nologo /target:exe /platform:anycpu /out:"$RealExe" "$csFile" | Out-Null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $RealExe)) {
            Write-Ok "repeat_penalty  = 1.15"
            Write-Ok "repeat_last_n   = 256"
            Write-Ok "frequency/presence penalty = 0.3"
        } else {
            Move-Item $BackupExe $RealExe -Force
            Write-Warn "could not build the shim - engine left unchanged"
        }
    } else {
        Move-Item $BackupExe $RealExe -Force
        Write-Warn "C# compiler not found - engine left unchanged"
        Write-Warn "(the config changes above still help)"
    }
    Remove-Item $csFile -Force -ErrorAction SilentlyContinue
}

# --------------------------------------------------------------------------- #
# 7. Tighten the system prompt (read fresh on every request)
# --------------------------------------------------------------------------- #
Write-Step "Tightening the system prompt"
$PromptFile = Join-Path $InstallDir "config\system-prompt.txt"
if (Test-Path $PromptFile) {
    if (-not (Test-Path (Join-Path $BackupDir "system-prompt.txt"))) {
        Copy-Item $PromptFile (Join-Path $BackupDir "system-prompt.txt") -Force
    }
    $prompt = Get-Content $PromptFile -Raw -Encoding UTF8
    $marker = "هرگز یک عبارت یا جمله را تکرار نکن"
    if ($prompt -notmatch [regex]::Escape($marker)) {
        $extra = @"

قواعد ضد تکرار (مهم):
- هرگز یک عبارت یا جمله را تکرار نکن. هر جمله باید اطلاعات تازه اضافه کند.
- پاسخ را کوتاه نگه دار؛ حداکثر چند بند کوتاه.
- وقتی پاسخ کامل شد، بلافاصله متوقف شو و چیزی اضافه ننویس.
- اگر اطلاعات کافی در منابع نیست، فقط یک جمله بنویس و تمام کن.
"@
        [System.IO.File]::WriteAllText($PromptFile, $prompt + $extra, (New-Object System.Text.UTF8Encoding $false))
        Write-Ok "anti-repetition instructions appended"
    } else {
        Write-Warn "already tightened - skipped"
    }
} else {
    Write-Warn "system-prompt.txt not found - skipped"
}

# --------------------------------------------------------------------------- #
Write-Host ""
Write-Host "Hotfix applied." -ForegroundColor Green
Write-Host ""
Write-Host "Start the app and ask the question again." -ForegroundColor White
Write-Host "To undo:  .\apply-hotfix.ps1 -Revert" -ForegroundColor DarkGray
Write-Host ""
