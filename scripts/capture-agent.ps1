[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$AdbPath = $env:ARCHERO_BLUESTACKS_ADB,
    [string]$DefaultSerial = $env:ARCHERO_BLUESTACKS_SERIAL,
    [int]$PollMilliseconds = 200
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $AdbPath) {
    $AdbPath = Join-Path $env:ProgramFiles 'BlueStacks_nxt\HD-Adb.exe'
}
if (-not $DefaultSerial) {
    $DefaultSerial = '127.0.0.1:5555'
}

$resolvedProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
$projectPrefix = $resolvedProjectRoot + '\'
$bridgeRoot = Join-Path $resolvedProjectRoot 'data\capture-bridge'
$requestsDir = Join-Path $bridgeRoot 'requests'
$responsesDir = Join-Path $bridgeRoot 'responses'
$statusPath = Join-Path $bridgeRoot 'status.json'
$allowedDestination = '^screenshots/(raw/\d{4}-\d{2}-\d{2}/(guild/members|boss/(boss|monster-invasion))-\d{3}|quarantine/bridge-probe-[a-f0-9]{32})\.png$'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $AdbPath -PathType Leaf)) {
    throw "BlueStacks ADB was not found at $AdbPath"
}
New-Item -ItemType Directory -Path $requestsDir, $responsesDir -Force | Out-Null

function Write-JsonAtomic {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    [System.IO.File]::WriteAllText(
        $temporary,
        (($Value | ConvertTo-Json -Depth 8 -Compress) + [Environment]::NewLine),
        $utf8NoBom
    )
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Test-AdbConnection {
    param([string]$Serial)

    if ($Serial -notmatch '^[a-zA-Z0-9._:-]+$') {
        return $false
    }
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $AdbPath connect $Serial *> $null
        $state = & $AdbPath -s $Serial get-state 2>&1
        return $LASTEXITCODE -eq 0 -and ($state -join '').Trim() -eq 'device'
    }
    catch {
        return $false
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
}

function Write-AgentStatus {
    param(
        [bool]$Connected,
        [string]$Serial,
        [string]$ErrorMessage
    )

    [object[]]$devices = if ($Connected) {
        ,@{ serial = $Serial; state = 'device' }
    } else { @() }
    Write-JsonAtomic -Path $statusPath -Value @{
        connected = $Connected
        devices = $devices
        error = if ($ErrorMessage) { $ErrorMessage } else { $null }
        updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    }
}

function Resolve-CaptureDestination {
    param(
        [string]$RelativePath,
        [string]$Kind
    )

    $normalized = $RelativePath.Replace('\', '/')
    if ($normalized -notmatch $allowedDestination) {
        throw 'capture destination does not match the project screenshot layout'
    }
    $expectedSegment = switch ($Kind) {
        'bridge-probe' { 'screenshots/quarantine/bridge-probe-' }
        'guild-members' { '/guild/members-' }
        'guild-boss' { '/boss/boss-' }
        'monster-invasion' { '/boss/monster-invasion-' }
        default { throw 'unsupported capture kind' }
    }
    if (-not $normalized.Contains($expectedSegment)) {
        throw 'capture kind does not match its destination'
    }

    $destination = [System.IO.Path]::GetFullPath(
        (Join-Path $resolvedProjectRoot $normalized.Replace('/', '\'))
    )
    if (-not $destination.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'capture destination must stay inside the project'
    }
    return $destination
}

function Save-AdbScreenshot {
    param(
        [string]$Serial,
        [string]$Destination,
        [string]$RequestId
    )

    if (-not (Test-AdbConnection -Serial $Serial)) {
        throw "BlueStacks ADB device $Serial is not connected"
    }
    if (Test-Path -LiteralPath $Destination) {
        throw 'capture destination already exists'
    }

    $directory = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = Join-Path $directory ".$([System.IO.Path]::GetFileName($Destination)).$RequestId.tmp"

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $AdbPath
    $startInfo.Arguments = "-s $Serial exec-out screencap -p"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo

    try {
        [void]$process.Start()
        $stream = [System.IO.File]::Open(
            $temporary,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        try {
            $process.StandardOutput.BaseStream.CopyTo($stream)
        }
        finally {
            $stream.Dispose()
        }
        $standardError = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            throw "ADB screencap failed: $standardError"
        }

        $bytes = [System.IO.File]::ReadAllBytes($temporary)
        $signature = [byte[]](0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        if ($bytes.Length -lt $signature.Length) {
            throw 'ADB returned an empty screenshot'
        }
        for ($index = 0; $index -lt $signature.Length; $index++) {
            if ($bytes[$index] -ne $signature[$index]) {
                throw 'ADB returned an invalid PNG screenshot'
            }
        }
        [System.IO.File]::Move($temporary, $Destination)
    }
    finally {
        if (Test-Path -LiteralPath $temporary -PathType Leaf) {
            Remove-Item -LiteralPath $temporary -Force
        }
        $process.Dispose()
    }
}

function Process-CaptureRequest {
    param([System.IO.FileInfo]$RequestFile)

    $requestId = $RequestFile.BaseName
    $responsePath = Join-Path $responsesDir "$requestId.json"
    if (Test-Path -LiteralPath $responsePath -PathType Leaf) {
        return
    }
    try {
        if ($requestId -notmatch '^[a-f0-9]{32}$') {
            throw 'invalid capture request id'
        }
        $request = Get-Content -Raw -LiteralPath $RequestFile.FullName | ConvertFrom-Json
        if ($request.version -ne 1 -or $request.id -ne $requestId) {
            throw 'invalid capture request'
        }
        $serial = if ($request.serial) { [string]$request.serial } else { $DefaultSerial }
        if ($serial -notmatch '^[a-zA-Z0-9._:-]+$') {
            throw 'invalid ADB serial'
        }
        $destination = Resolve-CaptureDestination `
            -RelativePath ([string]$request.output_path) `
            -Kind ([string]$request.kind)
        Save-AdbScreenshot -Serial $serial -Destination $destination -RequestId $requestId
        Write-JsonAtomic -Path $responsePath -Value @{
            id = $requestId
            ok = $true
            serial = $serial
        }
    }
    catch {
        Write-JsonAtomic -Path $responsePath -Value @{
            id = $requestId
            ok = $false
            error = $_.Exception.Message
        }
    }
}

$lastStatusCheck = [DateTimeOffset]::MinValue
while ($true) {
    $now = [DateTimeOffset]::UtcNow
    if (($now - $lastStatusCheck).TotalSeconds -ge 3) {
        try {
            $connected = Test-AdbConnection -Serial $DefaultSerial
        }
        catch {
            $connected = $false
        }
        Write-AgentStatus `
            -Connected $connected `
            -Serial $DefaultSerial `
            -ErrorMessage $(if ($connected) { '' } else { 'BlueStacks ADB is not connected' })
        $lastStatusCheck = $now
    }

    Get-ChildItem -LiteralPath $requestsDir -Filter '*.json' -File |
        Sort-Object CreationTimeUtc |
        ForEach-Object { Process-CaptureRequest -RequestFile $_ }
    Start-Sleep -Milliseconds $PollMilliseconds
}
