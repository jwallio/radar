#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wallcloud-radar}"
REPO_URL="${REPO_URL:-https://github.com/jwallio/radar.git}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/vps/install-ubuntu.sh"
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates git python3 python3-venv python3-dev build-essential \
  libeccodes-dev libproj-dev proj-data proj-bin

if [[ ! -e /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin main
  git -C "$APP_DIR" checkout main
  git -C "$APP_DIR" pull --ff-only origin main
fi

id wallcloud >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin wallcloud
mkdir -p "$APP_DIR/.radar-tmp" /var/lib/wallcloud-radar
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip wheel
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements-vps.txt"
chown -R wallcloud:wallcloud "$APP_DIR" /var/lib/wallcloud-radar

install -m 0644 "$APP_DIR/deploy/vps/wallcloud-radar-refresh.service" /etc/systemd/system/wallcloud-radar-refresh.service
install -m 0644 "$APP_DIR/deploy/vps/wallcloud-radar-refresh.timer" /etc/systemd/system/wallcloud-radar-refresh.timer
if [[ ! -f /etc/wallcloud-radar.env ]]; then
  install -m 0600 "$APP_DIR/deploy/vps/radar-worker.env.example" /etc/wallcloud-radar.env
  echo "Edit /etc/wallcloud-radar.env with R2 credentials before starting the timer."
fi

systemctl daemon-reload
systemctl enable wallcloud-radar-refresh.timer
systemctl restart wallcloud-radar-refresh.timer
echo "Installed. Run: systemctl start wallcloud-radar-refresh.service"
echo "Logs: journalctl -u wallcloud-radar-refresh.service -f"
