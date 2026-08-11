# LanTransfer - 局域网文件传输工具
# 编码修复
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerDir = Join-Path $ScriptDir "server"
$NodeExe = "C:\Users\Ember\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node\node.exe"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LanTransfer - LAN File Transfer" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Server  : http://localhost:3000"
Write-Host "  Storage : $env:USERPROFILE\LanTransfer"
Write-Host ""

# Get local IP addresses
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -ExpandProperty IPAddress
if ($ips) {
    Write-Host "  LAN IPs:"
    foreach ($ip in $ips) {
        Write-Host "    http://${ip}:3000"
    }
    Write-Host ""
    Write-Host "  Other devices can open the above URLs in browser"
} else {
    Write-Host "  No LAN IP detected, check manually"
}
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $ServerDir
& $NodeExe "src/index.js"
pause