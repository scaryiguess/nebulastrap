$ErrorActionPreference = 'SilentlyContinue'

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'ROBLOX_singletonMutex', [ref]$created)

[Console]::Out.WriteLine('{"ev":"multi","holding":true,"fresh":' + $created.ToString().ToLower() + '}')
[Console]::Out.Flush()

try {
  while ($true) { Start-Sleep -Seconds 3600 }
} finally {
  if ($mutex) {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
  }
}
