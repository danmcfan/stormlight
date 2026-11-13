// The lead agent: one long-lived Claude Code conversation that takes prompts
// from the dashboard and delegates the work to Sonnet subagents. Server only.
//
// Each prompt runs `claude -p` against the same session (--session-id the first
// time, --resume afterwards), one at a time; prompts sent while it works wait in
// a FIFO. The lead's transcript and its subagents land in ~/.claude/projects,
// which the store already watches, so they show up in Fleet and Graph.
//
// Env:
//   SWARM_LEAD_CWD              where the lead works (default ~/stormlight)
//   SWARM_LEAD_MODEL            lead model (default opus)
//   SWARM_LEAD_SUBAGENT_MODEL   model the lead delegates to (default sonnet)
//   SWARM_LEAD_MODELS           comma-separated list of selectable models
//                                (default opus,sonnet,haiku; same list is
//                                offered for both the lead and its subagents)
//   SWARM_LEAD_PERMISSION_MODE  claude --permission-mode (default bypassPermissions;
//                               headless runs cannot answer permission prompts)
//   SWARM_MAX_AGENTS            parallel subagents the lead may run (default 4)
//   SWARM_LEAD_STATE_FILE       session id + model choice store
//                                (default ~/.claude/swarm/lead.json)
//   SWARM_LEAD_UPLOAD_DIR       where attached images are stored
//                                (default ~/.claude/swarm/uploads)
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { maxConcurrent } from './queue'

export interface LeadImage {
  id: string
  /** '/api/lead/upload?id=<id>' */
  url: string
  name: string
}

export interface LeadRun {
  prompt: string
  images?: LeadImage[]
  startedAt: number
  endedAt?: number
  ok?: boolean
  /** The lead's final reply (or the error), trimmed. */
  reply?: string
  /** The model this run actually used. */
  model?: string
  /** Detached runs only: the systemd user unit and its output files. */
  unit?: string
  out?: string
  err?: string
}

export interface LeadWaiting {
  prompt: string
  images?: LeadImage[]
}

export interface LeadState {
  sessionId: string | null
  model: string
  subagentModel: string
  /** Selectable lead models, e.g. ['opus', 'sonnet', 'haiku']. */
  models: string[]
  /** Selectable subagent models; the same list as `models`. */
  subagentModels: string[]
  cwd: string
  running: LeadRun | null
  waiting: LeadWaiting[]
  /** Most recent first. */
  history: LeadRun[]
}

const MAX_PROMPT = 20_000
const MAX_REPLY = 4_000
const KEEP_HISTORY = 10
const DEFAULT_MODELS = ['opus', 'sonnet', 'haiku']

function env(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : fallback
}

function stateFile(): string {
  return env('SWARM_LEAD_STATE_FILE', join(homedir(), '.claude', 'swarm', 'lead.json'))
}

/** The models selectable for the lead and, separately, its subagents (same list for both). */
export function allowedModels(): string[] {
  const raw = process.env.SWARM_LEAD_MODELS
  if (!raw || !raw.trim()) return DEFAULT_MODELS
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length ? list : DEFAULT_MODELS
}

export function isAllowedModel(model: unknown, allowed: string[] = allowedModels()): model is string {
  return typeof model === 'string' && allowed.includes(model)
}

function systemPrompt(subagentModel: string, max: number): string {
  return [
    'You are the lead agent of a swarm, driven from the Swarm dashboard on a phone.',
    'The user sends short requests. Plan the work, then delegate it: use the Agent tool',
    `with model "${subagentModel}" for each independent piece, and run independent pieces`,
    `in parallel (at most ${max} subagents at once). Give each subagent a self-contained`,
    'brief: the goal, the files or area, and what done looks like.',
    'Do quick coordination yourself (reading, small checks), but leave substantial',
    'implementation to subagents. Do not push, publish, deploy or delete anything',
    'outside the working tree unless the user asked for exactly that. Never edit ops/ (the box config and the rescue page).',
    'The dashboard you are driven from is swarm/ with hot reload: keep it working. After changing it, run the typecheck and tests before you finish.',
    'Finish with a short plain-language summary the user can read on a phone.',
  ].join(' ')
}

function trim(s: string, n: number): string {
  s = s.trim()
  return s.length > n ? `${s.slice(0, n)}…` : s
}

// --- uploaded images ---------------------------------------------------
//
// Images are uploaded separately (POST /api/lead/upload) and referenced by
// id from a send; this keeps LeadState (and lead.json) small and lets the
// same image be reused across a retry without re-uploading it.

