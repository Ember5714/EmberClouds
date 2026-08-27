# Emberclouds

<p align="center">
  <strong>LAN File Transfer &amp; Sharing Platform</strong>
</p>



<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node">
  <a href="https://github.com/Ember5714/EmberClouds/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/react-18-61dafb" alt="React">
  <a href="https://github.com/Ember5714/EmberClouds/stargazers"><img src="https://img.shields.io/github/stars/Ember5714/EmberClouds?style=flat&logo=github&label=Stars&labelColor=444444&color=eac54f" alt="Stars"></a>
  <a href="https://github.com/Ember5714/EmberClouds/issues"><img src="https://img.shields.io/github/issues/Ember5714/EmberClouds?style=flat&label=Issues&labelColor=444444&color=1F883D" alt="Issues"></a>
</p>

<p align="center">
  <a href="https://space.bilibili.com/3493086938270254"><img src="https://img.shields.io/badge/bilibili-00A1D6?logo=bilibili&logoColor=white" alt="Bilibili"></a>
  <a href="https://www.douyin.com/user/MS4wLjABAAAARFMQwKlxUI_B0j0cQwzbeJbZKuBI5QuyesZLXgKdD1w"><img src="https://img.shields.io/badge/douyin-000000?logo=tiktok&logoColor=white" alt="抖音(douyin)"></a>
</p>
<img width="1910" height="915" alt="image" src="https://github.com/user-attachments/assets/eaa08558-3f0b-46df-a597-413c231127b3" />
---

