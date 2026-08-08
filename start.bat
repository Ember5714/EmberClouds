@echo off
rem =============================================
rem   Emberclouds
rem   Author : Ember5714
rem   GitHub : https://github.com/Ember5714/Emberclouds
rem =============================================
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "SRV=%ROOT%\server"
set "CLI=%ROOT%\client"
set "RUNTIME=%ROOT%\runtime"
set "NODE_DIR=%RUNTIME%\node"

title Emberclouds - Setup

echo ========================================
echo   Emberclouds - Setup
echo ========================================
echo.

rem Detect Windows version and pick compatible Node.js
set "NODE_VERSION=20.18.1"
for /f "tokens=2 delims=[]" %%a in ('ver') do set "WIN_VER_RAW=%%a"
for /f "tokens=2 delims=. " %%a in ("!WIN_VER_RAW!") do set "WIN_MAJOR=%%a"
for /f "tokens=3 delims=. " %%a in ("!WIN_VER_RAW!") do set "WIN_MINOR=%%a"
if "!WIN_MAJOR!"=="6" if "!WIN_MINOR!"=="3" set "NODE_VERSION=18.20.5"
if "!WIN_MAJOR!"=="6" if "!WIN_MINOR!"=="1" set "NODE_VERSION=16.20.2"
if "!WIN_MAJOR!"=="6" if "!WIN_MINOR!"=="0" set "NODE_VERSION=16.20.2"

set "NODE_ARCH=x64"
if /i not "%PROCESSOR_ARCHITECTURE%"=="AMD64" if "%PROCESSOR_ARCHITEW6432%"=="" set "NODE_ARCH=x86"
set "NODE_ZIP=node-v!NODE_VERSION!-win-!NODE_ARCH!.zip"
set "NODE_URL=https://nodejs.org/dist/v!NODE_VERSION!/!NODE_ZIP!"
set "REQ_MAJOR=18"
if "!NODE_VERSION!"=="16.20.2" set "REQ_MAJOR=16"
echo [Detect] Windows !WIN_VER_RAW! - !NODE_ARCH!  Node.js v!NODE_VERSION!

rem Patch Vite to v4 for Node 16
if "!NODE_VERSION!"=="16.20.2" if exist "!CLI!\package.json" (
    powershell -Command "$c=(Get-Content '!CLI!\package.json' -Raw) -replace '\""vite\"": \""\d+\.\d+\.\d+\""', '\""vite\"": \""4.5.5\""'; Set-Content '!CLI!\package.json' -Value $c -NoNewline"
)

rem Step 1: Locate Node.js
call :find_node
if "!NODE_OK!"=="1" goto :check_files
if "!NODE_OK!"=="2" goto :download_node

echo [Setup] Node.js not found in PATH, searching common locations...
call :search_node
if !errorlevel! equ 0 (set "PATH=!NODE_PATH!;%PATH%" & call :check_ver)
if "!NODE_OK!"=="1" goto :check_files
if "!NODE_OK!"=="2" goto :download_node

:download_node
echo [Setup] Downloading portable Node.js v%NODE_VERSION%...
call :do_download_node
if !errorlevel! equ 0 goto :check_files
echo [ERROR] Could not install Node.js. Please install manually: https://nodejs.org
pause
exit /b 1

:check_files
call :verify_files
if !errorlevel! equ 0 (echo [OK] All project files present. & goto :check_deps)
echo [Setup] Project files incomplete. Downloading from GitHub...
call :do_download_project
if !errorlevel! equ 0 (echo [OK] Download complete. & goto :check_deps)
call :verify_files
if !errorlevel! NEQ 0 (
    echo [ERROR] Critical files missing. Please clone:
    echo        git clone https://github.com/Ember5714/Emberclouds.git
    pause
    exit /b 1
)

:check_deps
cd /d "%ROOT%"

if not exist "%SRV%\node_modules" (
    echo [Setup] Installing server dependencies...
    cd /d "%SRV%" & call npm install --prefer-offline
    if !errorlevel! NEQ 0 (call npm cache clean --force & call npm install)
    cd /d "%ROOT%"
)

if not exist "%CLI%\node_modules" (
    echo [Setup] Installing client dependencies...
    cd /d "%CLI%" & call npm install --prefer-offline
    if !errorlevel! NEQ 0 (call npm cache clean --force & call npm install)
    cd /d "%ROOT%"
)

if not exist "%CLI%\dist\index.html" (
    echo [Setup] Building frontend...
    cd /d "%CLI%" & call npm run build
    if !errorlevel! NEQ 0 (echo [ERROR] Frontend build failed. & pause & exit /b 1)
    cd /d "%ROOT%"
)

rem Create data directories
for %%d in (data\avatars data\backgrounds data\profiles file\private file\public) do (
    if not exist "%ROOT%\%%d" mkdir "%ROOT%\%%d"
)

rem SMTP config
set SMTP_HOST=smtp-mail.outlook.com
set SMTP_PORT=587
set SMTP_USER=admin@example.com
set SMTP_PASS=Anber_5714

rem Start server
cd /d "%SRV%"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>nul
    ping -n 2 127.0.0.1 >nul
)

echo.
echo ========================================
echo   Emberclouds
echo   Server  : http://localhost:3000
echo   Storage : %ROOT%\file
echo ========================================
echo.
echo   LAN IPs:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do echo     http:%%a:3000
echo ========================================
echo.
echo   Press Ctrl+C to stop
echo ========================================
echo.

node "%SRV%\src\index.js"
pause
exit /b 0