export function uploadDir(): string {
  return env('SWARM_LEAD_UPLOAD_DIR', join(homedir(), '.claude', 'swarm', 'uploads'))
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export function extensionForType(type: unknown): string | undefined {
  return typeof type === 'string' ? EXT_BY_TYPE[type] : undefined
}

/** The exact shape an upload id must have: no path traversal, no surprises. */
const UPLOAD_ID_RE = /^[a-z0-9]{8,}\.(png|jpg|jpeg|webp|gif)$/

export function isValidUploadId(id: unknown): id is string {
  return typeof id === 'string' && UPLOAD_ID_RE.test(id)
}

/** A fresh id with the given extension; always matches `isValidUploadId`. */
export function randomUploadId(ext: string): string {
  return `${randomBytes(8).toString('hex')}.${ext}`
}

export interface SavedUpload {
  id: string
  url: string
  name: string
}

/** Validates, then writes an uploaded image (and its metadata) to `uploadDir()`. */
export function saveUpload(name: string, type: string, data: Buffer): SavedUpload {
  const ext = extensionForType(type)
  if (!ext) throw new Error('Unsupported image type')
  if (data.length === 0) throw new Error('Empty image data')
  if (data.length > MAX_UPLOAD_BYTES) throw new Error(`Image larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`)
  const id = randomUploadId(ext)
  const dir = uploadDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, id), data)
  const safeName = (name.trim() || 'image').slice(0, 200)
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ name: safeName, type }))
  return { id, url: `/api/lead/upload?id=${id}`, name: safeName }
}

export interface StoredUpload {
  path: string
  type: string
  name: string
}

/** Looks up a previously saved upload by id; undefined when the id is invalid or missing. */
export function loadUpload(id: unknown): StoredUpload | undefined {
  if (!isValidUploadId(id)) return undefined
  const dir = uploadDir()
  const path = join(dir, id)
  if (!existsSync(path)) return undefined
  let name = id
  let type = 'application/octet-stream'
  try {
    const meta = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'))
    if (typeof meta.name === 'string' && meta.name) name = meta.name
    if (typeof meta.type === 'string' && meta.type) type = meta.type
  } catch {
    /* serve the bytes with a generic type/name rather than fail */
  }
  return { path, type, name }
}

/** Turns a previously uploaded id into a `LeadImage`; undefined when unknown. */
export function resolveImage(id: unknown): LeadImage | undefined {
  const u = loadUpload(id)
  if (!u || typeof id !== 'string') return undefined
  return { id, url: `/api/lead/upload?id=${id}`, name: u.name }
}

/**
 * Prepends one line per attached image (naming its absolute path, which
 * `claude -p` reads the image from, and its original filename) to the
 * prompt text sent to `claude`. The original `prompt` stays untouched in
 * `LeadRun`/`LeadWaiting` so the UI shows what the user typed.
 */
export function augmentPrompt(prompt: string, images: LeadImage[] | undefined, dir: string = uploadDir()): string {
  if (!images || images.length === 0) return prompt
  const lines = images.map((img) => `[Attached image: ${join(dir, img.id)} (${img.name})]`)
  return `${lines.join('\n')}\n\n${prompt}`
}

interface PersistedState {
  sessionId: string | null
  started: boolean
  model?: string
  subagentModel?: string
  /** The run in flight, so a server restart can pick it up again. */
  running?: LeadRun | null
  waiting?: LeadWaiting[]
  history?: LeadRun[]
}

/** Where a detached run writes its prompt, output and errors. */
function runDir(): string {
  return join(dirname(stateFile()), 'runs')
}

/**
 * How runs are launched.
 *
 * - `systemd` (set on the agent box): each run is its own transient systemd
 *   *user* unit (`systemd-run --user`), outside the dashboard's cgroup, so
 *   restarting or stopping the dashboard never kills the lead or its
 *   subagents. Output goes to files; the server polls the unit and reads them.
 * - `direct` (default, local dev and tests): a child process of the server.
 */
function launchMode(): 'systemd' | 'direct' {
  return process.env.SWARM_LEAD_DETACH === 'systemd' ? 'systemd' : 'direct'
}

const POLL_MS = 2000

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

function readTail(path: string | undefined, max: number): string {
  if (!path) return ''
  try {
    const s = readFileSync(path, 'utf8')
    return s.length > max ? s.slice(-max) : s
  } catch {
    return ''
  }
}

/** Turns claude's `--output-format json` output (or its absence) into ok + reply. */
export function parseResult(out: string, err: string, exitOk: boolean): { ok: boolean; reply: string } {
  let ok = exitOk
  let reply = ''
  try {
    const j = JSON.parse(out)
    reply = typeof j.result === 'string' ? j.result : ''
    if (j.is_error) ok = false
    else if (!exitOk && reply) ok = true
  } catch {
    reply = out.trim()
    if (!reply) ok = false
  }
  if (!ok && !reply) reply = err.trim() || 'claude exited without a reply'
  return { ok, reply: reply || '(no reply)' }
}

