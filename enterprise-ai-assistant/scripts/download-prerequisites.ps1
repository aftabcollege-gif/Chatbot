# Bootstrap for download-prerequisites-impl.ps1.
# Same pattern as download-models.ps1: tiny parse-safe wrapper that reports
# failures via a `::error::` annotation and the Step Summary.
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
    $one = ($Text -replace "\r?\n", " | ")
    if ($one.Length -gt 900) { $one = $one.Substring(0, 900) }
    Write-Host "::error::download-prerequisites: $one"
}

try {
    if (-not (Test-Path -LiteralPath "$PSScriptRoot\download-prerequisites-impl.ps1")) {
        throw "download-prerequisites-impl.ps1 not found next to download-prerequisites.ps1"
    }
    . "$PSScriptRoot\download-prerequisites-impl.ps1"
} catch {
    _Annotation_Error $_.Exception.ToString()
    _Summary_Write @(
        "## download-prerequisites.ps1 FAILED",
        "",
        "``````text",
        $_.Exception.ToString(),
        "``````"
    )
    throw
}
