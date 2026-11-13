# Agent box on NixOS (Hostinger KVM VPS)

The NixOS version of [`ops/vps`](../vps/README.md): one box runs Claude Code and
its agents (as `agent`, in `/home/agent/stormlight`) and the swarm dashboard,
reachable only over Tailscale. The Ubuntu `bootstrap.sh` in `ops/vps` is the
non-NixOS path; the Tailscale admin policy, the GitHub secrets and the deploy
flow are shared and described there (sections 2 and 5).

**Never expose the dashboard publicly** (no auth; transcripts hold code and
command output). It is published with `tailscale serve`, never `funnel`.

## Choices (change them in the files)

| Choice | Value | Where |
|---|---|---|
| NixOS release | stable **26.05** (Hostinger's template is the same release) | `flake.nix` |
| Hostname / Tailscale name | `agent-box` | `configuration.nix` |
| Users | `agent` (Claude, agents, dashboard; no sudo), `deploy` (CI; may only `systemctl restart swarm` and read its journal) | `configuration.nix` |
| Deploy checkout | `/srv/swarm` (owned by `deploy`, readable by `agent`) | `configuration.nix` |
| Dashboard | `127.0.0.1:3000`, served on tailnet `:443` | `configuration.nix` |
| Public SSH | `agentBox.publicSsh = true` until Tailscale SSH works | `configuration.nix` |
| Claude Code | nixpkgs `claude-code` (unfree, allowed by name only) | `configuration.nix` |
| Automatic upgrades | `agentBox.autoUpgrade = false` | see "Upgrades" |

Files: `flake.nix`, `configuration.nix` (shared), `host.nix` (this machine's
keys, stateVersion, boot), `hardware-configuration.nix` (placeholder).
Evaluation refuses to build while the placeholders remain.

## Steps

1. **Reinstall the VPS with the NixOS template.** hPanel > VPS > Manage > OS &
   Panel > Operating System > Plain OS > NixOS > Change OS. **This wipes the
   disk and snapshots.** Hostinger's firewall (below) is optional for now.
2. **SSH in as root** with the credentials hPanel shows (password or the key you
   gave it). Fallback if the network breaks later: the hPanel browser console;
   a reboot from hPanel returns to the last permanent (`switch`/`boot`)
   generation.
3. **Get the flake onto the box** (the repo is cloned as root only for this;
   the agents' clone comes later):
   ```sh
   nix-shell -p git --run 'git clone https://github.com/danmcfan/stormlight.git /root/stormlight'
   cd /root/stormlight/ops/nixos
   ```
4. **Hardware and host settings.**
   ```sh
   cp /etc/nixos/hardware-configuration.nix .          # if the template has one
   # otherwise (the image can ship /etc/nixos empty):
   nixos-generate-config --show-hardware-config > hardware-configuration.nix
   cat /etc/nixos/configuration.nix; nixos-version      # for host.nix
   ```
   Edit `host.nix`: set `system.stateVersion` to the template's value, add your
   SSH **public** key to `agentBox.authorizedKeys`, and carry over whatever
   boot-loader and network settings the template has (the file explains the
   cloud-init network case; don't invent disk values). Do not commit the
   host-specific files with real values unless you want them in the repo.
5. **Tailscale auth key.** In the admin console (see `ops/vps/README.md` step 2,
   including MagicDNS + HTTPS Certificates and the policy), create a one-off,
   pre-authorized auth key tagged `tag:agent-box`. On the box (the secret stays
   out of the repo and the Nix store):
   ```sh
   install -d -m 700 /etc/tailscale
   (umask 077; printf '%s' 'tskey-auth-XXXX' > /etc/tailscale/authkey)
   ```
   The path is `agentBox.tailscaleAuthKeyFile`; set it `null` to log in by hand
   with `tailscale up --ssh --advertise-tags tag:agent-box`. For SSH as root
   over the tailnet (needed once public SSH is closed), add to your policy's
   `ssh` list: `{"action": "check", "src": ["you@example.com"], "dst": ["tag:agent-box"], "users": ["root"]}`.
6. **Build.** Test first: a `test` activation is not persistent, so a lockout is
   undone by a reboot.
   ```sh
   nixos-rebuild test   --flake .#agent-box
   # from a second terminal, confirm you can still ssh in, then:
   nixos-rebuild switch --flake .#agent-box
   git add flake.lock   # created on first run; commit it to pin nixpkgs
   ```
   (Flakes read tracked files: `host.nix` and `hardware-configuration.nix` are
   already tracked, so editing them in place works. New files need `git add`.)
7. **Check Tailscale:** `tailscale status`, then from your laptop
   `tailscale ssh agent@agent-box`. The dashboard unit `swarm-tailscale-serve`
   retries until the box is logged in and HTTPS certs are enabled;
   `tailscale serve status` should list `https://agent-box.<tailnet>.ts.net`.
8. **Log in as the agent and clone the repo.**
   ```sh
   tailscale ssh agent@agent-box
   claude                                   # log in once
   git config --global user.name "..."; git config --global user.email "..."
   gh auth login                            # or add a deploy key with write access
   git clone https://github.com/danmcfan/stormlight.git ~/stormlight
   cd ~/stormlight && git lfs install && git lfs pull && npm ci && (cd swarm && npm ci)
   ```
   Use `tmux` so agents survive disconnects. Chromium for Playwright: run
   `npx playwright install chromium` as `agent`; `programs.nix-ld` supplies
   the libraries (no `install-deps`; that is apt-only). Launch it with the
   swiftshader flags from `AGENTS.md`. Alternative: nixpkgs'
   `playwright-driver.browsers` with `PLAYWRIGHT_BROWSERS_PATH`, but its
   Playwright version (1.59.1 in 26.05) must match the npm `playwright` package
   exactly.
9. **Deploy checkout and dashboard** (as `deploy`, which needs read access to
   the repo; see `ops/vps/README.md` step 5):
   ```sh
   sudo -u deploy -H git clone https://github.com/danmcfan/stormlight.git /srv/swarm
   sudo -u deploy -H bash -lc 'cd /srv/swarm/swarm && npm ci && npm run build'
   systemctl restart swarm
   ```
   The unit is skipped until `/srv/swarm/swarm/server.mjs` exists. After that CI
   runs `ops/vps/update-swarm.sh` (one script for both OSes). Set the GitHub
   secrets/variables from `ops/vps/README.md` step 5; `SWARM_DEPLOY_HOST=agent-box`.
10. **Close public SSH.** Once `tailscale ssh agent@agent-box` works: set
    `agentBox.publicSsh = false;` in `host.nix`, then `nixos-rebuild switch
    --flake .#agent-box`. (Recovery: hPanel console.)
11. **Outer firewall (optional).** hPanel > VPS > Security > Firewall > Add
    Firewall. It drops all traffic by default but **needs at least one rule to
    activate** (an empty group would block everything), so "no inbound rules"
    is not possible. Add one harmless accept rule: UDP 41641 from anywhere
    (Tailscale direct connections; the host firewall opens it anyway), plus TCP
    22 only while `publicSsh` is true. Tailscale still works through relays
    without it. Rules apply to new connections within about two minutes.

## Upgrades

- Routine: `cd /root/stormlight/ops/nixos && git pull --rebase && nix flake update && nixos-rebuild switch --flake .#agent-box`.
- Optional nightly security updates: set `agentBox.autoUpgrade = true;` in
  `host.nix`. It rebuilds from `agentBox.flakeDir` (root's checkout) after
  bumping nixpkgs within 26.05, never reboots, and a pull of the repo is still
  yours to do. Garbage collection already runs weekly (older than 14 days).
- Moving to the next release: change the URL in `flake.nix`, `nix flake update`,
  rebuild. Keep `stateVersion` as is.

## Verified and not

Evaluated against the nixos-26.05 channel (`nix-instantiate`; every option in
`configuration.nix` evaluated, the placeholder assertions fire). Not built or
booted: the template's boot/network details, the `tailscale serve` HTTPS prompt
on a tailnet without HTTPS certs, and the Chromium library set were not run.
