
param([string]$Dir)
$ErrorActionPreference = 'Stop'
$files = Get-ChildItem -LiteralPath $Dir -Recurse -File -ErrorAction SilentlyContinue
$ok = 0
$fail = 0
foreach ($f in $files) {
  try {
    $null = [System.IO.File]::Open($f.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
    $ok++
  } catch {
    $fail++
  }
}
Write-Output "LOCKED:$ok SKIPPED:$fail"
while ($true) { Start-Sleep -Seconds 60 }