rem ============ Subroutine: find_node (PATH + version check) ============
:find_node
where node >nul 2>nul
if !errorlevel! NEQ 0 exit /b 1
for /f "delims=" %%i in ('where node 2^>nul') do set "NODE_EXE=%%i"
:check_ver
set "NODE_OK=0"
for /f "tokens=1 delims=v." %%v in ('node -v 2^>nul') do set "NODE_MAJOR=%%v"
if "!NODE_MAJOR!"=="" exit /b 0
if !NODE_MAJOR! LSS !REQ_MAJOR! (
    echo [Detect] Node.js v!NODE_MAJOR! - requires v!REQ_MAJOR!+
    set "NODE_OK=2"
    exit /b 0
)
echo [OK] Node.js v!NODE_MAJOR!: !NODE_EXE!
set "NODE_OK=1"
exit /b 0

rem ============ Subroutine: search_node (disk search) ============
:search_node
set "NODE_PATH="
if exist "%APPDATA%\nvm\node.exe" (
    set "NODE_PATH=%APPDATA%\nvm" & set "NODE_EXE=!NODE_PATH!\node.exe" & exit /b 0
)
for /d %%d in ("%APPDATA%\nvm\v*") do if exist "%%d\node.exe" (
    set "NODE_PATH=%%d" & set "NODE_EXE=%%d\node.exe" & exit /b 0
)
if exist "%NODE_DIR%\node.exe" (
    set "NODE_PATH=%NODE_DIR%" & set "NODE_EXE=%NODE_DIR%\node.exe" & exit /b 0
)
if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_PATH=C:\Program Files\nodejs" & set "NODE_EXE=C:\Program Files\nodejs\node.exe" & exit /b 0
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_PATH=C:\Program Files (x86)\nodejs" & set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe" & exit /b 0
)
if exist "%USERPROFILE%\scoop\apps\nodejs\current\node.exe" (
    set "NODE_PATH=%USERPROFILE%\scoop\apps\nodejs\current" & set "NODE_EXE=!NODE_PATH!\node.exe" & exit /b 0
)
exit /b 1

rem ============ Subroutine: do_download_node ============
:do_download_node
if not exist "%RUNTIME%" mkdir "%RUNTIME%"
if exist "%RUNTIME%\node-temp" rmdir /s /q "%RUNTIME%\node-temp" 2>nul
if exist "%TEMP%\%NODE_ZIP%" del /f /q "%TEMP%\%NODE_ZIP%" 2>nul

powershell -Command "$ProgressPreference='SilentlyContinue'; try { Write-Host '  Downloading...'; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%TEMP%\%NODE_ZIP%' -UseBasicParsing -ErrorAction Stop; Write-Host '  Extracting...'; Expand-Archive -Path '%TEMP%\%NODE_ZIP%' -DestinationPath '%RUNTIME%\node-temp' -Force; $inner=(Get-ChildItem '%RUNTIME%\node-temp' -Directory)[0]; if($inner){if(Test-Path '%NODE_DIR%'){Remove-Item '%NODE_DIR%' -Recurse -Force}; Move-Item $inner.FullName '%NODE_DIR%'; Remove-Item '%RUNTIME%\node-temp' -Recurse -Force}; Write-Host '  Done.' } catch { Write-Host '  Error:' $_.Exception.Message; exit 1 }"
if !errorlevel! NEQ 0 exit /b 1

del /f /q "%TEMP%\%NODE_ZIP%" 2>nul
if not exist "%NODE_DIR%\node.exe" (echo   ERROR: node.exe not found & exit /b 1)
set "PATH=%NODE_DIR%;%PATH%"
set "NODE_EXE=%NODE_DIR%\node.exe"
echo   [OK] Node.js v%NODE_VERSION% installed
exit /b 0

rem ============ Subroutine: verify_files ============
:verify_files
set "MISSING=0"
for %%f in (package.json src\index.js src\config.js src\auth.js src\users.js src\fileServer.js src\wsServer.js) do (
    if not exist "%SRV%\%%f" set "MISSING=1"
)
for %%f in (package.json index.html vite.config.js src\App.jsx src\App.css) do (
    if not exist "%CLI%\%%f" set "MISSING=1"
)
if not exist "%ROOT%\README.md" set "MISSING=1"
if not exist "%ROOT%\LICENSE" set "MISSING=1"
if %MISSING% equ 1 (echo [WARN] Some project files missing. & exit /b 1)
exit /b 0

rem ============ Subroutine: do_download_project ============
:do_download_project
set "TEMP_ZIP=%TEMP%\emberclouds-main.zip"
set "TEMP_DIR=%TEMP%\emberclouds-extract"
if exist "%TEMP_ZIP%" del /f /q "%TEMP_ZIP%" 2>nul
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%" 2>nul

powershell -Command "$ProgressPreference='SilentlyContinue'; try { Write-Host '  Downloading...'; Invoke-WebRequest -Uri 'https://github.com/Ember5714/Emberclouds/archive/refs/heads/main.zip' -OutFile '%TEMP_ZIP%' -UseBasicParsing -ErrorAction Stop; Write-Host '  Extracting...'; Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%TEMP_DIR%' -Force; Write-Host '  Done.' } catch { Write-Host '  Error:' $_.Exception.Message; exit 1 }"
if !errorlevel! NEQ 0 exit /b 1

for /d %%d in ("%TEMP_DIR%\*") do set "SRC_DIR=%%d"
if not defined SRC_DIR (echo   ERROR: Cannot find extracted directory & exit /b 1)
echo   Merging...
robocopy "%SRC_DIR%" "%ROOT%" /E /XO /NP /NFL /NDL /NJH /NJS >nul
rmdir /s /q "%TEMP_DIR%" 2>nul
del /f /q "%TEMP_ZIP%" 2>nul
if exist "%SRV%\src\index.js" (echo   [OK] Merged. & exit /b 0) else (echo   ERROR: Still missing. & exit /b 1)