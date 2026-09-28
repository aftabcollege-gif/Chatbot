# Downloads the Windows prerequisites bundled into the installer's prerequisites/ folder.
$ErrorActionPreference = "Stop"
# PS 5.1: the progress bar makes Invoke-WebRequest dramatically slower.
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $PSScriptRoot

try {
    New-Item -ItemType Directory -Force -Path "$Root\prerequisites" | Out-Null

    # vc_redist.x64.exe from aka.ms is already the FULL offline installer.
    # WebView2 (needed by the Tauri/Inno shell only - Electron bundles Chromium)
    # must also be the offline standalone runtime: the evergreen *bootstrapper*
    # (LinkId=2124703) downloads from the internet during setup, which fails on
    # the target machines.  The standalone runtime is tried from several
    # official mirrors; if all of them are unavailable the installer still
    # builds and simply relies on a WebView2 runtime that may already exist.
    $vc = Join-Path "$Root\prerequisites" "vc_redist.x64.exe"
    if (Test-Path $vc) { Write-Host "exists: vc_redist.x64.exe" } else {
        Write-Host "downloading vc_redist.x64.exe..."
        Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vc_redist.x64.exe" -OutFile $vc -UseBasicParsing
        if ((Get-Item $vc).Length -lt 1MB) { throw "vc_redist.x64.exe download looks truncated" }
    }

    $webview2 = Join-Path "$Root\prerequisites" "MicrosoftEdgeWebView2Setup.exe"
    if (Test-Path $webview2) {
        Write-Host "exists: MicrosoftEdgeWebView2Setup.exe"
    } else {
        $mirrors = @(
            "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/d602b474-c305-455f-86f3-49b09505ab2a/MicrosoftEdgeWebView2RuntimeInstallerX64.exe",
            "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/0c1a6b30-36b0-4f6e-a2cb-6adf31c79a0e/MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
        )
        $got = $false
        foreach ($u in $mirrors) {
            try {
                Write-Host "  trying WebView2 standalone: $u"
                Invoke-WebRequest -Uri $u -OutFile $webview2 -UseBasicParsing -ErrorAction Stop
                if ((Get-Item $webview2).Length -gt 20MB) { $got = $true; break }
            } catch {
                Write-Warning "  WebView2 standalone download failed: $($_.Exception.Message)"
            }
        }
        if (-not $got) {
            if (Test-Path $webview2) { Remove-Item $webview2 -Force -ErrorAction SilentlyContinue }
            Write-Warning "WebView2 standalone runtime could not be downloaded; the Tauri shell will use the runtime already present on the machine."
        }
    }

    # Verify the models step actually succeeded. In the CI workflows this script
    # runs last, so throwing here fails the step (otherwise a failed model
    # download would be silently masked by this script's exit code).
    if (-not (Test-Path "$Root\.models-download-ok")) {
        throw "Model download did not complete (missing .models-download-ok). Run scripts\download-models.ps1 and check its output."
    }

    Write-Host "Prerequisites ready." -ForegroundColor Green
} catch {
    if ($env:GITHUB_STEP_SUMMARY) {
        $lines = @(
            "## download-prerequisites.ps1 failed",
            "",
            "``````text",
            $_.Exception.ToString(),
            "``````"
        )
        try { Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $lines -Encoding UTF8 } catch { }
    }
    throw
}
