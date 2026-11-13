// Swarm rescue: a tiny, dependency-free page for when the dashboard is broken.
//
// The lead edits the same app you use to talk to it, so one bad edit can take
// the Lead screen down with it. This server runs from a read-only copy in the
// Nix store (NixOS builds it from ops/nixos/rescue.mjs), so nothing an agent does to the
// checkout can break it. It shows whether the dashboard is up, what the lead is
// doing and what changed in git, and lets you prompt the lead, stash
// uncommitted changes, revert the last commit, or restart the dashboard.
//
// Prompts go through the dashboard's /api/lead while it is healthy; when it is
// down, the run is started here the same way the dashboard does it (a
// systemd --user unit, recorded in lead.json), so a recovered dashboard picks
// it up.
import http from 'node:http'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOST = process.env.RESCUE_HOST || '127.0.0.1'
const PORT = Number(process.env.RESCUE_PORT) || 5180
const REPO = process.env.RESCUE_REPO || join(homedir(), 'stormlight')
const DASHBOARD = process.env.RESCUE_DASHBOARD || 'http://127.0.0.1:5173'
const STATE_FILE = process.env.SWARM_LEAD_STATE_FILE || join(homedir(), '.claude', 'swarm', 'lead.json')
const RUN_DIR = join(STATE_FILE, '..', 'runs')
const KEEP_HISTORY = 10

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30_000, maxBuffer: 4 << 20, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}
const git = (...args) => run('git', ['-C', REPO, ...args])

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { sessionId: null, started: false, history: [], waiting: [], running: null }
  }
}
function writeState(s) {
  mkdirSync(join(STATE_FILE, '..'), { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(s))
}
function readText(path, max) {
  try {
    const s = readFileSync(path, 'utf8')
    return s.length > max ? s.slice(-max) : s
  } catch {
    return ''
  }
}

async function dashboardHealth() {
  const t0 = Date.now()
  const out = { ok: false, status: 0, ms: 0, error: '' }
  for (const path of ['/api/lead', '/lead']) {
    try {
      const res = await fetch(DASHBOARD + path, { signal: AbortSignal.timeout(8000) })
      out.status = res.status
      if (!res.ok) {
        out.error = `${path} returned HTTP ${res.status}: ${(await res.text()).replace(/<[^>]+>/g, ' ').slice(0, 600)}`
        break
      }
      out.ok = true
    } catch (e) {
      out.ok = false
      out.error = `${path}: ${e.message}`
      break
    }
  }
  out.ms = Date.now() - t0
  return out
}

async function unitActive(unit) {
  if (!unit) return false
  const { stdout } = await run('systemctl', ['--user', 'is-active', unit])
  return ['active', 'activating', 'reloading', 'deactivating'].includes(stdout.trim())
}

function parseResult(out, err) {
  try {
    const j = JSON.parse(out)
    return { ok: !j.is_error, reply: typeof j.result === 'string' ? j.result : '(no reply)' }
  } catch {
    return { ok: false, reply: out.trim() || err.trim() || 'claude exited without a reply' }
  }
}

/** With the dashboard down, a finished rescue-started run would otherwise stay "running" forever. */
async function settleOrphan(s, dashboardOk) {
  const r = s.running
  if (!r || !r.unit || dashboardOk || (await unitActive(r.unit))) return s
  const { ok, reply } = parseResult(readText(r.out, 400_000), readText(r.err, 20_000))
  const done = { ...r, endedAt: Date.now(), ok, reply: reply.slice(0, 4000) }
  delete done.unit
  delete done.out
  delete done.err
  s.history = [done, ...(s.history || [])].slice(0, KEEP_HISTORY)
  s.running = null
  writeState(s)
  return s
}

async function status() {
  const dashboard = await dashboardHealth()
  const lead = await settleOrphan(readState(), dashboard.ok)
  const [branch, log, dirty, ahead] = await Promise.all([
    git('branch', '--show-current'),
    git('log', '-6', '--format=%h%x09%cr%x09%s'),
    git('status', '--porcelain'),
    git('rev-list', '--left-right', '--count', '@{upstream}...HEAD'),
  ])
  const [behindN, aheadN] = ahead.stdout.trim().split(/\s+/).map(Number)
  return {
    dashboard,
    lead: {
      running: lead.running ? { prompt: lead.running.prompt, startedAt: lead.running.startedAt } : null,
      waiting: (lead.waiting || []).length,
      last: (lead.history || [])[0] || null,
      model: lead.model || 'opus',
    },
    git: {
      branch: branch.stdout.trim(),
      ahead: aheadN || 0,
      behind: behindN || 0,
      commits: log.stdout.trim().split('\n').filter(Boolean).map((l) => {
        const [hash, when, subject] = l.split('\t')
        return { hash, when, subject }
      }),
      dirty: dirty.stdout.split('\n').filter(Boolean).map((l) => l.slice(3)),
    },
  }
}

const SYSTEM_PROMPT = [
  'You are the lead agent of a swarm, driven from the Swarm dashboard on a phone.',
  'This prompt came from the rescue page because the dashboard is not responding:',
  'getting the dashboard (swarm/) working again comes first. Plan the work, then',
  'delegate it with the Agent tool (model "sonnet") where that helps. Do not edit ops/rescue.',
  'Do not push, publish, deploy or delete anything outside the working tree unless asked.',
  'Finish with a short plain-language summary the user can read on a phone.',
].join(' ')

async function startDirect(prompt) {
  const s = readState()
  if (s.running && (await unitActive(s.running.unit))) throw new Error('The lead is already working on something.')
  if (!s.sessionId) {
    s.sessionId = randomUUID()
    s.started = false
  }
  const startedAt = Date.now()
  const base = join(RUN_DIR, String(startedAt))
  mkdirSync(RUN_DIR, { recursive: true })
  writeFileSync(`${base}.prompt`, prompt)
  const unit = `swarm-lead-${startedAt}`
  const args = [
    '-p', '--output-format', 'json', '--model', s.model || 'opus',
    '--permission-mode', 'bypassPermissions', '--append-system-prompt', SYSTEM_PROMPT,
    ...(s.started ? ['--resume', s.sessionId] : ['--session-id', s.sessionId]),
  ]
  const env = ['PATH', 'HOME', 'LANG'].filter((k) => process.env[k]).map((k) => `--setenv=${k}=${process.env[k]}`)
  s.running = { prompt, startedAt, model: s.model || 'opus', unit, out: `${base}.json`, err: `${base}.err` }
  s.started = true
  writeState(s)
  const r = await run('systemd-run', [
    '--user', `--unit=${unit}`, '--collect', '--quiet', '--expand-environment=no',
    `--working-directory=${REPO}`, ...env,
    `--property=StandardInput=file:${base}.prompt`,
    `--property=StandardOutput=truncate:${base}.json`,
    `--property=StandardError=truncate:${base}.err`,
    '--', 'claude', ...args,
  ])
  if (r.code !== 0) {
    s.running = null
    writeState(s)
    throw new Error(`Could not start the lead: ${r.stderr.trim() || `exit ${r.code}`}`)
  }
}

async function sendPrompt(prompt) {
  const p = String(prompt || '').trim()
  if (!p) throw new Error('Empty prompt')
  if ((await dashboardHealth()).ok) {
    const res = await fetch(DASHBOARD + '/api/lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: DASHBOARD },
      body: JSON.stringify({ action: 'send', prompt: p }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`Dashboard refused the prompt: HTTP ${res.status}`)
    return 'Sent through the dashboard.'
  }
  await startDirect(p)
  return 'The dashboard is down, so the lead was started directly. It will show up in the dashboard once that is back.'
}

async function stopLead() {
  const s = readState()
  if (!s.running?.unit) {
    if ((await dashboardHealth()).ok) {
      await fetch(DASHBOARD + '/api/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: DASHBOARD },
        body: JSON.stringify({ action: 'stop' }),
      })
      return 'Asked the dashboard to stop the lead.'
    }
    return 'The lead is not running.'
  }
  await run('systemctl', ['--user', 'stop', s.running.unit])
  return 'Stopped the lead.'
}

const ACTIONS = {
  prompt: (b) => sendPrompt(b.prompt),
  stop: () => stopLead(),
  stash: async () => {
    const r = await git('stash', 'push', '--include-untracked', '-m', `rescue ${new Date().toISOString()}`)
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'git stash failed')
    return r.stdout.trim() || 'Nothing to stash.'
  },
  revert: async () => {
    const dirty = (await git('status', '--porcelain')).stdout.trim()
    if (dirty) throw new Error('There are uncommitted changes. Stash them first.')
    const r = await git('revert', '--no-edit', 'HEAD')
    if (r.code !== 0) {
      await git('revert', '--abort')
      throw new Error(r.stderr.trim() || 'git revert failed')
    }
    return r.stdout.trim().split('\n')[0]
  },
  restart: async () => {
    const r = await run('sudo', ['-n', 'systemctl', 'restart', 'swarm-dev'])
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'restart failed')
    return 'Dashboard restarted. Give it a few seconds.'
  },
}

