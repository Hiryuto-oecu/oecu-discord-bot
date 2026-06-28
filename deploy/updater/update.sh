#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${OECU_BOT_UPDATER_ENV:-/etc/oecu-bot-updater.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

COMPOSE_DIR="${COMPOSE_DIR:?COMPOSE_DIR is required}"
DATA_DIR="${DATA_DIR:?DATA_DIR is required}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-oecu-bot}"
CONTAINER_NAME="${CONTAINER_NAME:-oecu-bot}"
OECU_BOT_IMAGE="${OECU_BOT_IMAGE:-ghcr.io/hiryuto-oecu/oecu-discord-bot}"
PROD_IMAGE_TAG="${PROD_IMAGE_TAG:-latest}"
DEV_IMAGE_TAG="${DEV_IMAGE_TAG:-dev}"
MODE_STATE_FILE="${MODE_STATE_FILE:-$DATA_DIR/mode_state.json}"
UPDATE_STATUS_FILE="${UPDATE_STATUS_FILE:-$DATA_DIR/update_status.json}"
HEALTHCHECK_TIMEOUT_SECONDS="${HEALTHCHECK_TIMEOUT_SECONDS:-180}"
HEALTHCHECK_POLL_SECONDS="${HEALTHCHECK_POLL_SECONDS:-5}"
ROLLBACK_TAG_PREFIX="${ROLLBACK_TAG_PREFIX:-rollback}"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

get_image_info() {
  local ref="$1"
  local config_image="$2"

  if [[ -z "$ref" ]]; then
    printf '%s\n' "$config_image"
    return
  fi

  local commit
  commit="$(docker inspect -f '{{if and .Config .Config.Labels}}{{index .Config.Labels "org.opencontainers.image.revision"}}{{end}}' "$ref" 2>/dev/null || true)"

  if [[ -z "$commit" || "$commit" == "<no value>" ]]; then
    if [[ "$ref" =~ ^sha256:([0-9a-fA-F]{12}) ]]; then
      commit="${BASH_REMATCH[1]}"
    elif [[ "$ref" =~ ^([0-9a-fA-F]{12}) ]]; then
      commit="${BASH_REMATCH[1]}"
    else
      local image_id
      image_id="$(docker inspect -f '{{.Id}}' "$ref" 2>/dev/null || true)"
      if [[ "$image_id" =~ ^sha256:([0-9a-fA-F]{12}) ]]; then
        commit="${BASH_REMATCH[1]}"
      elif [[ -n "$image_id" ]]; then
        commit="${image_id#sha256:}"
        commit="${commit:0:12}"
      else
        commit="unknown"
      fi
    fi
  else
    commit="${commit:0:7}"
  fi

  if [[ -n "$config_image" ]]; then
    printf '%s (%s)\n' "$config_image" "$commit"
  else
    printf '%s (%s)\n' "$ref" "$commit"
  fi
}

write_status() {
  local result="$1"
  local mode="$2"
  local tag="$3"
  local message="$4"
  local previous_image="${5:-}"
  local current_image="${6:-}"
  mkdir -p "$(dirname "$UPDATE_STATUS_FILE")"
  local escaped_message escaped_previous escaped_current
  escaped_message="$(printf '%s' "$message" | json_escape)"
  escaped_previous="$(printf '%s' "$previous_image" | json_escape)"
  escaped_current="$(printf '%s' "$current_image" | json_escape)"
  cat > "$UPDATE_STATUS_FILE.tmp" <<JSON
{
  "id": "$RUN_ID",
  "result": "$result",
  "mode": "$mode",
  "target_tag": "$tag",
  "started_at": "$STARTED_AT",
  "finished_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "message": $escaped_message,
  "previous_image": $escaped_previous,
  "current_image": $escaped_current
}
JSON
  mv "$UPDATE_STATUS_FILE.tmp" "$UPDATE_STATUS_FILE"
}

read_mode() {
  if [[ -f "$MODE_STATE_FILE" ]]; then
    local mode
    mode="$(grep -E '"mode"[[:space:]]*:' "$MODE_STATE_FILE" | head -n1 | sed -E 's/.*"mode"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
    if [[ "$mode" == "dev" || "$mode" == "prod" ]]; then
      printf '%s\n' "$mode"
      return
    fi
  fi
  printf 'prod\n'
}

