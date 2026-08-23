#!/usr/bin/env bash
# =============================================
#   Emberclouds — Linux/macOS Startup Script
#   Author : Ember5714
#   GitHub : https://github.com/Ember5714/Emberclouds
# =============================================
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRV="$ROOT/server"
CLI="$ROOT/client"
PORT=3000

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "========================================"
echo "  Emberclouds - Setup"
echo "========================================"
echo ""

# ── Step 1: Check Node.js ──
if ! command -v node &>/dev/null; then
    echo -e "${RED}[ERROR] Node.js not found. Please install Node.js >= 18${NC}"
    echo "  Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "  macOS:         brew install node@20"
    exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
    echo -e "${YELLOW}[WARN] Node.js v$(node -v) — requires v18+${NC}"
    echo "  Please upgrade Node.js and try again."
    exit 1
fi
echo -e "${GREEN}[OK] Node.js $(node -v): $(which node)${NC}"

# ── Step 2: Check npm ──
if ! command -v npm &>/dev/null; then
    echo -e "${RED}[ERROR] npm not found${NC}"
    exit 1
fi
echo -e "${GREEN}[OK] npm $(npm -v)${NC}"

# ── Step 3: Install dependencies ──
cd "$ROOT"

if [ ! -d "$SRV/node_modules" ]; then
    echo "[Setup] Installing server dependencies..."
    cd "$SRV" && npm install --prefer-offline || npm install
    cd "$ROOT"
fi

if [ ! -d "$CLI/node_modules" ]; then
    echo "[Setup] Installing client dependencies..."
    cd "$CLI" && npm install --prefer-offline || npm install
    cd "$ROOT"
fi

# ── Step 4: Build frontend ──
if [ ! -f "$CLI/dist/index.html" ]; then
    echo "[Setup] Building frontend..."
    cd "$CLI" && npm run build
    cd "$ROOT"
fi

# ── Step 5: Create data directories ──
mkdir -p "$ROOT/data/avatars" "$ROOT/data/backgrounds" "$ROOT/data/profiles" \
         "$ROOT/data/tmp" "$ROOT/file/private" "$ROOT/file/public"

# ── Step 6: Copy config.example.json to config.json if not exists ──
if [ ! -f "$ROOT/config.json" ]; then
    echo -e "${YELLOW}[Setup] Creating config.json from template...${NC}"
    cp "$ROOT/config.example.json" "$ROOT/config.json"
    echo -e "${YELLOW}[Setup] Please edit config.json to configure SMTP and other settings.${NC}"
fi

# ── Step 7: Kill existing process on port ──
if command -v lsof &>/dev/null; then
    PID=$(lsof -ti :$PORT 2>/dev/null || true)
elif command -v ss &>/dev/null; then
    PID=$(ss -tlnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K\d+' || true)
elif command -v fuser &>/dev/null; then
    PID=$(fuser $PORT/tcp 2>/dev/null || true)
fi

if [ -n "$PID" ]; then
    echo -e "${YELLOW}[Setup] Killing existing process on port $PORT (PID: $PID)${NC}"
    kill "$PID" 2>/dev/null || true
    sleep 1
fi

# ── Step 7: Show network info ──
echo ""
echo "========================================"
echo "  Emberclouds"
echo "  Server  : http://localhost:$PORT"
echo "  Storage : $ROOT/file"
echo "========================================"
echo ""
echo "  LAN IPs:"
if command -v ip &>/dev/null; then
    ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}(?=/)' | grep -v '127.0.0.1' | while read -r ip; do
        echo "    http://$ip:$PORT"
    done
elif command -v ifconfig &>/dev/null; then
    ifconfig | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '127.0.0.1' | while read -r ip; do
        echo "    http://$ip:$PORT"
    done
else
    hostname -I 2>/dev/null | tr ' ' '\n' | while read -r ip; do
        [ -n "$ip" ] && echo "    http://$ip:$PORT"
    done
fi
echo "========================================"
echo ""
echo "  Press Ctrl+C to stop"
echo "========================================"
echo ""

# ── Step 8: Start server ──
cd "$SRV"
exec node src/index.js