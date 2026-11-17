#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"
if ! command -v docker >/dev/null; then
  echo "Docker belum tersedia. Memasang dari installer resmi Docker..."
  curl -fsSL https://get.docker.com -o /tmp/pansa-docker-install.sh
  sudo sh /tmp/pansa-docker-install.sh
  sudo usermod -aG docker "${USER}"
  echo "Docker terpasang. Login ulang jika akses socket ditolak."
fi
if ! docker compose version >/dev/null 2>&1; then echo "Docker Compose plugin wajib terpasang."; exit 1; fi
PUBLIC_IP="$(curl -4fsS --max-time 10 ifconfig.me || true)"
if [[ "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then DOMAIN="${PUBLIC_IP//./-}.nip.io"; else DOMAIN="${PUBLIC_IP:-localhost}.sslip.io"; fi
read -r -p "Domain [$DOMAIN]: " CUSTOM_DOMAIN; DOMAIN="${CUSTOM_DOMAIN:-$DOMAIN}"
read -r -s -p "BOT_TOKEN (kosongkan jika belum): " BOT_TOKEN; echo
read -r -p "ADMIN_IDS (ID Telegram dipisah koma): " ADMIN_IDS
if [[ -f .env ]]; then read -r -p ".env sudah ada, pertahankan? [Y/n] " keep; [[ "${keep:-Y}" =~ ^[Nn]$ ]] || { echo "Mempertahankan .env"; docker compose up -d --build; exit 0; }; fi
MASTER_KEY="$(openssl rand -hex 32)"; DASH_TOKEN="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9_-')"
cat > .env <<EOF
NODE_ENV=production
PORT=3001
PUBLIC_URL=https://${DOMAIN}
PANSA_DOMAIN=${DOMAIN}
MASTER_KEY=${MASTER_KEY}
DASH_TOKEN=${DASH_TOKEN}
BOT_TOKEN=${BOT_TOKEN}
ADMIN_IDS=${ADMIN_IDS}
DATA_DIR=/app/data
WORKSPACE_DIR=/app/workspace
HOST_WORKSPACE_DIR=$(pwd)/workspace
SKILLS_DIR=/app/skills
PLUGINS_DIR=/app/plugins
SOUL_PATH=/app/SOUL.md
ALLOW_UNSANDBOXED=false
SANDBOX_NETWORK=false
SANDBOX_IMAGE=pansaos-sandbox:local
MAX_STEPS=25
TASK_TIMEOUT_MS=900000
TOOL_OUTPUT_LIMIT=16000
MAX_CONCURRENCY=4
MAX_TASK_COST=5
TELEGRAM_MODE=auto
ALLOW_PRIVATE_NETWORK=false
EOF
chmod 600 .env
mkdir -p data workspace plugins backups
docker build -t pansaos-sandbox:local -f docker/Dockerfile.sandbox .
docker compose up -d --build
echo; echo "PansaOS aktif: https://${DOMAIN}"; echo "Dashboard token: ${DASH_TOKEN}"; echo "SQLite backup: ./pansaos backup"
