# agent home

What the `agent` user runs on the box, on top of the NixOS base in
`ops/nixos`. Everything here lives in agent's home, so agent (or an agent
session) can change it without root. The base caps all of it at 6 GB.

- **Claude Code**: `~/.local/bin/claude` (official installer, self-updates).
  `claude-rc.service` keeps `claude remote-control` running in `~/stormlight`.
  Open the Code tab in the Claude desktop or mobile app (or claude.ai/code)
  and pick the `agent-box` environment.
- **Cursor CLI**: `~/.local/bin/cursor-agent`. Model:
  `cursor-agent --model deepseek-v41-flash-1017-medium` (or pick it inside).
- **Rex server**: `~/.nix-profile/bin/rex`, started by the `rex.socket` user
  unit. Sessions live on the box and keep running when you disconnect. On the
  Mac: Rex > Add Remote Host… with `ssh://agent@agent-box.tail6da63a.ts.net`
  (the CLI equivalent: `rex hosts add agent-box ssh://agent@agent-box.tail6da63a.ts.net`).

Set up or update: `~/stormlight/ops/agent-home/setup.sh` as agent.
Logs: `journalctl --user -u claude-rc -f`.
