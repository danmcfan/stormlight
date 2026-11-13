# Running agents and the swarm dashboard on one VPS

One Linux box runs Claude Code and its agents (in `~agent/stormlight`) and the
swarm dashboard, which reads the transcripts the agents write to
`~agent/.claude/projects`. Everything is reachable only over Tailscale.

**Never expose the dashboard publicly.** Transcripts contain code and command
output, and the app has no auth. Use `tailscale serve`, never `tailscale funnel`.

## 1. Buy the VPS
Ubuntu 24.04, 8 GB (Hetzner CX33, x86 or ARM both work). Add your SSH key.
In the provider's cloud firewall (Hetzner Firewall) attach a firewall with **no
inbound rules** as an outer layer. Until step 4 is done, allow TCP 22 inbound
in it temporarily.

## 2. Tailscale admin console (once)
1. DNS: enable **MagicDNS** and **HTTPS Certificates** (`serve` needs both).
2. Access controls: merge the policy below into your existing policy file.
3. Settings > OAuth clients: create one with the `auth_keys` (write) scope and
   tag `tag:ci`. Keep the id and secret for step 5.
4. Optionally create a reusable-off, one-off **auth key** tagged `tag:agent-box`
   for an unattended bootstrap.

```hujson
{
  "tagOwners": {
    "tag:agent-box": ["you@example.com"],
    "tag:ci":        ["you@example.com"],
  },
  "grants": [
    // Network access. Tailscale SSH rules alone are not enough: the source
    // also needs a grant to port 22, or the connection is dropped first.
    {"src": ["you@example.com"], "dst": ["tag:agent-box"], "ip": ["tcp:22", "tcp:443"]}, // 443 = dashboard
    {"src": ["tag:ci"],          "dst": ["tag:agent-box"], "ip": ["tcp:22"]},            // CI: SSH only, no 443
  ],
  "ssh": [
    {"action": "accept", "src": ["you@example.com"], "dst": ["tag:agent-box"], "users": ["agent"]},
    {"action": "accept", "src": ["tag:ci"],          "dst": ["tag:agent-box"], "users": ["deploy"]},
  ],
}
```
Replace `you@example.com`. This is a fragment: merge the keys into your policy
rather than replacing it (an existing allow-all grant would make these
restrictions moot; remove it). Per Tailscale's SSH docs, a connection needs both
a network grant and an `ssh` rule ("Ensure an access control policy exists that
grants the source with access to the destination on port `22`"). The `ssh`
rules take no port.

## 3. Bootstrap the box
Copy the repo's `ops/vps/` to the box (or clone it), then as root:

```sh
sudo REPO_URL=https://github.com/danmcfan/stormlight.git \
     TS_AUTHKEY=tskey-auth-XXXX TS_HOSTNAME=stormlight \
     ./ops/vps/bootstrap.sh
```
Without `TS_AUTHKEY` it prints `tailscale up --ssh --advertise-tags tag:agent-box`
for you to run (open the URL, then re-run bootstrap so `tailscale serve` is
configured). Variables: `AGENT_USER` (agent), `DEPLOY_USER` (deploy),
`DEPLOY_DIR` (/srv/swarm), `REPO_BRANCH`, `NODE_MAJOR`. It creates two users:
`agent` (runs Claude and the service) and `deploy` (CI only; its sudo rights
are limited to restarting the `swarm` service). It installs Node 22, git-lfs,
Tailscale, Claude Code, Playwright Chromium plus system libraries, clones the
repo to `~agent/stormlight`, makes a second, separate checkout in `/srv/swarm`
for deploys (agents change branches in their clone; a deploy must always build
`origin/main`), installs `swarm.service`, and runs
`tailscale serve --bg --https=443 http://127.0.0.1:3000`.

The firewall (ufw) allows everything on `tailscale0`, UDP 41641 (direct
WireGuard), and SSH on 22; everything else inbound is denied.

## 4. Close public SSH
From your laptop confirm `tailscale ssh agent@stormlight` works, then on the box:
```sh
sudo ./ops/vps/bootstrap.sh --lock-public-ssh
```
Then remove the temporary port-22 rule from the cloud firewall. If you lock
yourself out, use the provider's web console.

## 5. GitHub
Repository secrets `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`; repository variable
`SWARM_DEPLOY_HOST` (the machine's MagicDNS name, e.g. `stormlight`; optional
`SWARM_DEPLOY_USER`, default `deploy`). Until `SWARM_DEPLOY_HOST` is set the
deploy job is skipped and the workflow only tests and builds. The `deploy` user
needs read access to the repo, because the `git fetch` in `/srv/swarm` runs as it (a read-only deploy key under `~deploy/.ssh`, or
a public repo over HTTPS, or `gh` auth for that user). The deploy job only runs from `main` (pushes or a manual dispatch on `main`). `.github/workflows/swarm-deploy.yml` runs on pushes to
`main` touching `swarm/**` or `ops/vps/**`: tests, builds, then runs
`update-swarm.sh` on the box (fast-forward pull, `npm ci`, build, restart,
health check on `/api/swarm`).

## 6. Use it
- `tailscale ssh agent@stormlight`, then `claude` and log in once.
  Set `git config --global user.name/user.email`, and `gh auth login` (or add a
  deploy key with write access) so agents can push.
- Run agents in a `tmux` session inside `~/stormlight` so they survive
  disconnects. Browser checks need the swiftshader flags from `AGENTS.md`.
- Dashboard: `https://<machine>.<tailnet>.ts.net` (from any device on your
  tailnet).
- Plan usage and queue: the dashboard reads `~/.claude/swarm/plan-usage.jsonl`
  and `~/.claude/swarm/queue.jsonl` (override with `SWARM_PLAN_USAGE_FILE`,
  `SWARM_QUEUE_FILE`). The lead agent appends events to these on the same box,
  so they work without extra wiring.
- Logs: `journalctl -u swarm -f`. Manual deploy: `/srv/swarm/ops/vps/update-swarm.sh`.
