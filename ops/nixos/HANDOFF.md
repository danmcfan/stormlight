# Handoff: bring up the agent box (for a local Claude Code session)

You are a Claude Code session on the user's own computer, which can SSH to
their new VPS. The cloud session that wrote this could not (no SSH client, web
proxy only). Read `ops/nixos/README.md` (the full ordered steps) and
`ops/vps/README.md` (Tailscale policy, GitHub secrets), then do the steps below
with the user. Branch: `claude/sleepy-mayer-l4zwra`.

## Goal

A private agent box: Hostinger KVM VPS on the NixOS template (NixOS 26.05),
configured by the flake in `ops/nixos` as `nixosConfigurations.agent-box`. It
runs Claude Code and its agents as user `agent`, and the `swarm` dashboard
(`swarm/`, a service reading `~agent/.claude/projects`), reachable only over
Tailscale at `https://agent-box.<tailnet>.ts.net`. CI deploys the dashboard
over Tailscale SSH as user `deploy` (`.github/workflows/swarm-deploy.yml`,
skipped until the repo variable `SWARM_DEPLOY_HOST` is set).

## State

- Host: `root@179.66.143.221`, reinstalled from Hostinger's NixOS template
  (public SSH open; password or key per the user).
- Done, in the repo, not yet built or booted: `ops/nixos/{flake.nix,
  configuration.nix,host.nix,hardware-configuration.nix}`. Evaluated against
  the nixos-26.05 channel. Eval deliberately fails until the placeholders
  below are filled.
- No `flake.lock` yet; the first build creates it. Commit it.

## Steps

1. Inspect the box (read-only) and show the user the output:
   ```bash
   ssh root@179.66.143.221 'uname -m; nixos-version; nproc; free -h; ls /etc/nixos;
     grep -nE "stateVersion|boot\.loader|grub|efi|networking|cloud-init|networkd" /etc/nixos/*.nix 2>/dev/null;
     [ -d /sys/firmware/efi ] && echo UEFI || echo BIOS; lsblk -f; ip -br addr; ip route | head -3'
   ```
2. Fill the placeholders from that output:
   - `ops/nixos/hardware-configuration.nix`: the box's real file
     (`cat /etc/nixos/hardware-configuration.nix`, or
     `nixos-generate-config --show-hardware-config` if absent). Remove the
     placeholder flag it sets.
   - `ops/nixos/host.nix`: `system.stateVersion` (from the template's
     config, never newer), the boot loader (BIOS GRUB device vs UEFI) and the
     network settings the template uses (cloud-init/networkd, static IP), and
     the user's SSH public key(s) for `agent` (and root, if they want).
3. Copy the repo's `ops/nixos` to the box (e.g. `rsync -a ops/nixos/
   root@179.66.143.221:/etc/nixos/agent-box/`), then on the box:
   `nixos-rebuild test --flake /etc/nixos/agent-box#agent-box` first. Only
   after SSH still works in a NEW connection, `nixos-rebuild switch` with the
   same flake. Keep the current session open as a lifeline while testing.
4. Tailscale (the user does the admin-console parts; never put keys in the
   repo or in chat):
   - The user creates a one-off, pre-authorized auth key tagged
     `tag:agent-box` and places it on the box at `/etc/tailscale/authkey`
     (mode 600, root), then rebuild or restart tailscaled.
   - Admin console: MagicDNS on, HTTPS certificates on, the policy example
     from `ops/vps/README.md` merged in (grants tcp:22 + tcp:443 for the user,
     tcp:22 only for `tag:ci`; the `ssh` rules, including the root rule).
   - Check from the user's computer: `tailscale ssh agent@agent-box` works,
     and `https://agent-box.<tailnet>.ts.net` loads the dashboard.
5. Close the public internet: set `agentBox.publicSsh = false` in `host.nix`,
   rebuild, confirm Tailscale SSH still works, then in hPanel's VPS firewall
   allow only UDP 41641 (Hostinger's firewall blocks everything when it has no
   rules, so it needs this one).
6. GitHub (the user does it): secrets `TS_OAUTH_CLIENT_ID` /
   `TS_OAUTH_SECRET` (OAuth client with `tag:ci`), variable
   `SWARM_DEPLOY_HOST=agent-box`, and read access for the `deploy` user's
   `/srv/swarm` checkout (deploy key or `gh auth`). First deploy:
   `workflow_dispatch` on `main` once this branch is merged.
7. On the box as `agent`: `claude` (log in), clone the repo to
   `~/stormlight`, `git lfs install && git lfs pull`, `npm ci` at the root
   and in `swarm/`.
8. Commit `flake.lock` and the filled `host.nix` / hardware file to the
   branch (no secrets), and tell the user the dashboard URL.

## Rules

- Never use `tailscale funnel`, never open the dashboard publicly: transcripts
  hold code and command output and the app has no login.
- Never ask the user to paste passwords, auth keys, OAuth secrets or private
  keys into chat; they place secrets on the box themselves.
- Confirm with the user before `nixos-rebuild switch`, before closing public
  SSH, and before anything that could cut off access.
- Report what you ran and what failed, with the output.
