param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("start", "stop", "status", "logs")]
    [string]$Action
)

$ErrorActionPreference = "Stop"
$repository = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$portableRepository = $repository.Replace("\", "/")
$linuxRepository = (& wsl.exe -d Ubuntu -- wslpath -a $portableRepository).Trim()
if (-not $linuxRepository) {
    throw "Unable to resolve the repository path inside WSL."
}
if ($linuxRepository.Contains("'")) {
    throw "Repository paths containing a single quote are not supported."
}
$quotedRepository = "'$linuxRepository'"
$base = "cd $quotedRepository && docker compose --env-file ocr/.env -f ocr/compose.yml"
$command = switch ($Action) {
    "start" { "$base up -d --build --wait ui" }
    "stop" { "$base down" }
    "status" { "$base ps" }
    "logs" { "$base logs --tail=100 ui" }
}

& wsl.exe -d Ubuntu -- bash -lc $command
if ($LASTEXITCODE -ne 0) {
    throw "OCR $Action failed with exit code $LASTEXITCODE."
}

if ($Action -eq "start") {
    Write-Host "OCR console is ready at http://127.0.0.1:5190"
}