sync_timers() {
  local mode="$1"
  if ! command -v systemctl >/dev/null 2>&1; then
    return 0
  fi
  if [[ "$mode" == "dev" ]]; then
    systemctl disable --now oecu-bot-update.timer >/dev/null 2>&1 || true
    systemctl enable --now oecu-bot-update-dev.timer >/dev/null 2>&1 || true
  else
    systemctl disable --now oecu-bot-update-dev.timer >/dev/null 2>&1 || true
    systemctl enable --now oecu-bot-update.timer >/dev/null 2>&1 || true
  fi
}

compose() {
  (cd "$COMPOSE_DIR" && OECU_BOT_IMAGE_REF="$1" docker compose "${@:2}")
}

container_image_id() {
  docker inspect -f '{{.Image}}' "$CONTAINER_NAME" 2>/dev/null || true
}

container_config_image() {
  docker inspect -f '{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true
}

image_id_for_ref() {
  docker inspect -f '{{.Id}}' "$1" 2>/dev/null || true
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTHCHECK_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    local status running
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ -z "$status" && "$running" == "true" ]]; then
      return 0
    fi
    sleep "$HEALTHCHECK_POLL_SECONDS"
  done
  return 1
}

require_commands() {
  local missing=()
  for cmd in docker python3 grep sed date; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if (( ${#missing[@]} )); then
    log "Missing required commands: ${missing[*]}"
    exit 1
  fi
}

main() {
  require_commands
  mkdir -p "$DATA_DIR"

  local mode tag target_ref previous_image_id previous_config_image target_image_id current_image rollback_ref rollback_result
  mode="$(read_mode)"
  tag="$PROD_IMAGE_TAG"
  if [[ "$mode" == "dev" ]]; then
    tag="$DEV_IMAGE_TAG"
  fi
  target_ref="$OECU_BOT_IMAGE:$tag"
  sync_timers "$mode"

  log "Update check started: mode=$mode target=$target_ref"
  previous_image_id="$(container_image_id)"
  previous_config_image="$(container_config_image)"

  local prev_info
  prev_info="$(get_image_info "$previous_image_id" "$previous_config_image")"

  write_status "starting" "$mode" "$tag" "update process started" "$prev_info" ""

  log "Pulling $target_ref"
  if ! compose "$target_ref" pull "$COMPOSE_SERVICE"; then
    write_status "failure" "$mode" "$tag" "docker compose pull failed" "$prev_info" ""
    exit 1
  fi

  local target_info
  target_info="$(get_image_info "$target_ref" "")"

  target_image_id="$(image_id_for_ref "$target_ref")"
  if [[ -n "$previous_image_id" && -n "$target_image_id" && "$previous_image_id" == "$target_image_id" && "$previous_config_image" == "$target_ref" ]]; then
    write_status "noop" "$mode" "$tag" "image digest unchanged" "$prev_info" "$target_info"
    log "No update needed: image digest unchanged"
    exit 0
  fi

  if [[ -n "$previous_image_id" && -n "$target_image_id" && "$previous_image_id" == "$target_image_id" ]]; then
    log "Image digest is unchanged, but container image reference is '$previous_config_image'; recreating with '$target_ref'"
  fi

  log "Starting $COMPOSE_SERVICE with $target_ref"
  if ! compose "$target_ref" up -d "$COMPOSE_SERVICE"; then
    write_status "failure" "$mode" "$tag" "docker compose up failed" "$prev_info" "$target_info"
    exit 1
  fi

  if wait_healthy; then
    local curr_info
    curr_info="$(get_image_info "$(container_image_id)" "$(container_config_image)")"
    write_status "success" "$mode" "$tag" "update completed" "$prev_info" "$curr_info"
    log "Update completed successfully"
    exit 0
  fi

  log "Healthcheck failed for $target_ref"
  if [[ -n "$previous_image_id" ]]; then
    rollback_ref="$OECU_BOT_IMAGE:${ROLLBACK_TAG_PREFIX}-${RUN_ID}"
    log "Tagging previous image for rollback: $rollback_ref"
    docker tag "$previous_image_id" "$rollback_ref"
    log "Rolling back to $rollback_ref"
    if compose "$rollback_ref" up -d "$COMPOSE_SERVICE" && wait_healthy; then
      local curr_info
      curr_info="$(get_image_info "$(container_image_id)" "$(container_config_image)")"
      write_status "rollback" "$mode" "$tag" "new image failed healthcheck; rollback completed" "$prev_info" "$curr_info"
      log "Rollback completed"
      exit 0
    fi
    rollback_result="rollback attempted but healthcheck failed"
  else
    rollback_result="no previous image was available for rollback"
  fi

  write_status "failure" "$mode" "$tag" "new image failed healthcheck; $rollback_result" "$prev_info" "$target_info"
  exit 1
}

main "$@"
