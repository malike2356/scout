#!/usr/bin/env bash
# Enable scout-engine systemd user service at boot (no cron).
# Run once on the VPS with sudo:
#   bash /home/malike/apps/scout-engine/deploy/enable-boot.sh
set -euo pipefail

TARGET_USER="${1:-${USER:-malike}}"
ENGINE_DIR="/home/${TARGET_USER}/apps/scout-engine"
USER_UNIT="/home/${TARGET_USER}/.config/systemd/user/scout-engine.service"
CRON_MARK="# scout-engine ensure-running"

if [[ "$(id -un)" != "${TARGET_USER}" && "$(id -un)" != "root" ]]; then
  echo "Run as ${TARGET_USER} or root." >&2
  exit 1
fi

run_as_user() {
  if [[ "$(id -un)" == "${TARGET_USER}" ]]; then
    "$@"
  else
    sudo -u "${TARGET_USER}" "$@"
  fi
}

echo "Enabling linger for ${TARGET_USER}..."
sudo loginctl enable-linger "${TARGET_USER}"

mkdir -p "/home/${TARGET_USER}/.config/systemd/user"
if [[ ! -f "${USER_UNIT}" ]]; then
  cp "${ENGINE_DIR}/deploy/scout-engine.service" "${USER_UNIT}"
fi

run_as_user systemctl --user daemon-reload
run_as_user systemctl --user enable scout-engine
run_as_user systemctl --user restart scout-engine

echo "Removing scout-engine cron fallback (if present)..."
TMP_CRON="$(mktemp)"
run_as_user crontab -l 2>/dev/null \
  | grep -Fv "${CRON_MARK}" \
  | grep -Fv "${ENGINE_DIR}/deploy/ensure-running.sh" > "${TMP_CRON}" || true
run_as_user crontab "${TMP_CRON}" 2>/dev/null || true
rm -f "${TMP_CRON}"

echo ""
echo "Linger: $(loginctl show-user "${TARGET_USER}" -p Linger --value)"
run_as_user systemctl --user status scout-engine --no-pager | head -6
echo ""
echo "Done. scout-engine will start at boot via systemd (Restart=always on crash)."
