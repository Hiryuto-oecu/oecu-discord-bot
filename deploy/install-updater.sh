#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo bash deploy/install-updater.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$REPO_ROOT}"
DATA_DIR="${DATA_DIR:-$COMPOSE_DIR/data}"
INSTALL_DIR="${INSTALL_DIR:-/opt/oecu-bot-updater}"
ENV_FILE="${ENV_FILE:-/etc/oecu-bot-updater.env}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
MANIFEST_FILE="$INSTALL_DIR/install-manifest.json"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

escape_sed() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

render_template() {
  local src="$1" dst="$2"
  local compose_escaped data_escaped
  compose_escaped="$(escape_sed "$COMPOSE_DIR")"
  data_escaped="$(escape_sed "$DATA_DIR")"
  sed \
    -e "s/@COMPOSE_DIR@/$compose_escaped/g" \
    -e "s/@DATA_DIR@/$data_escaped/g" \
    "$src" > "$dst"
}

for cmd in bash docker systemctl python3 sed install; do
  need "$cmd"
done

if [[ ! -f "$COMPOSE_DIR/docker-compose.yml" ]]; then
  echo "docker-compose.yml was not found in COMPOSE_DIR: $COMPOSE_DIR" >&2
  exit 1
fi

install -d -m 0755 "$INSTALL_DIR"
install -d -m 0755 "$DATA_DIR"
install -m 0755 "$SCRIPT_DIR/updater/update.sh" "$INSTALL_DIR/update.sh"

if [[ ! -f "$ENV_FILE" ]]; then
  render_template "$SCRIPT_DIR/updater/oecu-bot-updater.env.example" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
else
  echo "Keeping existing config: $ENV_FILE"
fi

for unit in oecu-bot-update.service oecu-bot-update.timer oecu-bot-update-dev.timer oecu-bot-update.path; do
  render_template "$SCRIPT_DIR/systemd/$unit" "$SYSTEMD_DIR/$unit"
  chmod 0644 "$SYSTEMD_DIR/$unit"
done

if [[ ! -f "$DATA_DIR/mode_state.json" ]]; then
  cat > "$DATA_DIR/mode_state.json" <<JSON
{
  "mode": "prod",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "updated_by": "install-updater"
}
JSON
fi

if [[ ! -f "$DATA_DIR/update_trigger.json" ]]; then
  cat > "$DATA_DIR/update_trigger.json" <<JSON
{
  "id": "install-$(date -u +%Y%m%dT%H%M%SZ)",
  "requested_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "requested_by": "install-updater",
  "mode": "prod"
}
JSON
fi

python3 - "$MANIFEST_FILE" "$COMPOSE_DIR" "$DATA_DIR" "$INSTALL_DIR" "$ENV_FILE" "$SYSTEMD_DIR" <<'PY'
import json, sys, datetime
manifest_file, compose_dir, data_dir, install_dir, env_file, systemd_dir = sys.argv[1:]
units = [
    'oecu-bot-update.service',
    'oecu-bot-update.timer',
    'oecu-bot-update-dev.timer',
    'oecu-bot-update.path',
]
manifest = {
    'schema': 1,
    'installed_at': datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z',
    'compose_dir': compose_dir,
    'data_dir': data_dir,
    'install_dir': install_dir,
    'env_file': env_file,
    'systemd_dir': systemd_dir,
    'units': units,
    'files': [
        f'{install_dir}/update.sh',
        env_file,
        *[f'{systemd_dir}/{unit}' for unit in units],
    ],
    'dirs': [install_dir],
    'state_files': [
        f'{data_dir}/update_trigger.json',
        f'{data_dir}/mode_state.json',
        f'{data_dir}/update_status.json',
        f'{data_dir}/update_notify_state.json',
        f'{data_dir}/heartbeat.json',
    ],
    'image_repository': 'ghcr.io/hiryuto-oecu/oecu-discord-bot',
}
with open(manifest_file, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
chmod 0644 "$MANIFEST_FILE"

systemctl daemon-reload
systemctl enable --now oecu-bot-update.path
systemctl enable --now oecu-bot-update.timer
systemctl disable --now oecu-bot-update-dev.timer >/dev/null 2>&1 || true

echo "Installed oecu-bot updater."
echo "COMPOSE_DIR=$COMPOSE_DIR"
echo "DATA_DIR=$DATA_DIR"
echo "Config: $ENV_FILE"
echo "Manifest: $MANIFEST_FILE"
echo "Check with: systemctl status oecu-bot-update.path oecu-bot-update.timer"
