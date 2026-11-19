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

if [[ "$(uname -s)" != Linux ]]; then
  printf 'Installer VPS saat ini mendukung Linux.\n' >&2
  exit 1
fi
if [[ "$SERVICE" == true ]] && { ! command -v systemctl >/dev/null 2>&1 || ! command -v systemd-analyze >/dev/null 2>&1 || [[ ! -d /run/systemd/system ]]; }; then
  printf 'Mode --service dengan isolasi direktori memerlukan systemd aktif.\n' >&2
  exit 1
fi
if [[ "$SERVICE" == true && "${PANSA_NO_START:-0}" != 1 ]] && [[ $(id -u) -ne 0 ]]; then
  printf 'Perlu sudo untuk memasang systemd unit. Jalankan sudo %s --service\n' "$0" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js >=20.19 dibutuhkan. Instal Node.js 22 LTS dari https://nodejs.org/ lalu jalankan ulang.\n' >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
NODE_MINOR=$(node -p 'Number(process.versions.node.split(".")[1])')
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 19) )); then
  printf 'Node.js >=20.19 dibutuhkan (disarankan Node 22 LTS); versi aktif: %s\n' "$(node -v)" >&2
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
TARGET_USER=${PANSA_SERVICE_USER:-${SUDO_USER:-$(id -un)}}
if [[ "$SERVICE" == true && "$TARGET_USER" == root ]]; then
  printf 'Service harus memakai akun non-root. Jalankan sudo dari akun user atau tetapkan PANSA_SERVICE_USER.\n' >&2
  exit 1
fi
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
TARGET_HOME=${TARGET_HOME:-$HOME}
PANSA_HOME=${PANSA_HOME:-$TARGET_HOME/.pansa}

mkdir -p "$(dirname "$PREFIX")" "$BIN_DIR" "$PANSA_HOME"
chmod 700 "$PANSA_HOME"
mkdir -p "$PANSA_HOME/workspace"
mkdir -p "$PANSA_HOME/skills" "$PANSA_HOME/plugins"
if [[ -d "$PREFIX/skills" ]]; then rsync -a --ignore-existing "$PREFIX/skills/" "$PANSA_HOME/skills/"; fi
if ! command -v rsync >/dev/null 2>&1; then
  printf 'rsync diperlukan untuk menyalin instalasi.\n' >&2
  exit 1
fi
STAGE=$(mktemp -d "$(dirname "$PREFIX")/.pansaos-stage.XXXXXX")
BACKUP=""
UNIT_BACKUP=""
UNIT_FILE=""
finish_install() {
  local status=$?
  if (( status != 0 )) && [[ -n "$UNIT_FILE" ]]; then
    if [[ -n "$UNIT_BACKUP" ]]; then cp -p "$UNIT_BACKUP" "$UNIT_FILE"; else rm -f -- "$UNIT_FILE"; fi
  fi
  if (( status != 0 )) && [[ -n "$BACKUP" && -d "$BACKUP" ]]; then
    if [[ "$SERVICE" == true && "${PANSA_NO_START:-0}" != 1 ]]; then systemctl stop pansa.service 2>/dev/null || true; fi
    if [[ -d "$PREFIX" ]]; then mv "$PREFIX" "$STAGE"; fi
    mv "$BACKUP" "$PREFIX"
    if [[ "$SERVICE" == true && "${PANSA_NO_START:-0}" != 1 ]]; then
      systemctl daemon-reload 2>/dev/null || true
      systemctl restart pansa.service 2>/dev/null || true
    fi
  fi
  if [[ -n "$STAGE" && -d "$STAGE" ]]; then rm -rf -- "$STAGE"; fi
  if [[ -n "$UNIT_BACKUP" ]]; then rm -f -- "$UNIT_BACKUP"; fi
}
trap finish_install EXIT
rsync -a --exclude node_modules --exclude .next --exclude data --exclude workspace --exclude .git --exclude .env "$SOURCE/" "$STAGE/"
if [[ -d "$PREFIX/data" ]]; then rsync -a "$PREFIX/data/" "$STAGE/data/"; fi
if [[ -d "$PREFIX/workspace" ]]; then rsync -a "$PREFIX/workspace/" "$STAGE/workspace/"; fi
if [[ -d "$PREFIX/.git" ]]; then rsync -a "$PREFIX/.git/" "$STAGE/.git/"; fi
cd "$STAGE"
NODE_BIN_DIR=$(dirname "$(readlink -f "$(command -v node)")")
export npm_config_nodedir=$(dirname "$NODE_BIN_DIR")
npm install --no-audit --no-fund
npm rebuild better-sqlite3 esbuild
npm run build
mkdir -p apps/dashboard/.next/standalone/apps/dashboard/.next/static
if [[ -d apps/dashboard/.next/static ]]; then cp -a apps/dashboard/.next/static/. apps/dashboard/.next/standalone/apps/dashboard/.next/static/; fi
if [[ -d apps/dashboard/public ]]; then mkdir -p apps/dashboard/.next/standalone/apps/dashboard/public; cp -a apps/dashboard/public/. apps/dashboard/.next/standalone/apps/dashboard/public/; fi
chmod 755 "$STAGE"

if [[ -e "$PREFIX" ]]; then
  BACKUP=$(mktemp -d "${PREFIX}.backup.XXXXXX")
  rmdir "$BACKUP"
  mv "$PREFIX" "$BACKUP"
fi
if ! mv "$STAGE" "$PREFIX"; then
  if [[ -n "$BACKUP" ]]; then mv "$BACKUP" "$PREFIX"; fi
  printf 'Gagal mengaktifkan build baru; instalasi sebelumnya dipertahankan.\n' >&2
  exit 1
