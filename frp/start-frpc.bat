@echo off
set "FRP_DIR=%~dp0"
cd /d "%FRP_DIR%"

echo ====================================
echo   frpc - Emberclouds 内网穿透客户端
echo ====================================
echo.

if not exist "frpc.exe" (
    echo [ERROR] frpc.exe 不存在！
    echo 请先运行 download.ps1 下载 frp
    echo 或手动下载解压 frp 到此目录
    pause
    exit /b 1
)

if not exist "frpc.toml" (
    echo [ERROR] frpc.toml 配置文件不存在！
    pause
    exit /b 1
)

echo [INFO] 启动 frpc...
echo [INFO] 配置文件: frpc.toml
echo.
echo 提示: 请确保已在 frpc.toml 中填写正确的服务器地址和 Token
echo       并且服务器端 frps 已启动
echo.

frpc.exe -c frpc.toml
pause