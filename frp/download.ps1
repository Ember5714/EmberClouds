# frp 下载脚本 - 多镜像自动尝试
# 用法: 右键此文件 -> 使用 PowerShell 运行
#       或在 PowerShell 中执行: .\download.ps1

$ErrorActionPreference = 'Stop'
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipFile = Join-Path $outDir 'frp.zip'
$extractDir = $outDir

# 多镜像源（按优先级）
$mirrors = @(
    'https://gh.con.sh/https://github.com/fatedier/frp/releases/download/v0.70.0/frp_0.70.0_windows_amd64.zip',
    'https://ghproxy.net/https://github.com/fatedier/frp/releases/download/v0.70.0/frp_0.70.0_windows_amd64.zip',
    'https://github.com/fatedier/frp/releases/download/v0.70.0/frp_0.70.0_windows_amd64.zip'
)

Write-Host "=== frp 下载器 ===" -ForegroundColor Cyan
Write-Host "目标目录: $outDir`n"

foreach ($mirror in $mirrors) {
    Write-Host "尝试: $($mirror.Substring(0, [Math]::Min(60, $mirror.Length)))..." -ForegroundColor Yellow
    try {
        if (Test-Path $zipFile) { Remove-Item $zipFile -Force }
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($mirror, $zipFile)
        $wc.Dispose()

        $size = (Get-Item $zipFile).Length
        if ($size -lt 1000000) {
            Write-Host "  文件太小 ($size bytes)，可能损坏，换下一个镜像" -ForegroundColor Red
            continue
        }

        Write-Host "  下载成功 ($([Math]::Round($size/1MB, 1)) MB)" -ForegroundColor Green

        # 解压
        Write-Host "正在解压..." -ForegroundColor Yellow
        Expand-Archive -Path $zipFile -DestinationPath $extractDir -Force

        # 移动文件到 frp 目录
        $subDir = Get-ChildItem $extractDir -Directory | Where-Object { $_.Name -like 'frp_*' } | Select-Object -First 1
        if ($subDir) {
            Get-ChildItem $subDir.FullName | ForEach-Object {
                $dest = Join-Path $extractDir $_.Name
                if (Test-Path $dest) { Remove-Item $dest -Force -Recurse -ErrorAction SilentlyContinue }
                Move-Item $_.FullName $dest -Force
            }
            Remove-Item $subDir.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }

        Remove-Item $zipFile -Force -ErrorAction SilentlyContinue
        Write-Host "`n=== frp 下载安装完成! ===" -ForegroundColor Green
        Get-ChildItem $extractDir -File | Select-Object Name, Length | Format-Table -AutoSize
        Write-Host "`n下一步: 编辑 frpc.toml，填写你的服务器信息，然后运行 start-frpc.bat" -ForegroundColor Cyan
        exit 0
    }
    catch {
        Write-Host "  失败: $_" -ForegroundColor Red
        Write-Host "  换下一个镜像...`n"
    }
}

Write-Host "`n所有镜像均下载失败，请手动下载:" -ForegroundColor Red
Write-Host "  1. 打开 https://github.com/fatedier/frp/releases/latest"
Write-Host "  2. 下载 frp_0.xx.x_windows_amd64.zip"
Write-Host "  3. 解压到: $outDir"
pause