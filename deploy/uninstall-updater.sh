#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo bash deploy/uninstall-updater.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/oecu-bot-updater}"
MANIFEST_FILE="${MANIFEST_FILE:-$INSTALL_DIR/install-manifest.json}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
ENV_FILE="${ENV_FILE:-/etc/oecu-bot-updater.env}"
COMPOSE_DIR="${COMPOSE_DIR:-$REPO_ROOT}"
DATA_DIR="${DATA_DIR:-$COMPOSE_DIR/data}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-ghcr.io/hiryuto-oecu/oecu-discord-bot}"
UNITS=(oecu-bot-update.service oecu-bot-update.timer oecu-bot-update-dev.timer oecu-bot-update.path)
STATE_FILES=(
  "$DATA_DIR/update_trigger.json"
  "$DATA_DIR/mode_state.json"
  "$DATA_DIR/update_status.json"
  "$DATA_DIR/update_notify_state.json"
  "$DATA_DIR/heartbeat.json"
)
BOT_DATA_FILES=(
  "$DATA_DIR/change.json"
  "$DATA_DIR/janken_leaderboard.json"
  "$DATA_DIR/output.json"
  "$DATA_DIR/twitter_fix_data.json"
  "$DATA_DIR/verify.json"
)

DO_SYSTEMD=0
DO_FILES=0
DO_CONFIG=0
DO_IMAGES=0
DO_STATE=0
DO_LOGS=0
DO_DATA=0
DRY_RUN=0
YES=0
ANY_CATEGORY=0
KEEP_CONFIG=0

run() {
  if (( DRY_RUN )); then
    printf '[dry-run] %q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

rm_path() {
  local path="$1"
  if [[ -e "$path" || -L "$path" ]]; then
    run rm -rf -- "$path"
  fi
}

ask_yes_no() {
  local prompt="$1" default="$2" answer
  if (( YES )); then
    [[ "$default" == "yes" ]]
    return
  fi
  local suffix='[y/N]'
  [[ "$default" == "yes" ]] && suffix='[Y/n]'
  read -r -p "$prompt $suffix " answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

load_manifest() {
  if [[ -f "$MANIFEST_FILE" ]] && command -v python3 >/dev/null 2>&1; then
    mapfile -t manifest_lines < <(python3 - "$MANIFEST_FILE" <<'PY'
import json, sys
m=json.load(open(sys.argv[1], encoding='utf-8'))
for key in ('compose_dir','data_dir','install_dir','env_file','image_repository'):
    if m.get(key): print(f'{key}={m[key]}')
PY
)
    for line in "${manifest_lines[@]}"; do
      case "$line" in
        compose_dir=*) COMPOSE_DIR="${line#compose_dir=}" ;;
        data_dir=*) DATA_DIR="${line#data_dir=}" ;;
        install_dir=*) INSTALL_DIR="${line#install_dir=}" ;;
        env_file=*) ENV_FILE="${line#env_file=}" ;;
        image_repository=*) IMAGE_REPOSITORY="${line#image_repository=}" ;;
      esac
    done
    STATE_FILES=(
      "$DATA_DIR/update_trigger.json"
      "$DATA_DIR/mode_state.json"
      "$DATA_DIR/update_status.json"
      "$DATA_DIR/update_notify_state.json"
      "$DATA_DIR/heartbeat.json"
    )
    BOT_DATA_FILES=(
      "$DATA_DIR/change.json"
      "$DATA_DIR/janken_leaderboard.json"
      "$DATA_DIR/output.json"
      "$DATA_DIR/twitter_fix_data.json"
      "$DATA_DIR/verify.json"
    )
  fi
}

usage() {
  cat <<USAGE
Usage: sudo bash deploy/uninstall-updater.sh [options]

Interactive mode is used when no category option is provided on a TTY.

Options:
  --all              Remove updater systemd/files/config/images/state/logs (not bot business data)
  --systemd          Remove systemd units and enable links
  --files            Remove updater install directory under /opt
  --config           Remove config files such as /etc/oecu-bot-updater.env
  --keep-config      Keep config files even with --all
  --images           Remove Docker images from $IMAGE_REPOSITORY when possible
  --state            Remove updater runtime state files under data/
  --logs             Vacuum archived journald logs (global journal vacuum; use with care)
  --data             Also remove bot business data files (dangerous; asks twice unless --yes)
  --dry-run          Show actions without deleting anything
  --yes              Non-interactive confirmation
  -h, --help         Show this help
USAGE
}

