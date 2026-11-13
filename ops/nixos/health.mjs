// Swarm health: an always-up JSON endpoint that says whether the dashboard is
// working, and why not when it isn't.
//
// It runs from a read-only copy in the Nix store (NixOS builds it from this
// file), so nothing an agent does to the checkout can take it down. It also
// restarts the dashboard when it stops answering at all (hung or crashed); an
// HTTP error from broken code is only reported, since a restart won't fix it.
//
//   GET /health  ->  { ok, checkedAt, dashboard, lead, git, autoRestarts }
//
// `ok` is false when the dashboard fails its check or the lead's last run failed.
import http from 'node:http'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOST = process.env.HEALTH_HOST || '127.0.0.1'
const PORT = Number(process.env.HEALTH_PORT) || 5180
const REPO = process.env.HEALTH_REPO || join(homedir(), 'stormlight')
const DASHBOARD = process.env.HEALTH_DASHBOARD || 'http://127.0.0.1:5173'
const STATE_FILE = process.env.SWARM_LEAD_STATE_FILE || join(homedir(), '.claude', 'swarm', 'lead.json')
const CHECK_MS = 20_000
const RESTART_AFTER_MISSES = 3
const RESTART_COOLDOWN_MS = 10 * 60_000

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 20_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}
const git = (...args) => run('git', ['-C', REPO, ...args])

async function checkDashboard() {
  const t0 = Date.now()
  for (const path of ['/api/lead', '/', '/lead']) {
    try {
      const res = await fetch(DASHBOARD + path, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) {
        const body = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        return { ok: false, reachable: true, ms: Date.now() - t0, error: `${path} returned HTTP ${res.status}: ${body.slice(0, 800)}` }
      }
    } catch (e) {
      return { ok: false, reachable: false, ms: Date.now() - t0, error: `${path}: ${e.cause?.code || e.message}` }
    }
  }
  return { ok: true, reachable: true, ms: Date.now() - t0, error: null }
}

function leadStatus() {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    const last = (s.history || [])[0]
    return {
      running: s.running ? { prompt: s.running.prompt?.slice(0, 200), startedAt: s.running.startedAt } : null,
      waiting: (s.waiting || []).length,
      last: last ? { prompt: last.prompt?.slice(0, 200), ok: last.ok, endedAt: last.endedAt, reply: last.reply?.slice(0, 600) } : null,
    }
  } catch {
    return { running: null, waiting: 0, last: null }
  }
}

async function gitStatus() {
  const [branch, head, dirty, counts] = await Promise.all([
    git('branch', '--show-current'),
    git('log', '-1', '--format=%h %s'),
    git('status', '--porcelain'),
    git('rev-list', '--left-right', '--count', '@{upstream}...HEAD'),
  ])
  const [behind, ahead] = counts.stdout.trim().split(/\s+/).map(Number)
  return {
    branch: branch.stdout.trim(),
    head: head.stdout.trim(),
    uncommitted: dirty.stdout.split('\n').filter(Boolean).map((l) => l.slice(3)),
    ahead: ahead || 0,
    behind: behind || 0,
  }
}

let dashboard = { ok: false, reachable: false, ms: 0, error: 'not checked yet' }
let checkedAt = 0
let misses = 0
let lastRestart = 0
const autoRestarts = []

async function check() {
  dashboard = await checkDashboard()
  checkedAt = Date.now()
  misses = dashboard.reachable ? 0 : misses + 1
  if (misses >= RESTART_AFTER_MISSES && Date.now() - lastRestart > RESTART_COOLDOWN_MS) {
    lastRestart = Date.now()
    misses = 0
    const r = await run('sudo', ['-n', '/run/current-system/sw/bin/systemctl', 'restart', 'swarm-dev'])
    autoRestarts.unshift({ at: lastRestart, reason: dashboard.error, ok: r.code === 0, error: r.code ? r.stderr.trim() : null })
    autoRestarts.length = Math.min(autoRestarts.length, 10)
  }
}

async function report() {
  const lead = leadStatus()
  const g = await gitStatus()
  return {
    ok: dashboard.ok && lead.last?.ok !== false,
    checkedAt,
    dashboard,
    lead,
    git: g,
    autoRestarts,
  }
}

// The dashboard (another port, same host) may read /health to show problems.
function corsOrigin(req) {
  const origin = req.headers.origin
  try {
    return origin && new URL(origin).port === new URL(DASHBOARD).port ? origin : null
  } catch {
    return null
  }
}

http
  .createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    if (req.method !== 'GET' || (path !== '/health' && path !== '/')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      return res.end('{"error":"Not found"}')
    }
    if (req.url.includes('fresh')) await check()
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' }
    const origin = corsOrigin(req)
    if (origin) Object.assign(headers, { 'access-control-allow-origin': origin, vary: 'origin' })
    res.writeHead(200, headers)
    res.end(JSON.stringify(await report(), null, 2))
  })
  .listen(PORT, HOST, () => console.log(`health on http://${HOST}:${PORT}/health`))

check()
setInterval(check, CHECK_MS)