export class Lead {
  private sessionId: string | null = null
  private started = false
  private running: LeadRun | null = null
  private child: ChildProcess | null = null
  private waiting: LeadWaiting[] = []
  private history: LeadRun[] = []
  private poll: ReturnType<typeof setInterval> | null = null
  private polling = false

  model: string
  subagentModel: string

  readonly cwd = env('SWARM_LEAD_CWD', join(homedir(), 'stormlight'))
  readonly permissionMode = env('SWARM_LEAD_PERMISSION_MODE', 'bypassPermissions')

  constructor() {
    const allowed = allowedModels()
    this.model = env('SWARM_LEAD_MODEL', DEFAULT_MODELS[0])
    this.subagentModel = env('SWARM_LEAD_SUBAGENT_MODEL', DEFAULT_MODELS[1] ?? DEFAULT_MODELS[0])
    try {
      const j: Partial<PersistedState> = JSON.parse(readFileSync(stateFile(), 'utf8'))
      if (typeof j.sessionId === 'string') {
        this.sessionId = j.sessionId
        this.started = j.started === true
      }
      if (isAllowedModel(j.model, allowed)) this.model = j.model
      if (isAllowedModel(j.subagentModel, allowed)) this.subagentModel = j.subagentModel
      if (Array.isArray(j.history)) this.history = j.history.slice(0, KEEP_HISTORY)
      if (Array.isArray(j.waiting)) this.waiting = j.waiting
      if (j.running && typeof j.running.startedAt === 'number') this.running = j.running
    } catch {
      /* first run */
    }
    // A run that was in flight when the server stopped: a detached unit may
    // still be working, so watch it; a direct child died with the server.
    if (this.running) {
      if (this.running.unit && launchMode() === 'systemd') this.watch(this.running)
      else this.finish(this.running, false, 'Interrupted: the dashboard restarted while this was running.')
    } else {
      this.next()
    }
  }

  getState(): LeadState {
    const models = allowedModels()
    return {
      sessionId: this.sessionId,
      model: this.model,
      subagentModel: this.subagentModel,
      models,
      subagentModels: models,
      cwd: this.cwd,
      running: this.running,
      waiting: [...this.waiting],
      history: [...this.history],
    }
  }

  /**
   * Validates and persists a model change. Does not touch the session: the
   * next run just passes the new `--model`, and (for the subagent model) the
   * appended system prompt picks it up.
   */
  setModel(model?: string, subagentModel?: string): LeadState {
    const allowed = allowedModels()
    if (model !== undefined) {
      if (!isAllowedModel(model, allowed)) throw new Error(`Unknown model "${model}"`)
      this.model = model
    }
    if (subagentModel !== undefined) {
      if (!isAllowedModel(subagentModel, allowed)) throw new Error(`Unknown subagent model "${subagentModel}"`)
      this.subagentModel = subagentModel
    }
    this.save()
    return this.getState()
  }

  /** Queue a prompt (with optional previously-uploaded image ids); starts at once when the lead is idle. */
  send(prompt: string, imageIds?: string[]): LeadState {
    const p = prompt.trim()
    if (!p) throw new Error('Empty prompt')
    if (p.length > MAX_PROMPT) throw new Error(`Prompt longer than ${MAX_PROMPT} characters`)
    let images: LeadImage[] | undefined
    if (imageIds && imageIds.length > 0) {
      images = imageIds.map((id) => {
        const img = resolveImage(id)
        if (!img) throw new Error(`Unknown image "${id}"`)
        return img
      })
    }
    this.waiting.push({ prompt: p, images })
    this.save()
    this.next()
    return this.getState()
  }

  /** Start a fresh lead conversation next time (the running one finishes). */
  reset(): LeadState {
    this.sessionId = null
    this.started = false
    this.save()
    return this.getState()
  }

  /** Stop the running prompt and drop the waiting ones. */
  stop(): LeadState {
    this.waiting = []
    this.save()
    const r = this.running
    if (r?.unit) void run('systemctl', ['--user', 'stop', r.unit])
    else this.child?.kill('SIGTERM')
    return this.getState()
  }

  private save() {
    try {
      mkdirSync(dirname(stateFile()), { recursive: true })
      const data: PersistedState = {
        sessionId: this.sessionId,
        started: this.started,
        model: this.model,
        subagentModel: this.subagentModel,
        running: this.running,
        waiting: this.waiting,
        history: this.history,
      }
      writeFileSync(stateFile(), JSON.stringify(data))
    } catch {
      /* the lead still works; it just forgets its state on restart */
    }
  }

