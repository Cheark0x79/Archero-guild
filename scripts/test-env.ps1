param(
    [ValidateSet('start', 'test', 'status', 'logs', 'stop', 'reset')]
    [string]$Action = 'status',
    [switch]$Force,
    [string]$Distribution = 'Ubuntu'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scriptPath = Join-Path $projectRoot 'scripts\test-env.sh'

if (Get-Command docker -ErrorAction SilentlyContinue) {
    $arguments = @($scriptPath, $Action)
    if ($Force) { $arguments += '--force' }
    & bash @arguments
    exit $LASTEXITCODE
}

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw 'Docker is unavailable and WSL is not installed.'
}

$arguments = @('-d', $Distribution, '--cd', $projectRoot, '--', 'bash', 'scripts/test-env.sh', $Action)
if ($Force) { $arguments += '--force' }
& wsl.exe @arguments
exit $LASTEXITCODE
