# Agent box on NixOS (Hostinger KVM VPS)

One small box (2 vCPU, 7.8 GB) that runs Claude Code and Cursor CLI as
`agent`, in `/home/agent/stormlight`, reachable only over Tailscale.

It has two layers:

- **The base (this folder, root only):** Tailscale, SSH, the firewall, the
  users, and the memory and CPU limits. NixOS makes every change here
  reversible. The agent has no sudo, so it can't break access or lift its
  own limits.
- **The agent's home ([`ops/agent-home`](../agent-home/README.md), no root):**
  Claude Code and Cursor CLI (official installers, self-updating, in
  `~/.local`) and the Remote Control user service. The agent can change all
  of it.

## Choices (change them in the files)

| Choice | Value | Where |
|---|---|---|
| NixOS release | stable **26.05** (Hostinger's template is the same release) | `flake.nix` |
| Hostname / Tailscale name | `agent-box` | `configuration.nix` |
| Users | `agent` (Claude Code, Cursor CLI; no sudo) | `configuration.nix` |
| Limits | everything `agent` runs: 5 GB soft, 6 GB hard, 2 GB of swap | `configuration.nix` |
| Swap | zram, half of RAM; oomd watches the user slice | `configuration.nix` |
| Nix builds | one job on one core, at low priority | `configuration.nix` |
| Public SSH | `agentBox.publicSsh`, `false` once Tailscale SSH works | `host.nix` |
| Automatic upgrades | `agentBox.autoUpgrade = false` | see "Upgrades" |

Files: `flake.nix`, `configuration.nix` (shared), `host.nix` (this machine's
keys, stateVersion, boot), `hardware-configuration.nix` (generated on the box).

## Tailscale admin console (once)

1. DNS: enable **MagicDNS**.
2. Access controls: merge this into your policy file, replacing
   `you@example.com`:

   ```hujson
   {
     "tagOwners": {"tag:agent-box": ["you@example.com"]},
     "grants": [
       // Tailscale SSH needs a network grant to port 22 as well as an ssh rule.
       {"src": ["you@example.com"], "dst": ["tag:agent-box"], "ip": ["tcp:22"]},
     ],
     "ssh": [
       {"action": "accept", "src": ["you@example.com"], "dst": ["tag:agent-box"], "users": ["agent"]},
       {"action": "check",  "src": ["you@example.com"], "dst": ["tag:agent-box"], "users": ["root"]},
     ],
   }
   ```

   An existing allow-all grant would make these restrictions moot; remove it.
3. Create a one-off, pre-authorized **auth key** tagged `tag:agent-box`.

## Steps

1. **Reinstall the VPS with the NixOS template.** hPanel > VPS > Manage > OS &
   Panel > Operating System > Plain OS > NixOS > Change OS. **This wipes the
   disk and snapshots.** Recovery if the network breaks later: the hPanel
   browser console; a reboot returns to the last `switch`ed generation.
2. **Get the flake onto the box** as root:
   ```sh
   nix-shell -p git --run 'git clone https://github.com/danmcfan/stormlight.git /root/stormlight'
   cd /root/stormlight/ops/nixos
   ```
3. **Hardware and host settings.**
   ```sh
   cp /etc/nixos/hardware-configuration.nix .          # if the template has one
   nixos-generate-config --show-hardware-config > hardware-configuration.nix  # otherwise
   ```
   Edit `host.nix`: `system.stateVersion` from the template, your SSH
   **public** key in `agentBox.authorizedKeys`, and the template's boot and
   network settings (the file explains the cloud-init network case).
4. **Tailscale auth key**, kept out of the repo and the Nix store:
   ```sh
   install -d -m 700 /etc/tailscale
   (umask 077; printf '%s' 'tskey-auth-XXXX' > /etc/tailscale/authkey)
   ```
5. **Build.** `test` first: it isn't persistent, so a reboot undoes a lockout.
   ```sh
   nixos-rebuild test   --flake .#agent-box
   # from a second terminal, confirm you can still ssh in, then:
   nixos-rebuild switch --flake .#agent-box
   ```
6. **Close public SSH** once `ssh agent@agent-box` works over the tailnet:
   `agentBox.publicSsh = false;` in `host.nix`, then switch again.
7. **Set up the agent** over the tailnet:
   ```sh
   ssh agent@agent-box
   git clone https://github.com/danmcfan/stormlight.git ~/stormlight
   ~/stormlight/ops/agent-home/setup.sh      # installs Claude Code + Cursor CLI
   claude                                    # log in once, then /exit
   cursor-agent login
   gh auth login
   ```
   The first `claude remote-control` asks to enable Remote Control; run it
   once by hand in `~/stormlight` and answer `y`, then
   `systemctl --user restart claude-rc`.
8. **Outer firewall (optional).** hPanel > VPS > Security > Firewall. It
   needs at least one rule to activate; add UDP 41641 from anywhere
   (Tailscale direct connections).

## Applying changes from a laptop

```sh
rsync -a --delete --exclude hardware-configuration.nix ops/nixos/ root@agent-box:/etc/nixos/agent-box/
ssh root@agent-box 'nixos-rebuild dry-activate --flake /etc/nixos/agent-box#agent-box'  # what restarts
ssh root@agent-box 'nixos-rebuild switch --flake /etc/nixos/agent-box#agent-box'
```

Check `dry-activate` first: a change that restarts `tailscaled` or `sshd`
drops the connection you deploy over.

## Upgrades

- NixOS: `nix flake update` here, commit `flake.lock`, apply as above.
- Claude Code and Cursor CLI update themselves.
- Optional nightly security updates: `agentBox.autoUpgrade = true;` in
  `host.nix` rebuilds from `agentBox.flakeDir` and never reboots.
