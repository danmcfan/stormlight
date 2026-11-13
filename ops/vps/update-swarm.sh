#!/usr/bin/env bash
# Deploy the swarm dashboard. Run on the box by CI (over Tailscale SSH) as the
# deploy user, or by hand. Uses a dedicated checkout (default /srv/swarm), NOT
# the agent's clone: agents change branches and leave half-edited files in their
# clone, and a deploy must always build exactly origin/main.
set -euo pipefail

# A non-interactive SSH session on NixOS may lack the system profile and the
# setuid wrappers (sudo) on PATH. Harmless on Ubuntu.
export PATH="/run/wrappers/bin:/run/current-system/sw/bin:$PATH"
# The sudoers rule names absolute paths: /usr/bin on Ubuntu (ops/vps), the
# system profile on NixOS (ops/nixos).
if [ -x /usr/bin/systemctl ]; then BIN=/usr/bin; else BIN=/run/current-system/sw/bin; fi

DEPLOY_DIR="${DEPLOY_DIR:-/srv/swarm}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-swarm}"
PORT="${PORT:-3000}"

cd "$DEPLOY_DIR"
git fetch origin "$BRANCH"
git merge --ff-only "origin/$BRANCH"
git lfs pull || true   # the dashboard needs no LFS files; harmless if absent
echo "deploying $(git rev-parse --short HEAD)"

cd swarm
npm ci
npm run build

sudo -n "$BIN/systemctl" restart "$SERVICE"

for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/swarm" >/dev/null; then
    echo "healthy after ${i}s"
    exit 0
  fi
  sleep 1
done
echo "health check failed" >&2
sudo -n "$BIN/journalctl" -u "$SERVICE" -n 40 --no-pager >&2 || true
exit 1
