#!/usr/bin/env bash
# Run as agent on the box. Installs or updates Claude Code and Cursor CLI in
# ~/.local and (re)starts the Remote Control service. Safe to run again.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash
command -v cursor-agent >/dev/null || curl -fsS https://cursor.com/install | bash
# Rex server, in agent's own Nix profile (upgrade: nix profile upgrade --all).
command -v rex >/dev/null || nix profile add https://pkgs.superlogical.com/rex/nix/preview.tar.gz
if [ ! -e ~/.config/systemd/user/rex.socket ]; then
  rex server install
  # Run the profile's rex, not the store path install wrote, so upgrades apply.
  sed -i "s|/nix/store/[a-z0-9]*-rex-[^/]*/bin/rex|%h/.nix-profile/bin/rex|g" \
    ~/.config/systemd/user/rex.service ~/.config/systemd/user/rex.socket
fi

mkdir -p ~/.config/systemd/user
install -m 0644 "$here/claude-rc.service" ~/.config/systemd/user/claude-rc.service
systemctl --user daemon-reload
systemctl --user enable --now claude-rc.service
systemctl --user restart claude-rc.service
systemctl --user --no-pager status claude-rc.service | head -5
