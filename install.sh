#!/usr/bin/env bash
set -euo pipefail

SERVICE=false
for arg in "$@"; do
  case "$arg" in
    --service) SERVICE=true ;;
    -h|--help) printf 'Usage: install.sh [--service]\n'; exit 0 ;;
    *) printf 'Argumen tidak dikenal: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js >=20.9 dibutuhkan. Instal Node.js 22 LTS dari https://nodejs.org/ lalu jalankan ulang.\n' >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
NODE_MINOR=$(node -p 'Number(process.versions.node.split(".")[1])')
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 9) )); then
  printf 'Node.js >=20.9 dibutuhkan (disarankan Node 22 LTS); versi aktif: %s\n' "$(node -v)" >&2
  exit 1
fi

SOURCE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ -w /opt || $(id -u) -eq 0 ]]; then
  PREFIX=${PANSA_INSTALL_DIR:-/opt/pansaos}
  BIN_DIR=${PANSA_BIN_DIR:-/usr/local/bin}
else
  PREFIX=${PANSA_INSTALL_DIR:-$HOME/.local/share/pansaos}
  BIN_DIR=${PANSA_BIN_DIR:-$HOME/.local/bin}
fi
TARGET_USER=${SUDO_USER:-$(id -un)}
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
TARGET_HOME=${TARGET_HOME:-$HOME}
PANSA_HOME=${PANSA_HOME:-$TARGET_HOME/.pansa}

mkdir -p "$(dirname "$PREFIX")" "$BIN_DIR" "$PANSA_HOME"
chmod 700 "$PANSA_HOME"
mkdir -p "$PANSA_HOME/workspace"
mkdir -p "$PANSA_HOME/skills" "$PANSA_HOME/plugins"
if [[ -d "$PREFIX/skills" ]]; then rsync -a --ignore-existing "$PREFIX/skills/" "$PANSA_HOME/skills/"; fi
if [[ "$SOURCE" != "$PREFIX" ]]; then
  if command -v rsync >/dev/null 2>&1; then
    mkdir -p "$PREFIX"
    rsync -a --exclude node_modules --exclude .next --exclude data --exclude workspace --exclude .git "$SOURCE/" "$PREFIX/"
  else
    printf 'rsync diperlukan untuk menyalin instalasi.\n' >&2
    exit 1
  fi
fi
cd "$PREFIX"
npm install --no-audit --no-fund
npm rebuild better-sqlite3 esbuild
npm run build
mkdir -p apps/dashboard/.next/standalone/apps/dashboard/.next/static
if [[ -d apps/dashboard/.next/static ]]; then cp -a apps/dashboard/.next/static/. apps/dashboard/.next/standalone/apps/dashboard/.next/static/; fi
if [[ -d apps/dashboard/public ]]; then mkdir -p apps/dashboard/.next/standalone/apps/dashboard/public; cp -a apps/dashboard/public/. apps/dashboard/.next/standalone/apps/dashboard/public/; fi

ENV_FILE="$PANSA_HOME/.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
ensure_env() {
  local key=$1 value=$2
  if ! grep -q "^${key}=" "$ENV_FILE"; then printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"; fi
}
ensure_env MASTER_KEY "$(openssl rand -hex 32)"
ensure_env DASH_TOKEN "$(openssl rand -hex 32)"
ensure_env PANSA_HOME "$PANSA_HOME"
ensure_env EXEC_MODE host
ensure_env WORKSPACE_DIR "$PANSA_HOME/workspace"
ensure_env PUBLIC_URL http://localhost:3000
ensure_env PORT 3001
ensure_env DASHBOARD_PORT 3000
ensure_env SKILLS_DIR "$PANSA_HOME/skills"
ensure_env PLUGINS_DIR "$PANSA_HOME/plugins"

ln -sfn "$PREFIX/apps/core/dist/cli.js" "$BIN_DIR/pansa"
chmod +x "$PREFIX/apps/core/dist/cli.js"
if [[ $(id -u) -eq 0 && "$TARGET_USER" != root ]]; then
  chown -R "$TARGET_USER":"$(id -gn "$TARGET_USER")" "$PANSA_HOME"
fi
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) printf 'Tambahkan %s ke PATH untuk menggunakan pansa.\n' "$BIN_DIR" ;; esac

if [[ "$SERVICE" == true ]]; then
  UNIT_DIR=${PANSA_UNIT_DIR:-/etc/systemd/system}
  mkdir -p "$UNIT_DIR"
  if [[ ! -w "$UNIT_DIR" && $(id -u) -ne 0 ]]; then
    printf 'Perlu sudo untuk memasang systemd unit. Jalankan sudo %s --service\n' "$0" >&2
    exit 1
  fi
  cat > "$UNIT_DIR/pansa.service" <<EOF
[Unit]
Description=Pansa personal assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SUDO_USER:-$(id -un)}
WorkingDirectory=$PREFIX
Environment=PANSA_HOME=$PANSA_HOME
EnvironmentFile=$ENV_FILE
ExecStart=$BIN_DIR/pansa serve
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  systemd-analyze verify "$UNIT_DIR/pansa.service"
  if [[ "${PANSA_NO_START:-0}" != 1 ]]; then
    systemctl daemon-reload
    systemctl enable --now pansa.service
  fi
fi
printf 'Pansa terpasang di %s; PANSA_HOME=%s\n' "$PREFIX" "$PANSA_HOME"
