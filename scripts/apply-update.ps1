param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$Source,
  [int]$WaitSeconds = 90,
  [switch]$NoRelaunch
)

$ErrorActionPreference = 'SilentlyContinue'

if (-not (Test-Path -LiteralPath $Source)) { exit 1 }

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 400
}

Start-Sleep -Milliseconds 800

$backup = "$Target.previous"
$copied = $false
for ($try = 0; $try -lt 60; $try++) {
  try {
    if (Test-Path -LiteralPath $Target) {
      Copy-Item -LiteralPath $Target -Destination $backup -Force -ErrorAction SilentlyContinue
    }
    Copy-Item -LiteralPath $Source -Destination $Target -Force -ErrorAction Stop
    $copied = $true
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $copied) {
  if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $Target)) {
    Copy-Item -LiteralPath $backup -Destination $Target -Force -ErrorAction SilentlyContinue
  }
  exit 1
}

Remove-Item -LiteralPath $Source -Force -ErrorAction SilentlyContinue

if (-not $NoRelaunch) {
  Start-Process -FilePath $Target -ErrorAction SilentlyContinue
}

exit 0