fi
STAGE=$(mktemp -d "$(dirname "$PREFIX")/.pansaos-failed.XXXXXX")
rmdir "$STAGE"

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
ensure_env WORKSPACE_ALLOWLIST "$PANSA_HOME/workspace"
ensure_env PUBLIC_URL http://localhost:3000
ensure_env PORT 3001
ensure_env DASHBOARD_PORT 3000
ensure_env SKILLS_DIR "$PANSA_HOME/skills"
ensure_env PLUGINS_DIR "$PANSA_HOME/plugins"

ln -sfn "$PREFIX/apps/core/dist/cli.js" "$BIN_DIR/pansa"
chmod +x "$PREFIX/apps/core/dist/cli.js"
if [[ $(id -u) -eq 0 && "$TARGET_USER" != root ]]; then
  chown -R "$TARGET_USER":"$(id -gn "$TARGET_USER")" "$PANSA_HOME"
  chown "$TARGET_USER":"$(id -gn "$TARGET_USER")" "$ENV_FILE"
fi
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) printf 'Tambahkan %s ke PATH untuk menggunakan pansa.\n' "$BIN_DIR" ;; esac

if [[ "$SERVICE" == true ]]; then
  UNIT_DIR=${PANSA_UNIT_DIR:-/etc/systemd/system}
  mkdir -p "$UNIT_DIR"
  if [[ ! -w "$UNIT_DIR" && $(id -u) -ne 0 ]]; then
    printf 'Perlu sudo untuk memasang systemd unit. Jalankan sudo %s --service\n' "$0" >&2
    exit 1
  fi
  WORKSPACE_DIR_VALUE=$(sed -n 's/^WORKSPACE_DIR=//p' "$ENV_FILE" | tail -n 1)
  ALLOWLIST_VALUE=$(sed -n 's/^WORKSPACE_ALLOWLIST=//p' "$ENV_FILE" | tail -n 1)
  WORKSPACE_DIR_VALUE=${WORKSPACE_DIR_VALUE:-$PANSA_HOME/workspace}
  ALLOWLIST_VALUE=${ALLOWLIST_VALUE:-$WORKSPACE_DIR_VALUE}
  IFS=, read -r -a ALLOWED_DIRS <<< "$ALLOWLIST_VALUE"
  BIND_DIRS=()
  for allowed_dir in "$PANSA_HOME" "$WORKSPACE_DIR_VALUE" "${ALLOWED_DIRS[@]}"; do
    allowed_dir="${allowed_dir#"${allowed_dir%%[![:space:]]*}"}"
    allowed_dir="${allowed_dir%"${allowed_dir##*[![:space:]]}"}"
    [[ -n "$allowed_dir" ]] || continue
    allowed_dir=$(realpath -m "$allowed_dir")
    if [[ ! -d "$allowed_dir" ]]; then
      printf 'Direktori yang diizinkan tidak ditemukan: %s\n' "$allowed_dir" >&2
      exit 1
    fi
    if [[ ! " ${BIND_DIRS[*]} " == *" $allowed_dir "* ]]; then BIND_DIRS+=("$allowed_dir"); fi
  done
  quote_unit_path() {
    local escaped=${1//\\/\\\\}
    escaped=${escaped//\"/\\\"}
    printf '"%s"' "$escaped"
  }
  BIND_PATHS=""
  for allowed_dir in "${BIND_DIRS[@]}"; do BIND_PATHS+=" $(quote_unit_path "$allowed_dir")"; done
  NODE_BIND_PATH=$(quote_unit_path "$NODE_BIN_DIR")
  UNIT_FILE="$UNIT_DIR/pansa.service"
  if [[ -f "$UNIT_FILE" ]]; then
    UNIT_BACKUP=$(mktemp "$UNIT_DIR/.pansa-unit-backup.XXXXXX")
    cp -p "$UNIT_FILE" "$UNIT_BACKUP"
  fi
  cat > "$UNIT_DIR/pansa.service" <<EOF
[Unit]
Description=Pansa personal assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$TARGET_USER
WorkingDirectory=$PREFIX
Environment=PANSA_HOME=$PANSA_HOME
Environment=PATH=$NODE_BIN_DIR:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=$ENV_FILE
ExecStart=$BIN_DIR/pansa serve
Restart=always
RestartSec=5
NoNewPrivileges=true
CapabilityBoundingSet=
PrivateTmp=true
ProtectSystem=strict
ProtectHome=tmpfs
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
PrivateDevices=true
RestrictSUIDSGID=true
BindPaths=$BIND_PATHS
ReadWritePaths=$BIND_PATHS
BindReadOnlyPaths=$NODE_BIND_PATH $(quote_unit_path "$PREFIX")

[Install]
WantedBy=multi-user.target
EOF
  systemd-analyze verify "$UNIT_DIR/pansa.service"
  if [[ "${PANSA_NO_START:-0}" != 1 ]]; then
    systemctl daemon-reload
    systemctl enable pansa.service
    if ! systemctl restart pansa.service; then
      printf 'Service gagal start; mengembalikan instalasi sebelumnya.\n' >&2
      exit 1
    fi
    sleep 2
    if ! systemctl is-active --quiet pansa.service; then
      printf 'Service tidak aktif setelah update; mengembalikan instalasi sebelumnya.\n' >&2
      exit 1
    fi
  fi
fi
if [[ -n "$BACKUP" ]]; then rm -rf "$BACKUP"; fi
BACKUP=""
printf 'Pansa terpasang di %s; PANSA_HOME=%s\n' "$PREFIX" "$PANSA_HOME"
