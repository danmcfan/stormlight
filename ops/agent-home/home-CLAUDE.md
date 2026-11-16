# agent-box code folder

Remote Control sessions start here, in `/home/agent/code`. Each repo lives in
its own folder under this one: `cd` into the repo for your task and read its own
AGENTS.md (or CLAUDE.md) before changing anything.

- stormlight: `~/code/stormlight` (github.com/danmcfan/stormlight).
- Clone others into `~/code/<name>` with `gh repo clone danmcfan/<name>`.

The box has 2 vCPUs, 7.8 GB and no GPU, and everything agent runs shares a
6 GB cap, so keep long-running servers and browsers to the ones your task needs
and stop them when done. Root-level setup (NixOS, Tailscale, limits) is in
`~/code/stormlight/ops/nixos`; agent has no sudo.

This file is installed by `~/code/stormlight/ops/agent-home/setup.sh`; edit it there.
