# Run on a Windows x64 build machine after the portable application was assembled.
# Output: Chatbot-Organizational-Offline-Setup.exe
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $PSScriptRoot 'release\app'
Remove-Item (Join-Path $PSScriptRoot 'release') -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# These files make the installed product self-contained: Node runtime,
# production build, dependencies, local PGlite database schema, and models.
$items = @('.next', 'node_modules', 'models', 'drizzle', 'portable_bild', 'package.json', '.env.template')
foreach ($item in $items) {
  $source = Join-Path $root $item
  if (!(Test-Path $source)) { throw "Required portable asset is missing: $source" }
  Copy-Item -Recurse -Force $source $stage
}
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'storage') | Out-Null

$makensis = Get-Command makensis.exe -ErrorAction SilentlyContinue
if (!$makensis) { throw 'NSIS 3.x is required on the build machine (makensis.exe was not found).' }
Push-Location $PSScriptRoot
& $makensis.Source installer.nsi
Pop-Location