function sameOrigin(req) {
  try {
    return new URL(req.headers.origin).host === req.headers.host
  } catch {
    return false
  }
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, PAGE, 'text/html; charset=utf-8')
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, await status())
    const action = url.pathname.startsWith('/api/') ? ACTIONS[url.pathname.slice(5)] : undefined
    if (req.method === 'POST' && action) {
      if (!sameOrigin(req)) return send(res, 403, { error: 'Cross-origin request refused' })
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Expected JSON' })
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > 100_000) return send(res, 413, { error: 'Too large' })
      }
      return send(res, 200, { message: await action(raw ? JSON.parse(raw) : {}) })
    }
    send(res, 404, { error: 'Not found' })
  } catch (e) {
    send(res, 400, { error: e.message })
  }
})
server.listen(PORT, HOST, () => console.log(`rescue on http://${HOST}:${PORT}`))

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Rescue">
<title>Swarm rescue</title>
<style>
  :root { color-scheme: dark; --bg:#000; --card:#0a0f1e; --rule:rgba(150,185,235,.18); --ink:#eaf1fc; --dim:#9fb0c9; --ok:#7fe0b0; --bad:#ff9db0; --blue:#3d78f2 }
  * { box-sizing: border-box }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui,-apple-system,sans-serif;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)) }
  main { max-width: 40rem; margin: 0 auto; display: grid; gap: 14px }
  h1 { margin: 0 0 4px; font-size: 20px } h2 { margin: 0 0 8px; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); font-weight: 600 }
  section { background: var(--card); border: 1px solid var(--rule); border-radius: 14px; padding: 14px }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--dim); flex: none } .dot.ok { background: var(--ok) } .dot.bad { background: var(--bad) }
  .muted { color: var(--dim); font-size: 14px } .err { color: var(--bad); font: 13px/1.45 ui-monospace,monospace; white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0 0 }
  textarea { width: 100%; min-height: 6rem; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--rule); background: #050812; color: var(--ink); font-size: 16px; line-height: 1.45; font-family: inherit; resize: vertical }
  button { min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--rule); background: rgba(120,160,255,.08); color: var(--ink); font-size: 15px; font-family: inherit; cursor: pointer }
  button.primary { background: var(--blue); border-color: transparent; color: #fff } button.danger { border-color: rgba(255,157,176,.5); color: var(--bad) }
  button:disabled { opacity: .5; cursor: default } button:focus-visible, textarea:focus-visible { outline: 2px solid #d8efff; outline-offset: 2px }
  ul { margin: 0; padding-left: 18px } li { margin: 2px 0; overflow-wrap: anywhere } code { font: 13px ui-monospace,monospace; color: var(--dim) }
  .reply { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 0 } #toast { min-height: 1.5em }
</style>
</head>
<body>
<main>
  <header><h1>Swarm rescue</h1><div class="muted">Works even when the dashboard is broken. <a href="" id="dash-link" style="color:inherit">Open dashboard</a></div></header>
  <section aria-labelledby="h-dash"><h2 id="h-dash">Dashboard</h2>
    <div class="row"><span class="dot" id="dash-dot"></span><span id="dash-text">Checking…</span></div>
    <pre class="err" id="dash-err" hidden></pre>
    <div class="row" style="margin-top:10px"><button id="restart">Restart dashboard</button></div>
  </section>
  <section aria-labelledby="h-lead"><h2 id="h-lead">Lead</h2>
    <div class="row"><span class="dot" id="lead-dot"></span><span id="lead-text">…</span></div>
    <p class="reply muted" id="lead-reply" hidden></p>
    <label for="prompt" class="muted" style="display:block;margin:10px 0 6px">Message the lead</label>
    <textarea id="prompt" placeholder="e.g. The dashboard shows a blank page after the last change. Find what broke and fix it."></textarea>
    <div class="row" style="margin-top:8px"><button class="primary" id="send">Send</button><button id="stop">Stop lead</button></div>
  </section>
  <section aria-labelledby="h-git"><h2 id="h-git">Code</h2>
    <div class="muted" id="git-branch"></div>
    <p class="muted" style="margin:10px 0 4px">Uncommitted changes</p><ul id="git-dirty"></ul>
    <p class="muted" style="margin:10px 0 4px">Recent commits</p><ul id="git-log"></ul>
    <div class="row" style="margin-top:10px"><button class="danger" id="stash">Stash uncommitted changes</button><button class="danger" id="revert">Revert last commit</button></div>
    <p class="muted" style="margin:8px 0 0">Both can be undone: <code>git stash pop</code>, or revert the revert.</p>
  </section>
  <div id="toast" role="status" aria-live="polite" class="muted"></div>
</main>
<script>
const $ = (id) => document.getElementById(id)
const dash = location.protocol + '//' + location.hostname + ':5173/'
$('dash-link').href = dash
function setDot(el, state) { el.className = 'dot' + (state ? ' ' + state : '') }
function li(text) { const e = document.createElement('li'); e.textContent = text; return e }
async function refresh() {
  try {
    const s = await (await fetch('/api/status', { cache: 'no-store' })).json()
    setDot($('dash-dot'), s.dashboard.ok ? 'ok' : 'bad')
    $('dash-text').textContent = s.dashboard.ok ? 'Healthy (' + s.dashboard.ms + ' ms)' : 'Not responding'
    $('dash-err').hidden = s.dashboard.ok; $('dash-err').textContent = s.dashboard.error
    const l = s.lead
    setDot($('lead-dot'), l.running ? 'ok' : '')
    $('lead-text').textContent = l.running ? 'Working on: ' + l.running.prompt.slice(0, 140) + (l.waiting ? ' (+' + l.waiting + ' waiting)' : '') : 'Idle (' + l.model + ')'
    $('lead-reply').hidden = !l.last || !!l.running
    if (l.last) $('lead-reply').textContent = 'Last reply' + (l.last.ok ? '' : ' (failed)') + ': ' + (l.last.reply || '')
    const g = s.git
    $('git-branch').textContent = 'On ' + g.branch + (g.ahead ? ', ' + g.ahead + ' commit(s) not pushed' : '') + (g.behind ? ', ' + g.behind + ' behind GitHub' : '')
    $('git-dirty').replaceChildren(...(g.dirty.length ? g.dirty.map(li) : [li('None')]))
    $('git-log').replaceChildren(...g.commits.map((c) => li(c.hash + ' · ' + c.subject + ' (' + c.when + ')')))
  } catch (e) { $('toast').textContent = 'Could not load status: ' + e.message }
}
async function act(name, body, confirmText) {
  if (confirmText && !confirm(confirmText)) return
  const buttons = document.querySelectorAll('button'); buttons.forEach((b) => (b.disabled = true))
  $('toast').textContent = 'Working…'
  try {
    const res = await fetch('/api/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
    const j = await res.json()
    $('toast').textContent = j.error ? 'Error: ' + j.error : j.message
    if (!j.error && name === 'prompt') $('prompt').value = ''
  } catch (e) { $('toast').textContent = 'Error: ' + e.message }
  buttons.forEach((b) => (b.disabled = false)); refresh()
}
$('send').onclick = () => act('prompt', { prompt: $('prompt').value })
$('stop').onclick = () => act('stop', {}, 'Stop the lead and its agents?')
$('restart').onclick = () => act('restart', {}, 'Restart the dashboard?')
$('stash').onclick = () => act('stash', {}, 'Stash all uncommitted changes? (git stash pop brings them back)')
$('revert').onclick = () => act('revert', {}, 'Revert the last commit? This adds a new commit that undoes it.')
refresh(); setInterval(refresh, 5000)
</script>
</body>
</html>`
