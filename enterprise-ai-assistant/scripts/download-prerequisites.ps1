# Bootstrap for download-prerequisites-impl.ps1.
# Same pattern as download-models.ps1: tiny wrapper that surfaces any parse or
# runtime failure of the implementation script in the Step Summary.
$ErrorActionPreference = "Stop"

function _Summary_Write($Lines) {
    Write-Host ($Lines -join "`n")
    if (-not $env:GITHUB_STEP_SUMMARY) { return }
    try {
        Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $Lines -Encoding UTF8
    } catch {
        Write-Host "step-summary write failed: $($_.Exception.Message)"
    }
}

try {
    if (-not (Test-Path -LiteralPath "$PSScriptRoot\download-prerequisites-impl.ps1")) {
        throw "download-prerequisites-impl.ps1 not found next to download-prerequisites.ps1"
    }
    . "$PSScriptRoot\download-prerequisites-impl.ps1"
} catch {
    _Summary_Write @(
        "## download-prerequisites.ps1 FAILED",
        "",
        "``````text",
        $_.Exception.ToString(),
        "``````"
    )
    throw
}
