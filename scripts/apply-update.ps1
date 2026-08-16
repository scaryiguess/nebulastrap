param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$LogFile = '',
  [int]$WaitSeconds = 90,
  [switch]$NoRelaunch
)

$ErrorActionPreference = 'SilentlyContinue'

function Note ($text) {
  if (-not $LogFile) { return }
  $line = "{0} helper {1}  {2}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'), $PID, $text
  Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

Note "started, waiting for pid $ProcessId"

if (-not (Test-Path -LiteralPath $Source)) {
  Note "the staged file is not there: $Source"
  exit 1
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 400
}

if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
  Note "pid $ProcessId is still alive after $WaitSeconds seconds, giving up"
  exit 1
}

Note "pid $ProcessId is gone, swapping"
Start-Sleep -Milliseconds 800

$backup = "$Target.previous"
$copied = $false
$lastError = ''
for ($try = 0; $try -lt 60; $try++) {
  try {
    if (Test-Path -LiteralPath $Target) {
      Copy-Item -LiteralPath $Target -Destination $backup -Force -ErrorAction SilentlyContinue
    }
    Copy-Item -LiteralPath $Source -Destination $Target -Force -ErrorAction Stop
    $copied = $true
    Note "copied on attempt $($try + 1)"
    break
  } catch {
    $lastError = $_.Exception.Message
    Start-Sleep -Milliseconds 500
  }
}

if (-not $copied) {
  Note "could not write $Target after 60 tries: $lastError"
  if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $Target)) {
    Copy-Item -LiteralPath $backup -Destination $Target -Force -ErrorAction SilentlyContinue
    Note "put the old build back"
  }
  exit 1
}

Remove-Item -LiteralPath $Source -Force -ErrorAction SilentlyContinue

if (-not $NoRelaunch) {
  Note "relaunching $Target"
  Start-Process -FilePath $Target -ErrorAction SilentlyContinue
}

Note "done"
exit 0
