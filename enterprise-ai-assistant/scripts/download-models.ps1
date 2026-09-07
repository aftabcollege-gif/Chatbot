# Bootstrap for download-models-impl.ps1.
# Kept intentionally tiny so it can never fail to parse: any parse error,
# runtime error or missing-file error from the implementation script is caught
# here and mirrored into the GitHub Actions Step Summary (which is publicly
# readable, unlike the full logs) before re-throwing.
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
    if (-not (Test-Path -LiteralPath "$PSScriptRoot\download-models-impl.ps1")) {
        throw "download-models-impl.ps1 not found next to download-models.ps1"
    }
    . "$PSScriptRoot\download-models-impl.ps1"
} catch {
    _Summary_Write @(
        "## download-models.ps1 FAILED",
        "",
        "``````text",
        $_.Exception.ToString(),
        "``````"
    )
    throw
}