  private finish(r: LeadRun, ok: boolean, reply: string) {
    if (this.running !== r) return
    if (this.poll) clearInterval(this.poll)
    this.poll = null
    r.endedAt = Date.now()
    r.ok = ok
    r.reply = trim(reply, MAX_REPLY)
    delete r.unit
    delete r.out
    delete r.err
    this.history = [r, ...this.history].slice(0, KEEP_HISTORY)
    this.running = null
    this.child = null
    this.save()
    this.next()
  }

  /** Polls a detached run's unit; when it is gone, reads its output and finishes. */
  private watch(r: LeadRun) {
    if (this.poll) clearInterval(this.poll)
    const check = async () => {
      if (this.polling || this.running !== r || !r.unit) return
      this.polling = true
      try {
        const { stdout } = await run('systemctl', ['--user', 'is-active', r.unit])
        const st = stdout.trim()
        if (st === 'active' || st === 'activating' || st === 'reloading' || st === 'deactivating') return
        const { ok, reply } = parseResult(readTail(r.out, 400_000), readTail(r.err, 20_000), st !== 'failed')
        this.finish(r, ok, reply)
      } finally {
        this.polling = false
      }
    }
    this.poll = setInterval(check, POLL_MS)
    void check()
  }

  private next() {
    if (this.running || this.waiting.length === 0) return
    const { prompt, images } = this.waiting.shift()!
    if (!this.sessionId) {
      this.sessionId = randomUUID()
      this.started = false
    }
    const spawnPrompt = augmentPrompt(prompt, images)
    const args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      this.model,
      '--permission-mode',
      this.permissionMode,
      '--append-system-prompt',
      systemPrompt(this.subagentModel, maxConcurrent()),
      ...(this.started ? ['--resume', this.sessionId] : ['--session-id', this.sessionId]),
    ]
    const r: LeadRun = { prompt, images, startedAt: Date.now(), model: this.model }
    this.running = r
    this.started = true
    this.save()
    if (launchMode() === 'systemd') this.launchDetached(r, args, spawnPrompt)
    else this.launchDirect(r, args, spawnPrompt)
  }

  /** `systemd-run --user`: survives dashboard restarts. The prompt goes in on stdin from a file. */
  private launchDetached(r: LeadRun, args: string[], prompt: string) {
    const dir = runDir()
    const base = join(dir, String(r.startedAt))
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(`${base}.prompt`, prompt)
    } catch (e) {
      this.finish(r, false, `Could not write the prompt file: ${(e as Error).message}`)
      return
    }
    r.unit = `swarm-lead-${r.startedAt}`
    r.out = `${base}.json`
    r.err = `${base}.err`
    this.save()
    const keepEnv = ['PATH', 'HOME', 'LANG', 'SWARM_TRANSCRIPTS_DIR']
      .filter((k) => process.env[k])
      .map((k) => `--setenv=${k}=${process.env[k]}`)
    const sdArgs = [
      '--user',
      `--unit=${r.unit}`,
      '--collect',
      '--quiet',
      '--expand-environment=no',
      `--working-directory=${this.cwd}`,
      ...keepEnv,
      `--property=StandardInput=file:${base}.prompt`,
      `--property=StandardOutput=truncate:${r.out}`,
      `--property=StandardError=truncate:${r.err}`,
      '--',
      'claude',
      ...args,
    ]
    void run('systemd-run', sdArgs).then(({ code, stderr }) => {
      if (code !== 0) this.finish(r, false, `Could not start the lead (systemd-run): ${stderr.trim() || `exit ${code}`}`)
      else this.watch(r)
    })
  }

  /** A child of the server: simplest, but dies when the server does. */
  private launchDirect(r: LeadRun, args: string[], prompt: string) {
    let out = ''
    let err = ''
    const child = spawn('claude', args, { cwd: this.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    child.stdin.end(prompt)
    child.stdout.on('data', (b) => (out = (out + b).slice(-400_000)))
    child.stderr.on('data', (b) => (err = (err + b).slice(-20_000)))
    child.on('error', (e) => this.finish(r, false, `Could not start claude: ${e.message}`))
    child.on('close', (code, signal) => {
      const { ok, reply } = parseResult(out, err, code === 0)
      this.finish(r, ok && !signal, signal ? `Stopped (${signal}). ${reply}` : reply)
    })
  }
}

const KEY = Symbol.for('swarm.lead')

export function getLead(): Lead {
  const g = globalThis as unknown as Record<symbol, Lead | undefined>
  return (g[KEY] ??= new Lead())
}
