# Bootstrap for download-models-impl.ps1.
# Kept intentionally tiny so it can never fail to parse: any parse error,
# runtime error or missing-file error from the implementation script is caught
# here and reported through two channels:
#   1. the `::error::` workflow command -> creates a run annotation (readable
#      via the public API even when the full logs are login-gated)
#   2. the GitHub Actions Step Summary file (rendered on the summary page)
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

function _Annotation_Error($Text) {
    # Collapse to one line (workflow commands cannot contain raw newlines).
    $one = ($Text -replace "\r?\n", " | ")
    if ($one.Length -gt 900) { $one = $one.Substring(0, 900) }
    Write-Host "::error::download-models: $one"
}

try {
    if (-not (Test-Path -LiteralPath "$PSScriptRoot\download-models-impl.ps1")) {
        throw "download-models-impl.ps1 not found next to download-models.ps1"
    }
    . "$PSScriptRoot\download-models-impl.ps1"
} catch {
    _Annotation_Error $_.Exception.ToString()
    _Summary_Write @(
        "## download-models.ps1 FAILED",
        "",
        "``````text",
        $_.Exception.ToString(),
        "``````"
    )
    throw
}
