param([string]$Dir)
$files = Get-ChildItem -LiteralPath $Dir -Recurse -File -ErrorAction SilentlyContinue
$count = 0
foreach ($f in $files) {
  try {
    $null = [System.IO.File]::Open($f.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
    $count++
  } catch {
    Write-Output "ERR: $($f.FullName) - $_"
  }
}
Write-Output "LOCKED:$count"