**[English](#english) &nbsp;|&nbsp; [简体中文](#简体中文) &nbsp;|&nbsp; [繁體中文](#繁體中文)**

---

## English

A self-hosted LAN file server built with Node.js + React. Think of it as your personal Dropbox that runs on your own machine — accessible by anyone on the same network without uploading anything to the cloud.

Supports Windows, Linux, and macOS.

### Features

- **Multi-user system** — register, login, email verification, token auth, password reset, refresh token rotation
- **Private + Public repos** — each user gets two independent spaces, toggle visibility with one click
- **User search** — find other users by username, browse and download their public files (even unauthenticated)
- **Personal profiles** — avatar, cover image, status message, Markdown bio
- **File management** — grid/list view, folder navigation, breadcrumb trail
- **Upload** — drag-and-drop or click, batch upload up to 500 files at once, real-time progress bar
- **Download** — HTTP Range support for resumable downloads
- **Image preview** — click any image to open a full-size lightbox
- **Dark theme** — auto (follows system settings) or manual toggle
- **Server CLI** — interactive command console for server status, user management, and file management
- **Cross-platform** — works on Windows, Linux, and macOS
- **Public access** — built-in frp config for exposing your server to the internet via a VPS
- **Auto-setup** — `start.bat` (Windows) or `start.sh` (Linux/macOS) detects missing dependencies and installs them automatically

### Quick Start

**Prerequisites:** Node.js 18+

```bash
git clone https://github.com/Ember5714/EmberClouds.git
cd EmberClouds

cd server && npm install
cd ../client && npm install && npm run build
cd ../server && npm start
```

On Windows, double-click `start.bat`. On Linux/macOS, run `bash start.sh` — it handles everything.

Open `http://localhost:3000`. To allow other devices on the LAN, set `BIND_ADDRESS=0.0.0.0` then use `http://<your-ip>:3000`.

**First-time setup:**

1. Register with email + username + password
2. Enter the verification code (printed in the console if SMTP isn't configured)
3. Done — start uploading files

### Configuration

All settings are centralized in `config.json` (copy from `config.example.json` on first run). Environment variables override file values.

```json
{
  "server": {
    "port": 3000,
    "bindAddress": "0.0.0.0",
    "deviceName": "",
    "requestTimeout": 5000,
    "headersTimeout": 6000,
    "keepAliveTimeout": 5000
  },
  "storage": {
    "uploadDir": "file",
    "maxFileSize": 0,
    "maxFileCount": 500,
    "chunkSize": 65536,
    "uploadCooldown": 10000
  },
  "smtp": {
    "host": "smtp-mail.outlook.com",
    "port": 587,
    "user": "admin@example.com",
    "pass": "your_smtp_password"
  },
  "registration": {
    "open": true
  },
  "token": {
    "accessTokenTTL": 43200000,
    "refreshTokenTTL": 604800000
  },
  "verification": {
    "codeTTL": 600000,
    "codeFailMax": 5,
    "codeFailLockMs": 3600000
  },
  "rateLimit": {
    "register": { "max": 3, "windowMs": 3600000 },
    "login": { "max": 10, "windowMs": 900000 },
    "verify": { "max": 10, "windowMs": 900000 },
    "resend": { "max": 5, "windowMs": 900000 }
  },
  "security": {
    "maxRateLimitEntries": 10000,
    "maxLoginDelayEntries": 5000
  },
  "websocket": {
    "authTimeout": 10000,
    "maxUnauthenticated": 10
  }
}
```

If SMTP is not configured, verification codes are printed to the server console.

### Private / Public Repos

| Space | Path | Visibility |
|-------|------|------------|
| Private | `file/private/{userId}/` | Only you |
| Public | `file/public/{userId}/` | Anyone can browse and download |

To go public: open the avatar menu → toggle "Public repo" → switch to the public space and upload files → other users can now find you via search.

### Server CLI

The server includes a text-based command console. Type commands at the `ember>` prompt:

| Command | Description |
|---------|-------------|
| `help` | Show all available commands |
| `status` | Show server status and network info |
| `users` | List all registered users |
| `ls [path]` | List files in a directory |
| `tree [path]` | Show directory tree |
| `info <path>` | Show file/directory details |
| `mkdir <path>` | Create a directory |
| `rm -y <path>` | Delete a file or directory (requires `-y` flag) |
| `config` | Show current configuration |
| `clear` | Clear the terminal |
| `stop` / `restart` | Stop or restart the server |
| `exit` / `quit` | Shut down the server |

Press Ctrl+C at any time to shut down.

### Public Access (frp)

The `frp/` directory contains everything needed for tunneling.

**Server side (VPS):**
```bash
./frps -c frps.toml
```

**Client side (your machine):**
Edit `frpc.toml` — set `serverAddr` and `auth.token` — then run `start-frpc.bat`.

### Project Structure

```
├── start.bat               # One-click startup (auto-install + launch)
├── start.sh                # Linux/macOS startup script
├── .gitignore
├── LICENSE
├── README.md
├── server/                 # Backend (Express)
│   ├── package.json
│   └── src/
│       ├── index.js        # Entry point + API routes
│       ├── cli.js           # Command-line interface (readline REPL)
│       ├── config.js       # Configuration
│       ├── auth.js         # Token authentication
│       ├── users.js        # User system (encrypted data storage)
│       ├── fileServer.js   # File storage & upload
│       ├── fileCrypto.js   # AES-256-CTR at-rest file encryption
│       ├── fileLock.js     # Concurrent write queue lock
│       ├── rateLimit.js    # IP-based rate limiting
│       ├── repo-cli.js     # CLI file management commands
│       ├── discovery.js    # LAN device discovery (HMAC-signed UDP)
│       └── wsServer.js     # WebSocket notifications
├── client/                 # Frontend (React + Vite)
│   ├── package.json
│   ├── index.html
│   └── src/
│       ├── App.jsx         # Main component
│       └── App.css         # Styles
├── frp/                    # frp tunnel (optional)
│   ├── frpc.exe / frps.exe
│   ├── frpc.toml / frps.toml
│   ├── start-frpc.bat
│   └── download.ps1
├── file/                   # File storage (gitignored)
│   ├── private/{userId}/
│   └── public/{userId}/
├── data/                   # User data (gitignored, AES-256-GCM encrypted)
│   ├── users.json
│   ├── tokens.json
│   ├── refresh_tokens.json
│   ├── avatars/
│   ├── backgrounds/
│   └── profiles/
└── logo/                   # Logo assets
```

### API

#### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/verify` | Verify email |
| POST | `/api/auth/resend` | Resend verification code |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/refresh` | Refresh access token |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user info |
| PATCH | `/api/auth/profile` | Toggle public profile |
| PATCH | `/api/auth/password` | Change password |
| POST | `/api/auth/send-op-code` | Send operation verification code |
| PATCH | `/api/auth/username` | Change username |
| PATCH | `/api/auth/signature` | Update status message |
| POST | `/api/auth/avatar` | Upload avatar |
| POST | `/api/auth/profile-background` | Upload cover image |
| GET | `/api/auth/profile-bio` | Get own bio |
| PUT | `/api/auth/profile-bio` | Save own bio |
| DELETE | `/api/auth/account` | Delete account |
| POST | `/api/auth/send-reset-code` | Send password reset code |
| POST | `/api/auth/reset-password` | Reset password |

#### Files

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files/browse` | Browse files |
| POST | `/api/files/upload` | Upload files (multipart) |
| GET | `/api/files/download` | Download file (encrypted) |
| GET | `/api/files/download-encrypted` | Download file (encrypted, with key) |
| POST | `/api/files/mkdir` | Create folder |
| POST | `/api/files/rename` | Rename |
| DELETE | `/api/files` | Delete |

#### Public Users

> All endpoints require login.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/search?q=` | Search users |
| GET | `/api/users/:id/profile` | Get user profile |
| GET | `/api/users/:id/profile/bio` | Get user bio |
| GET | `/api/users/:id/public/browse` | Browse public files |
| GET | `/api/users/:id/public/download` | Download public file (encrypted) |
| GET | `/api/users/:id/public/download-encrypted` | Download public file (encrypted, with key) |
| POST | `/api/users/:id/copytome` | Copy to your private repo |

#### System

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/ping` | No | Health check |
| GET | `/api/self` | No | Server device info |
| GET | `/api/diagnose` | Required | Diagnostics (summary only) |

### Environment Variables

> **Note:** `config.json` is the recommended way to configure settings.  
> Environment variables override the corresponding fields in `config.json`.

| Variable | Config Key | Description | Default |
|----------|-----------|-------------|---------|
| `PORT` | `server.port` | Server port | `3000` |
| `BIND_ADDRESS` | `server.bindAddress` | Bind address | `0.0.0.0` |
| `DEVICE_NAME` | `server.deviceName` | Device display name | Hostname |
| `REQUEST_TIMEOUT` | `server.requestTimeout` | HTTP request timeout (ms) | `5000` |
| `HEADERS_TIMEOUT` | `server.headersTimeout` | HTTP headers timeout (ms) | `6000` |
| `KEEPALIVE_TIMEOUT` | `server.keepAliveTimeout` | HTTP keep-alive timeout (ms) | `5000` |
| `UPLOAD_DIR` | `storage.uploadDir` | Storage root | `file/` |
| `MAX_FILE_SIZE` | `storage.maxFileSize` | Max single file size (bytes, 0 = unlimited) | `0` |
| `MAX_FILE_COUNT` | `storage.maxFileCount` | Max files per upload batch | `500` |
| `CHUNK_SIZE` | `storage.chunkSize` | File transfer chunk size (bytes) | `65536` |
| `UPLOAD_COOLDOWN` | `storage.uploadCooldown` | Upload cooldown per user (ms) | `10000` |
| `REGISTRATION_OPEN` | `registration.open` | Allow new registrations | `true` |
| `SMTP_HOST` | `smtp.host` | SMTP server | — |
| `SMTP_PORT` | `smtp.port` | SMTP port | `587` |
| `SMTP_USER` | `smtp.user` | SMTP username | — |
| `SMTP_PASS` | `smtp.pass` | SMTP password | — |
| `TOKEN_ACCESS_TTL` | `token.accessTokenTTL` | Access token lifetime (ms) | `43200000` (12h) |
| `TOKEN_REFRESH_TTL` | `token.refreshTokenTTL` | Refresh token lifetime (ms) | `604800000` (7d) |
| `VERIFY_CODE_TTL` | `verification.codeTTL` | Verification code validity (ms) | `600000` (10min) |
| `VERIFY_CODE_FAIL_MAX` | `verification.codeFailMax` | Max code failures before lockout | `5` |
| `VERIFY_CODE_FAIL_LOCK` | `verification.codeFailLockMs` | Code failure lockout duration (ms) | `3600000` (1h) |
| `WS_AUTH_TIMEOUT` | `websocket.authTimeout` | WebSocket auth timeout (ms) | `10000` |
| `WS_MAX_UNAUTH` | `websocket.maxUnauthenticated` | Max unauthenticated WS connections | `10` |

### FAQ

**Can't find other users in search?**
They need to enable "Public repo" in their avatar menu first.

**Can't access from other devices on LAN?**
Ensure `BIND_ADDRESS=0.0.0.0` is configured, then restart `start.bat` to auto-register the firewall rule, or manually run:

```powershell
netsh advfirewall firewall add rule name="Emberclouds-Port" dir=in action=allow protocol=TCP localport=3000 enable=yes
netsh advfirewall firewall add rule name="Emberclouds-Discovery" dir=in action=allow protocol=UDP localport=3001 enable=yes
```

**Upload fails with too many files?**
Default limit is 500 files per batch. Set `MAX_FILE_COUNT=2000` to increase it, or zip the files before uploading.

**Can't access from the internet?**
Forward port 3000 on your router, or use the built-in frp tunnel (see Public Access above).

### Links

- Bilibili: [@Ember5714](https://space.bilibili.com/3493086938270254)
- Douyin: [@Ember5714](https://www.douyin.com/user/MS4wLjABAAAARFMQwKlxUI_B0j0cQwzbeJbZKuBI5QuyesZLXgKdD1w)

---

## 简体中文

基于 Node.js + React 构建的局域网文件共享平台。部署在本地主机上，同一局域网内的所有设备均可通过浏览器直接访问，无需将文件上传至任何第三方云端服务。

支持 Windows、Linux、macOS 三平台。

### 功能特性

- **多用户系统** — 支持用户注册、登录、邮箱验证码、Token 身份认证、Refresh Token 轮换以及密码重置
- **私密与公开仓库** — 每位用户拥有独立的私密与公开两个存储空间，一键切换
- **用户发现** — 通过用户名搜索已开启公开仓库的用户，浏览并下载其公开文件（未登录用户亦可浏览）
- **个人主页** — 支持自定义头像、封面背景、个性签名以及 Markdown 格式的个人简介
- **文件管理** — 提供网格与列表两种视图模式，支持文件夹层级导航与面包屑路径
- **文件上传** — 支持拖拽上传与点击选择，单次批量上传最多 500 个文件，实时显示进度
- **文件下载** — 基于 HTTP Range 协议实现断点续传
- **图片预览** — 点击图片弹出灯箱查看原图
- **深色模式** — 支持跟随系统主题自动切换，亦可手动切换
- **服务端 CLI** — 交互式命令控制台，支持服务状态、用户管理和文件管理
- **跨平台** — 支持 Windows、Linux、macOS
- **公网接入** — 内置 frp 反向代理配置，配合 VPS 即可将服务暴露至公网
- **开箱即用** — `start.bat`（Windows）或 `start.sh`（Linux/macOS）一键启动，自动检测并安装缺失的依赖

### 快速开始

**环境要求：** Node.js 18+

```bash
git clone https://github.com/Ember5714/EmberClouds.git
cd EmberClouds

cd server && npm install
cd ../client && npm install && npm run build
cd ../server && npm start
```

Windows 系统下可直接双击 `start.bat`，Linux/macOS 下运行 `bash start.sh`，脚本将自动完成依赖安装与前端构建。

通过浏览器访问 `http://localhost:3000`。若需局域网内其他设备访问，需设置 `BIND_ADDRESS=0.0.0.0`，然后通过 `http://<本机IP>:3000` 访问。

**首次使用流程：**

1. 注册账号（邮箱 + 用户名 + 密码）
2. 输入邮箱验证码完成验证（若未配置 SMTP，验证码将打印在服务端控制台）
3. 登录后即可使用全部功能

### 配置

所有设置集中在 `config.json` 中（首次运行时会自动从 `config.example.json` 复制）。环境变量可覆盖文件中的值。

```json
{
  "server": {
    "port": 3000,
    "bindAddress": "0.0.0.0",
    "deviceName": "",
    "requestTimeout": 5000,
    "headersTimeout": 6000,
    "keepAliveTimeout": 5000
  },
  "storage": {
    "uploadDir": "file",
    "maxFileSize": 0,
    "maxFileCount": 500,
    "chunkSize": 65536,
    "uploadCooldown": 10000
  },
  "smtp": {
    "host": "smtp-mail.outlook.com",
    "port": 587,
    "user": "admin@example.com",
    "pass": "your_smtp_password"
  },
  "registration": {
    "open": true
  },
  "token": {
    "accessTokenTTL": 43200000,
    "refreshTokenTTL": 604800000
  },
  "verification": {
    "codeTTL": 600000,
    "codeFailMax": 5,
    "codeFailLockMs": 3600000
  },
  "rateLimit": {
    "register": { "max": 3, "windowMs": 3600000 },
    "login": { "max": 10, "windowMs": 900000 },
    "verify": { "max": 10, "windowMs": 900000 },
    "resend": { "max": 5, "windowMs": 900000 }
  },
  "security": {
    "maxRateLimitEntries": 10000,
    "maxLoginDelayEntries": 5000
  },
  "websocket": {
    "authTimeout": 10000,
    "maxUnauthenticated": 10
  }
}
```

若未配置 SMTP，系统验证码将直接输出至服务端控制台。

### 私密与公开仓库

| 空间类型 | 存储路径 | 可见范围 |
|------|----------|--------|
| 私密仓库 | `file/private/{userId}/` | 仅用户本人可访问 |
| 公开仓库 | `file/public/{userId}/` | 可被其他用户搜索、浏览与下载 |

开启公开仓库：点击头像 → 开启"公开仓库" → 切换至公开空间上传文件 → 其他用户可通过用户名搜索到您。

### 服务端 CLI

服务端内置基于文本的命令控制台。在 `ember>` 提示符下输入命令：

| 命令 | 功能描述 |
|------|--------|
| `help` | 显示所有可用命令 |
| `status` | 查看服务器运行状态和网络信息 |
| `users` | 查看已注册用户列表 |
| `ls [路径]` | 列出目录内容 |
| `tree [路径]` | 以树形结构展示目录层级 |
| `info <路径>` | 查看文件或目录的详细信息 |
| `mkdir <路径>` | 创建目录 |
| `rm -y <路径>` | 删除文件或目录（需 `-y` 确认） |
| `config` | 查看当前运行配置 |
| `clear` | 清空终端 |
| `stop` / `restart` | 停止 / 重启服务器 |
| `exit` / `quit` | 关闭服务器 |

随时按 Ctrl+C 关闭服务器。

### 公网访问（frp）

`frp/` 目录中已预置内网穿透所需配置文件。

**服务端（VPS）：**
```bash
./frps -c frps.toml
```

**客户端（本机）：**
修改 `frpc.toml` 中的 `serverAddr` 与 `auth.token`，随后双击 `start-frpc.bat` 启动。

### 项目结构

```
├── start.bat               # 一键启动脚本（自动安装依赖 + 启动服务）
├── .gitignore
├── LICENSE
├── README.md
├── server/                 # 后端服务（Express）
│   ├── package.json
│   └── src/
│       ├── index.js        # 入口模块 + API 路由
│       ├── cli.js           # 命令行界面（readline 交互控制台）
│       ├── config.js       # 全局配置
│       ├── auth.js         # Token 身份认证
│       ├── users.js        # 用户系统逻辑（加密数据存储）
│       ├── fileServer.js   # 文件存储与上传处理
│       ├── fileCrypto.js   # AES-256-CTR 静态文件加密
│       ├── fileLock.js     # 并发写入队列锁
│       ├── rateLimit.js    # IP 频率限制
│       ├── repo-cli.js     # CLI 仓库管理命令
│       ├── discovery.js    # 局域网设备发现（HMAC 签名 UDP）
│       └── wsServer.js     # WebSocket 消息推送
├── client/                 # 前端应用（React + Vite）
│   ├── package.json
│   ├── index.html
│   └── src/
│       ├── App.jsx         # 主应用组件
│       └── App.css         # 全局样式
├── frp/                    # 内网穿透模块（可选）
│   ├── frpc.exe / frps.exe
│   ├── frpc.toml / frps.toml
│   ├── start-frpc.bat
│   └── download.ps1
├── file/                   # 文件存储目录（已加入 .gitignore）
│   ├── private/{userId}/
│   └── public/{userId}/
├── data/                   # 用户数据目录（已加入 .gitignore，AES-256-GCM 加密）
│   ├── users.json
│   ├── tokens.json
│   ├── refresh_tokens.json
│   ├── avatars/
│   ├── backgrounds/
│   └── profiles/
└── logo/                   # Logo 素材
```

### API 接口

#### 认证模块

| 方法 | 路径 | 说明 |
|--------|------|------|
| POST | `/api/auth/register` | 注册账号 |
| POST | `/api/auth/verify` | 验证邮箱 |
| POST | `/api/auth/resend` | 重新发送验证码 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/refresh` | 刷新访问令牌 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 获取当前用户信息 |
| PATCH | `/api/auth/profile` | 切换公开资料可见性 |
| PATCH | `/api/auth/password` | 修改密码 |
| POST | `/api/auth/send-op-code` | 发送操作验证码 |
| PATCH | `/api/auth/username` | 修改用户名 |
| PATCH | `/api/auth/signature` | 修改个性签名 |
| POST | `/api/auth/avatar` | 上传头像 |
| POST | `/api/auth/profile-background` | 上传个人主页背景 |
| GET | `/api/auth/profile-bio` | 获取个人简介 |
| PUT | `/api/auth/profile-bio` | 保存个人简介 |
| DELETE | `/api/auth/account` | 注销账号 |
| POST | `/api/auth/send-reset-code` | 发送密码重置验证码 |
| POST | `/api/auth/reset-password` | 重置密码 |

#### 文件模块

| 方法 | 路径 | 说明 |
|--------|------|------|
| GET | `/api/files/browse` | 浏览文件 |
| POST | `/api/files/upload` | 上传文件（multipart/form-data） |
| GET | `/api/files/download` | 下载文件（加密传输） |
| GET | `/api/files/download-encrypted` | 下载文件（加密传输，带密钥） |
| POST | `/api/files/mkdir` | 新建文件夹 |
| POST | `/api/files/rename` | 重命名文件或文件夹 |
| DELETE | `/api/files` | 删除文件或文件夹 |

#### 公开用户模块

> 所有接口均需登录。

| 方法 | 路径 | 说明 |
|--------|------|------|
| GET | `/api/users/search?q=` | 搜索公开用户 |
| GET | `/api/users/:id/profile` | 查看用户个人资料 |
| GET | `/api/users/:id/profile/bio` | 查看用户个人简介 |
| GET | `/api/users/:id/public/browse` | 浏览用户公开文件 |
| GET | `/api/users/:id/public/download` | 下载用户公开文件（加密传输） |
| GET | `/api/users/:id/public/download-encrypted` | 下载用户公开文件（加密传输，带密钥） |
| POST | `/api/users/:id/copytome` | 复制公开文件至私密仓库 |

#### 系统模块

| 方法 | 路径 | 认证 | 说明 |
|--------|------|------|------|
| GET | `/api/ping` | 无需 | 健康检查 |
| GET | `/api/self` | 无需 | 获取服务器设备信息 |
| GET | `/api/diagnose` | 需要 | 诊断信息（仅摘要） |

### 环境变量

> **注意：** 推荐使用 `config.json` 来配置所有设置。  
> 环境变量会覆盖 `config.json` 中对应的字段。

| 变量 | 配置键 | 说明 | 默认值 |
|------|--------|------|--------|
| `PORT` | `server.port` | 服务监听端口 | `3000` |
| `BIND_ADDRESS` | `server.bindAddress` | 绑定地址 | `0.0.0.0` |
| `DEVICE_NAME` | `server.deviceName` | 设备显示名称 | 主机名 |
| `REQUEST_TIMEOUT` | `server.requestTimeout` | HTTP 请求超时 (ms) | `5000` |
| `HEADERS_TIMEOUT` | `server.headersTimeout` | HTTP 头部超时 (ms) | `6000` |
| `KEEPALIVE_TIMEOUT` | `server.keepAliveTimeout` | HTTP keep-alive 超时 (ms) | `5000` |
| `UPLOAD_DIR` | `storage.uploadDir` | 文件存储根目录 | `file/` |
| `MAX_FILE_SIZE` | `storage.maxFileSize` | 单文件大小上限（字节，0 = 不限制） | `0` |
| `MAX_FILE_COUNT` | `storage.maxFileCount` | 单次批量上传文件数上限 | `500` |
| `CHUNK_SIZE` | `storage.chunkSize` | 文件传输块大小（字节） | `65536` |
| `UPLOAD_COOLDOWN` | `storage.uploadCooldown` | 上传冷却时间 (ms) | `10000` |
| `REGISTRATION_OPEN` | `registration.open` | 是否允许新用户注册 | `true` |
| `SMTP_HOST` | `smtp.host` | SMTP 服务器地址 | — |
| `SMTP_PORT` | `smtp.port` | SMTP 端口 | `587` |
| `SMTP_USER` | `smtp.user` | SMTP 认证用户名 | — |
| `SMTP_PASS` | `smtp.pass` | SMTP 认证密码 | — |
| `TOKEN_ACCESS_TTL` | `token.accessTokenTTL` | 访问令牌有效期 (ms) | `43200000` (12h) |
| `TOKEN_REFRESH_TTL` | `token.refreshTokenTTL` | 刷新令牌有效期 (ms) | `604800000` (7d) |
| `VERIFY_CODE_TTL` | `verification.codeTTL` | 验证码有效期 (ms) | `600000` (10min) |
| `VERIFY_CODE_FAIL_MAX` | `verification.codeFailMax` | 验证码最大错误次数 | `5` |
| `VERIFY_CODE_FAIL_LOCK` | `verification.codeFailLockMs` | 验证码错误锁定时间 (ms) | `3600000` (1h) |
| `WS_AUTH_TIMEOUT` | `websocket.authTimeout` | WebSocket 认证超时 (ms) | `10000` |
| `WS_MAX_UNAUTH` | `websocket.maxUnauthenticated` | 最大未认证 WS 连接数 | `10` |

### 常见问题

**无法搜索到其他用户？**
目标用户需先在头像菜单中开启"公开仓库"功能。

**局域网内其他设备无法访问？**
确保已设置 `BIND_ADDRESS=0.0.0.0`，重启 `start.bat` 将自动注册 Windows 防火墙规则；亦可手动执行：

```powershell
netsh advfirewall firewall add rule name="Emberclouds-Port" dir=in action=allow protocol=TCP localport=3000 enable=yes
netsh advfirewall firewall add rule name="Emberclouds-Discovery" dir=in action=allow protocol=UDP localport=3001 enable=yes
```

**上传文件数量过多导致失败？**
默认单次上传上限为 500 个文件。可通过设置 `MAX_FILE_COUNT=2000` 提高上限，或先将文件打包为 zip 后再上传。

**外网无法访问？**
请在路由器中配置 3000 端口转发，或使用内置 frp 内网穿透方案（参见上文公网访问章节）。

### 相关链接

- 哔哩哔哩: [@Ember5714](https://space.bilibili.com/3493086938270254)
- 抖音: [@Ember5714](https://www.douyin.com/user/MS4wLjABAAAARFMQwKlxUI_B0j0cQwzbeJbZKuBI5QuyesZLXgKdD1w)

---

## 繁體中文

基於 Node.js + React 構建的區域網路檔案分享平台。部署於本機上，同一區域網路內的所有裝置均可透過瀏覽器直接存取，無需將檔案上傳至任何第三方雲端服務。

支援 Windows、Linux、macOS 三平台。

### 功能特性

- **多用戶系統** — 支援用戶註冊、登入、電子郵件驗證碼、Token 身份認證、Refresh Token 輪換以及密碼重設
- **私密與公開倉庫** — 每位用戶擁有獨立的私密與公開兩個儲存空間，一鍵切換
- **用戶發現** — 透過使用者名稱搜尋已開啟公開倉庫的用戶，瀏覽並下載其公開檔案（未登入用戶亦可瀏覽）
- **個人主頁** — 支援自訂頭像、封面背景、個性簽名以及 Markdown 格式的個人簡介
- **檔案管理** — 提供網格與列表兩種檢視模式，支援資料夾層級導航與麵包屑路徑
- **檔案上傳** — 支援拖曳上傳與點擊選取，單次批次上傳最多 500 個檔案，即時顯示進度
- **檔案下載** — 基於 HTTP Range 協定實現斷點續傳
- **圖片預覽** — 點擊圖片彈出燈箱檢視原圖
- **深色模式** — 支援跟隨系統主題自動切換，亦可手動切換
- **伺服器 CLI** — 互動式命令控制台，支援服務狀態、用戶管理和檔案管理
- **跨平台** — 支援 Windows、Linux、macOS
- **公網接入** — 內建 frp 反向代理設定，配合 VPS 即可將服務暴露至公網
- **開箱即用** — `start.bat`（Windows）或 `start.sh`（Linux/macOS）一鍵啟動，自動偵測並安裝缺失的依賴

### 快速開始

**環境要求：** Node.js 18+

```bash
git clone https://github.com/Ember5714/EmberClouds.git
cd EmberClouds

cd server && npm install
cd ../client && npm install && npm run build
cd ../server && npm start
```

Windows 系統下可直接雙擊 `start.bat`，Linux/macOS 下執行 `bash start.sh`，指令碼將自動完成依賴安裝與前端構建。

透過瀏覽器存取 `http://localhost:3000`。若需區域網路內其他裝置存取，需設定 `BIND_ADDRESS=0.0.0.0`，然後透過 `http://<本機IP>:3000` 存取。

**首次使用流程：**

1. 註冊帳號（電子郵件 + 使用者名稱 + 密碼）
2. 輸入電子郵件驗證碼完成驗證（若未設定 SMTP，驗證碼將輸出至伺服器主控台）
3. 登入後即可使用全部功能

### SMTP 郵件設定

```bat
set SMTP_HOST=smtp.qq.com
set SMTP_PORT=587
set SMTP_USER=your@example.com
set SMTP_PASS=your_smtp_password
```

若未設定 SMTP，系統驗證碼將直接輸出至伺服器主控台。

### 私密與公開倉庫

| 空間類型 | 儲存路徑 | 可見範圍 |
|------|----------|--------|
| 私密倉庫 | `file/private/{userId}/` | 僅用戶本人可存取 |
| 公開倉庫 | `file/public/{userId}/` | 可被其他用戶搜尋、瀏覽與下載 |

開啟公開倉庫：點擊頭像 → 開啟「公開倉庫」→ 切換至公開空間上傳檔案 → 其他用戶可透過使用者名稱搜尋到您。

### 伺服器 CLI

伺服器內建基於文字的命令控制台。在 `ember>` 提示符下輸入命令：

| 命令 | 功能描述 |
|------|--------|
| `help` | 顯示所有可用命令 |
| `status` | 檢視伺服器執行狀態和網路資訊 |
| `users` | 檢視已註冊用戶列表 |
| `ls [路徑]` | 列出目錄內容 |
| `tree [路徑]` | 以樹狀結構展示目錄層級 |
| `info <路徑>` | 檢視檔案或目錄的詳細資訊 |
| `mkdir <路徑>` | 建立目錄 |
| `rm -y <路徑>` | 刪除檔案或目錄（需 `-y` 確認） |
| `config` | 檢視目前執行設定 |
| `clear` | 清空終端 |
| `stop` / `restart` | 停止 / 重新啟動伺服器 |
| `exit` / `quit` | 關閉伺服器 |

隨時按 Ctrl+C 關閉伺服器。

### 公網存取（frp）

`frp/` 目錄中已預置內網穿透所需設定檔。

**伺服器端（VPS）：**
```bash
./frps -c frps.toml
```

**客戶端（本機）：**
修改 `frpc.toml` 中的 `serverAddr` 與 `auth.token`，隨後雙擊 `start-frpc.bat` 啟動。

### 專案結構

```
├── start.bat               # 一鍵啟動指令碼（自動安裝依賴 + 啟動服務）
├── start.sh                # Linux/macOS 啟動指令碼
├── .gitignore
├── LICENSE
├── README.md
├── server/                 # 後端服務（Express）
│   ├── package.json
│   └── src/
│       ├── index.js        # 入口模組 + API 路由
│       ├── cli.js           # 命令列介面（readline 互動控制台）
│       ├── config.js       # 全域設定
│       ├── auth.js         # Token 身份認證
│       ├── users.js        # 用戶系統邏輯（加密資料儲存）
│       ├── fileServer.js   # 檔案儲存與上傳處理
│       ├── fileCrypto.js   # AES-256-CTR 靜態檔案加密
│       ├── fileLock.js     # 並發寫入佇列鎖
│       ├── rateLimit.js    # IP 頻率限制
│       ├── repo-cli.js     # CLI 倉庫管理命令
│       ├── discovery.js    # 區域網路裝置發現（HMAC 簽名 UDP）
│       └── wsServer.js     # WebSocket 訊息推送
├── client/                 # 前端應用（React + Vite）
│   ├── package.json
│   ├── index.html
│   └── src/
│       ├── App.jsx         # 主應用元件
│       └── App.css         # 全域樣式
├── frp/                    # 內網穿透模組（可選）
│   ├── frpc.exe / frps.exe
│   ├── frpc.toml / frps.toml
│   ├── start-frpc.bat
│   └── download.ps1
├── file/                   # 檔案儲存目錄（已加入 .gitignore）
│   ├── private/{userId}/
│   └── public/{userId}/
├── data/                   # 用戶資料目錄（已加入 .gitignore，AES-256-GCM 加密）
│   ├── users.json
│   ├── tokens.json
│   ├── refresh_tokens.json
│   ├── avatars/
│   ├── backgrounds/
│   └── profiles/
└── logo/                   # Logo 素材
```

### API 介面

#### 認證模組

| 方法 | 路徑 | 說明 |
|--------|------|------|
| POST | `/api/auth/register` | 註冊帳號 |
| POST | `/api/auth/verify` | 驗證電子郵件 |
| POST | `/api/auth/resend` | 重新發送驗證碼 |
| POST | `/api/auth/login` | 登入 |
| POST | `/api/auth/refresh` | 重新整理存取權杖 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 取得目前用戶資訊 |
| PATCH | `/api/auth/profile` | 切換公開資料可見性 |
| PATCH | `/api/auth/password` | 修改密碼 |
| POST | `/api/auth/send-op-code` | 發送操作驗證碼 |
| PATCH | `/api/auth/username` | 修改使用者名稱 |
| PATCH | `/api/auth/signature` | 修改個性簽名 |
| POST | `/api/auth/avatar` | 上傳頭像 |
| POST | `/api/auth/profile-background` | 上傳個人主頁背景 |
| GET | `/api/auth/profile-bio` | 取得個人簡介 |
| PUT | `/api/auth/profile-bio` | 儲存個人簡介 |
| DELETE | `/api/auth/account` | 註銷帳號 |
| POST | `/api/auth/send-reset-code` | 發送密碼重設驗證碼 |
| POST | `/api/auth/reset-password` | 重設密碼 |

#### 檔案模組

| 方法 | 路徑 | 說明 |
|--------|------|------|
| GET | `/api/files/browse` | 瀏覽檔案 |
| POST | `/api/files/upload` | 上傳檔案（multipart/form-data） |
| GET | `/api/files/download` | 下載檔案（加密傳輸） |
| GET | `/api/files/download-encrypted` | 下載檔案（加密傳輸，帶金鑰） |
| POST | `/api/files/mkdir` | 新增資料夾 |
| POST | `/api/files/rename` | 重新命名檔案或資料夾 |
| DELETE | `/api/files` | 刪除檔案或資料夾 |

#### 公開用戶模組

> 所有介面均需登入。

| 方法 | 路徑 | 說明 |
|--------|------|------|
| GET | `/api/users/search?q=` | 搜尋公開用戶 |
| GET | `/api/users/:id/profile` | 檢視用戶個人資料 |
| GET | `/api/users/:id/profile/bio` | 檢視用戶個人簡介 |
| GET | `/api/users/:id/public/browse` | 瀏覽用戶公開檔案 |
| GET | `/api/users/:id/public/download` | 下載用戶公開檔案（加密傳輸） |
| GET | `/api/users/:id/public/download-encrypted` | 下載用戶公開檔案（加密傳輸，帶金鑰） |
| POST | `/api/users/:id/copytome` | 複製公開檔案至私密倉庫 |

#### 系統模組

| 方法 | 路徑 | 認證 | 說明 |
|--------|------|------|------|
| GET | `/api/ping` | 無需 | 健康檢查 |
| GET | `/api/self` | 無需 | 取得伺服器裝置資訊 |
| GET | `/api/diagnose` | 需要 | 診斷資訊（僅摘要） |

### 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `PORT` | 服務監聽埠號 | `3000` |
| `BIND_ADDRESS` | 綁定位址（`127.0.0.1` = 僅本機，`0.0.0.0` = 區域網路） | `0.0.0.0` |
| `DEVICE_NAME` | 裝置顯示名稱 | 主機名稱 |
| `UPLOAD_DIR` | 檔案儲存根目錄 | `file/` |
| `MAX_FILE_SIZE` | 單檔案大小上限（位元組，0 表示不限制） | `0` |
| `MAX_FILE_COUNT` | 單次批次上傳檔案數量上限 | `500` |
| `REGISTRATION_OPEN` | 是否允許新用戶註冊 | `true` |
| `SMTP_HOST` | SMTP 伺服器位址 | — |
| `SMTP_PORT` | SMTP 埠號 | `587` |
| `SMTP_USER` | SMTP 認證使用者名稱 | — |
| `SMTP_PASS` | SMTP 認證密碼 | — |

### 常見問題

**無法搜尋到其他用戶？**
目標用戶需先在頭像選單中開啟「公開倉庫」功能。

**區域網路內其他裝置無法存取？**
確保已設定 `BIND_ADDRESS=0.0.0.0`，重新啟動 `start.bat` 將自動註冊 Windows 防火牆規則；亦可手動執行：

```powershell
netsh advfirewall firewall add rule name="Emberclouds-Port" dir=in action=allow protocol=TCP localport=3000 enable=yes
netsh advfirewall firewall add rule name="Emberclouds-Discovery" dir=in action=allow protocol=UDP localport=3001 enable=yes
```

**上傳檔案數量過多導致失敗？**
預設單次上傳上限為 500 個檔案。可透過設定 `MAX_FILE_COUNT=2000` 提高上限，或先將檔案封裝為 zip 後再上傳。

**外網無法存取？**
請在路由器中設定 3000 埠轉發，或使用內建 frp 內網穿透方案（參見上文公網存取章節）。

### 相關連結

- 嗶哩嗶哩: [@Ember5714](https://space.bilibili.com/3493086938270254)
- 抖音: [@Ember5714](https://www.douyin.com/user/MS4wLjABAAAARFMQwKlxUI_B0j0cQwzbeJbZKuBI5QuyesZLXgKdD1w)