#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu 24.04 (x86_64 or arm64) box for Stormlight agents +
# the swarm dashboard. Run as root. Idempotent: safe to re-run.
#
#   sudo REPO_URL=https://github.com/danmcfan/stormlight.git \
#        TS_AUTHKEY=tskey-auth-... ./bootstrap.sh
#   sudo ./bootstrap.sh --lock-public-ssh     # step 2, once Tailscale SSH works
#
# Variables (all optional): AGENT_USER (agent), DEPLOY_USER (deploy),
# REPO_URL, REPO_BRANCH (main), DEPLOY_DIR (/srv/swarm), TS_HOSTNAME,
# TS_AUTHKEY (a tagged auth key; without it the interactive command is printed),
# TS_TAGS (tag:agent-box; only used with TS_AUTHKEY), NODE_MAJOR (22).
# No secrets live in this file.
set -euo pipefail

AGENT_USER="${AGENT_USER:-agent}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
REPO_URL="${REPO_URL:-https://github.com/danmcfan/stormlight.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
DEPLOY_DIR="${DEPLOY_DIR:-/srv/swarm}"
NODE_MAJOR="${NODE_MAJOR:-22}"
TS_TAGS="${TS_TAGS:-tag:agent-box}"
TS_HOSTNAME="${TS_HOSTNAME:-}"
SERVE_PORT=3000
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

as_agent() { sudo -u "$AGENT_USER" -H bash -lc "$*"; }

# ---- step 2: close public SSH --------------------------------------------
if [ "${1:-}" = "--lock-public-ssh" ]; then
  tailscale status >/dev/null || { echo "tailscale is not up; refusing" >&2; exit 1; }
  ufw delete allow 22/tcp 2>/dev/null || true
  ufw delete allow OpenSSH 2>/dev/null || true
  ufw status verbose
  echo "Public SSH closed. Reach the box with: tailscale ssh ${AGENT_USER}@<machine>"
  echo "If you locked yourself out, use the provider's web console."
  exit 0
fi

# ---- packages ---------------------------------------------------------------
apt-get update
apt-get -y upgrade
apt-get -y install ca-certificates curl gnupg git git-lfs build-essential \
  ufw unattended-upgrades jq sudo
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades

# ---- users --------------------------------------------------------------------
for u in "$AGENT_USER" "$DEPLOY_USER"; do
  id "$u" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$u"
done
# The deploy user (CI over Tailscale SSH) can only restart/inspect the service.
cat > /etc/sudoers.d/swarm-deploy <<SUDO
${DEPLOY_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart swarm, /usr/bin/journalctl -u swarm -n 40 --no-pager
SUDO
chmod 440 /etc/sudoers.d/swarm-deploy
visudo -cf /etc/sudoers.d/swarm-deploy >/dev/null

# ---- Node ---------------------------------------------------------------------
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get -y install nodejs
fi

# ---- Tailscale ----------------------------------------------------------------
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
systemctl enable --now tailscaled

# ---- firewall: nothing public except SSH (until --lock-public-ssh) -----------
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
ufw allow 41641/udp          # direct WireGuard connections (optional but faster)
ufw allow OpenSSH            # removed later by: bootstrap.sh --lock-public-ssh
ufw --force enable

# ---- join the tailnet ---------------------------------------------------------
TS_UP=(tailscale up --ssh)
[ -n "$TS_HOSTNAME" ] && TS_UP+=(--hostname "$TS_HOSTNAME")
if tailscale status >/dev/null 2>&1; then
  echo "tailscale already up"
elif [ -n "${TS_AUTHKEY:-}" ]; then
  "${TS_UP[@]}" --advertise-tags "$TS_TAGS" --auth-key "$TS_AUTHKEY"
else
  echo ">>> Not joined. Run:  ${TS_UP[*]} --advertise-tags ${TS_TAGS}   (open the printed URL)"
fi

# ---- agent toolchain ----------------------------------------------------------
as_agent 'mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global'
as_agent 'grep -q npm-global ~/.profile 2>/dev/null || echo '\''export PATH="$HOME/.npm-global/bin:$PATH"'\'' >> ~/.profile'
as_agent 'command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code'
as_agent 'git lfs install'

REPO_DIR="/home/${AGENT_USER}/stormlight"
if [ ! -d "$REPO_DIR/.git" ]; then
  as_agent "git clone --branch '$REPO_BRANCH' '$REPO_URL' '$REPO_DIR'" || {
    echo ">>> Clone failed (private repo?). Either 'gh auth login' as ${AGENT_USER}, or add a deploy key:"
    echo "    sudo -u ${AGENT_USER} ssh-keygen -t ed25519 -f ~${AGENT_USER}/.ssh/id_ed25519 -N ''"
    echo "    cat ~${AGENT_USER}/.ssh/id_ed25519.pub   # add under repo Settings > Deploy keys (allow write)"
    echo "    then re-run with REPO_URL=git@github.com:danmcfan/stormlight.git"
  }
fi
if [ -d "$REPO_DIR/.git" ]; then
  as_agent "cd '$REPO_DIR' && git lfs pull || true"
  as_agent "cd '$REPO_DIR' && npm ci && (cd swarm && npm ci)"
  # Chromium + its system libraries for the Playwright browser checks.
  (cd "$REPO_DIR" && npx playwright install-deps chromium)  # as root: installs apt libs
  as_agent "cd '$REPO_DIR' && npx playwright install chromium"
fi

# ---- dedicated deploy checkout + service ---------------------------------------
if [ ! -d "$DEPLOY_DIR/.git" ]; then
  mkdir -p "$DEPLOY_DIR"; chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_DIR"
  sudo -u "$DEPLOY_USER" -H git clone --branch "$REPO_BRANCH" "$REPO_URL" "$DEPLOY_DIR" \
    || echo ">>> Deploy checkout failed; give ${DEPLOY_USER} read access to the repo, then re-run."
fi
if [ -d "$DEPLOY_DIR/.git" ]; then
  sudo -u "$DEPLOY_USER" -H bash -lc "cd '$DEPLOY_DIR' && git lfs install --local && cd swarm && npm ci && npm run build"
  sed -e "s|@AGENT_USER@|$AGENT_USER|g" -e "s|@DEPLOY_DIR@|$DEPLOY_DIR|g" \
    "$HERE/swarm.service" > /etc/systemd/system/swarm.service
  systemctl daemon-reload
  systemctl enable swarm
  systemctl restart swarm
fi

# ---- tailnet-only HTTPS (never `funnel`) ---------------------------------------
if tailscale status >/dev/null 2>&1; then
  tailscale serve --bg --https=443 "http://127.0.0.1:${SERVE_PORT}" \
    || echo ">>> tailscale serve failed: enable MagicDNS + HTTPS certificates in the admin console, then re-run."
  tailscale serve status || true
fi

cat <<NEXT

Next, manually:
  1. If not joined:  tailscale up --ssh --advertise-tags ${TS_TAGS}
     (then re-run this script to set up 'tailscale serve').
  2. From your laptop confirm:  tailscale ssh ${AGENT_USER}@<machine>
     then close public SSH:     sudo ./bootstrap.sh --lock-public-ssh
  3. As ${AGENT_USER}:  claude          (log in)
     git config --global user.name "..." ; git config --global user.email "..."
     gh auth login   (or add a deploy key, see above)
  4. Chromium here has no GPU: launch it with
     --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
  5. Turn on the provider's cloud firewall with NO inbound rules as the outer layer.
Dashboard: https://<machine>.<tailnet>.ts.net
NEXT
