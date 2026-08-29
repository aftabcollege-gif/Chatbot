# Downloads the Windows prerequisites bundled into the installer's prerequisites/ folder.
#
# IMPORTANT — offline requirement:
#   The target machines have NO internet and cannot install auxiliary software.
#   So every prerequisite must be a *self-contained, offline* installer that is
#   shipped inside setup.exe and run /silent during installation.
#
#   * Visual C++ Redistributable (vc_redist.x64.exe) is a full offline installer.
#     It is REQUIRED (the PyInstaller backend needs the VC++ 2015-2022 runtime).
#   * WebView2 is only needed by the Tauri/Inno shell, NOT by Electron (Electron
#     bundles its own Chromium). For Tauri we fetch the Evergreen *Standalone*
#     offline installer, never the online bootstrapper (LinkId=2124703), which
#     would download from the internet during install and is therefore unusable
#     on an offline machine.
#
# Run once on a connected Windows build machine. At install time nothing is
# downloaded — everything runs from the bundled files.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path "$Root\prerequisites" | Out-Null

function Download($url, $dest) {
    if (Test-Path $dest) { Write-Host "  exists: $dest"; return }
    Write-Host "  downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

# --- REQUIRED: Visual C++ Redistributable (offline installer) ---
Download "https://aka.ms/vs/17/release/vc_redist.x64.exe" "$Root\prerequisites\vc_redist.x64.exe"

# --- OPTIONAL (Tauri/Inno shell only): WebView2 Evergreen Standalone (offline) ---
# Note: there is no permanent evergreen direct link for the standalone installer,
# so we probe the known stable CDN file name. If unavailable we only warn —
# Electron does not need WebView2, and the docs explain how to obtain the
# standalone installer from the official download page for the Tauri build.
$webview2 = "$Root\prerequisites\MicrosoftEdgeWebView2Setup.exe"
if (-not (Test-Path $webview2)) {
    $candidates = @(
        # Recent stable Evergreen Standalone x64 (delivery CDN). Version may age;
        # this is best-effort. See https://aka.ms/webview2 for the official link.
        "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/d602b474-c305-455f-86f3-49b09505ab2a/MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
    )
    $ok = $false
    foreach ($u in $candidates) {
        try {
            Write-Host "  trying WebView2 standalone: $u"
            Invoke-WebRequest -Uri $u -OutFile $webview2 -UseBasicParsing -ErrorAction Stop
            $ok = $true
            break
        } catch {
            Write-Warning "  WebView2 standalone download failed: $($_.Exception.Message)"
        }
    }
    if (-not $ok) {
        Write-Warning "WebView2 standalone installer not downloaded."
        Write-Warning "The Electron setup.exe does NOT need WebView2 (it bundles Chromium)."
        Write-Warning "Only the optional Tauri/Inno build needs it; obtain 'Evergreen Standalone Installer x64' from https://developer.microsoft.com/microsoft-edge/webview2/ and place it at $webview2"
    }
}

Write-Host "Prerequisites ready." -ForegroundColor Green
