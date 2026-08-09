#!/usr/bin/env bash
# Idempotent scout-engine start for @reboot cron and crash watchdog.
set -euo pipefail

ENGINE_DIR="${SCOUT_ENGINE_DIR:-/home/malike/apps/scout-engine}"
LOG_DIR="${SCOUT_LOG_DIR:-/home/malike/logs}"
PID_PATTERN="${ENGINE_DIR}/dist/server.js"

mkdir -p "$LOG_DIR"

if pgrep -f "$PID_PATTERN" >/dev/null 2>&1; then
  exit 0
fi

if [[ ! -f "${ENGINE_DIR}/dist/server.js" ]]; then
  echo "scout-engine binary missing at ${ENGINE_DIR}/dist/server.js" >&2
  exit 1
fi

cd "$ENGINE_DIR"
nohup /usr/bin/node "${ENGINE_DIR}/dist/server.js" \
  >> "${LOG_DIR}/scout-engine.out.log" \
  2>> "${LOG_DIR}/scout-engine.err.log" &

echo "scout-engine started (pid $!)"
