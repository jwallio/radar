[CmdletBinding()]
param(
    [switch]$Full
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $npm = Get-Command npm -ErrorAction Stop
    & $npm.Source run typecheck
    if ($LASTEXITCODE -ne 0) { throw "Frontend typecheck failed with exit code $LASTEXITCODE." }

    $python = Get-Command python -ErrorAction Stop
    & $python.Source -m pytest tests -q
    if ($LASTEXITCODE -ne 0) { throw "Python tests failed with exit code $LASTEXITCODE." }

    if ($Full) {
        & $npm.Source run build
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE." }
        & $npm.Source --prefix control_worker run types:check
        if ($LASTEXITCODE -ne 0) { throw "Control-worker generated-type check failed with exit code $LASTEXITCODE." }
        & $npm.Source --prefix control_worker run typecheck
        if ($LASTEXITCODE -ne 0) { throw "Control-worker typecheck failed with exit code $LASTEXITCODE." }
    }
} finally {
    Pop-Location
}