while (($#)); do
  case "$1" in
    --all) DO_SYSTEMD=1; DO_FILES=1; DO_CONFIG=1; DO_IMAGES=1; DO_STATE=1; DO_LOGS=1; ANY_CATEGORY=1 ;;
    --systemd) DO_SYSTEMD=1; ANY_CATEGORY=1 ;;
    --files) DO_FILES=1; ANY_CATEGORY=1 ;;
    --config) DO_CONFIG=1; ANY_CATEGORY=1 ;;
    --keep-config) KEEP_CONFIG=1 ;;
    --images) DO_IMAGES=1; ANY_CATEGORY=1 ;;
    --state) DO_STATE=1; ANY_CATEGORY=1 ;;
    --logs) DO_LOGS=1; ANY_CATEGORY=1 ;;
    --data) DO_DATA=1; ANY_CATEGORY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --yes) YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift
done

load_manifest
if (( KEEP_CONFIG )); then
  DO_CONFIG=0
fi

if (( ! ANY_CATEGORY )); then
  if [[ -t 0 ]]; then
    echo "Select uninstall targets. Config files are kept by default."
    ask_yes_no "Remove systemd units/timers/path?" yes && DO_SYSTEMD=1
    ask_yes_no "Remove updater files under $INSTALL_DIR?" yes && DO_FILES=1
    ask_yes_no "Remove config file $ENV_FILE?" no && DO_CONFIG=1
    ask_yes_no "Remove updater runtime state files in $DATA_DIR?" yes && DO_STATE=1
    ask_yes_no "Remove Docker images for $IMAGE_REPOSITORY?" no && DO_IMAGES=1
    ask_yes_no "Vacuum archived journald logs? This can affect archived logs globally." no && DO_LOGS=1
    if ask_yes_no "Remove bot business data files (verify.json etc.)? DANGEROUS" no; then
      ask_yes_no "Really remove bot business data?" no && DO_DATA=1
    fi
  else
    echo "No category selected and stdin is not a TTY. Use --all or category flags." >&2
    exit 1
  fi
fi

if (( DO_SYSTEMD )); then
  for unit in "${UNITS[@]}"; do
    run systemctl disable --now "$unit" || true
  done
  for unit in "${UNITS[@]}"; do
    rm_path "$SYSTEMD_DIR/$unit"
  done
  run systemctl daemon-reload
  run systemctl reset-failed "${UNITS[@]}" || true
fi

if (( DO_STATE )); then
  for file in "${STATE_FILES[@]}"; do
    rm_path "$file"
  done
fi

if (( DO_DATA )); then
  if (( YES )) || ask_yes_no "Final confirmation: delete bot business data files?" no; then
    for file in "${BOT_DATA_FILES[@]}"; do
      rm_path "$file"
    done
  fi
fi

if (( DO_IMAGES )); then
  if command -v docker >/dev/null 2>&1; then
    mapfile -t image_refs < <(docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E "^${IMAGE_REPOSITORY//\//\/}:(latest|dev|[0-9a-f]{7,40}|rollback-)" || true)
    for ref in "${image_refs[@]}"; do
      [[ -n "$ref" ]] && run docker image rm "$ref" || true
    done
    run docker image prune -f || true
  fi
fi

if (( DO_LOGS )); then
  echo "Warning: journald vacuum is global for archived journal files, not per-unit." >&2
  run journalctl --rotate || true
  run journalctl --vacuum-time=1s || true
fi

if (( DO_CONFIG )); then
  rm_path "$ENV_FILE"
elif [[ -e "$ENV_FILE" ]]; then
  echo "Kept config: $ENV_FILE"
fi

if (( DO_FILES )); then
  rm_path "$INSTALL_DIR"
fi

residual=()
if (( DO_SYSTEMD )); then
  for unit in "${UNITS[@]}"; do
    [[ -e "$SYSTEMD_DIR/$unit" || -L "$SYSTEMD_DIR/$unit" ]] && residual+=("$SYSTEMD_DIR/$unit")
  done
fi
if (( DO_FILES )); then
  [[ -e "$INSTALL_DIR" || -L "$INSTALL_DIR" ]] && residual+=("$INSTALL_DIR")
fi
if (( DO_CONFIG )); then
  [[ -e "$ENV_FILE" || -L "$ENV_FILE" ]] && residual+=("$ENV_FILE")
fi
if (( DO_STATE )); then
  for file in "${STATE_FILES[@]}"; do
    [[ -e "$file" || -L "$file" ]] && residual+=("$file")
  done
fi

if (( ${#residual[@]} )); then
  echo "Uninstall completed, but residual paths remain:" >&2
  printf ' - %s\n' "${residual[@]}" >&2
  exit 2
fi

echo "Uninstall completed. Selected targets have no residual files."
