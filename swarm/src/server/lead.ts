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
import { spawn, type ChildProcess } from 'node:child_process'
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
    'outside the working tree unless the user asked for exactly that.',
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
}

export class Lead {
  private sessionId: string | null = null
  private started = false
  private running: LeadRun | null = null
  private child: ChildProcess | null = null
  private waiting: LeadWaiting[] = []
  private history: LeadRun[] = []

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
    } catch {
      /* first run */
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
    this.child?.kill('SIGTERM')
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
      }
      writeFileSync(stateFile(), JSON.stringify(data))
    } catch {
      /* the lead still works; it just forgets its session on restart */
    }
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
      spawnPrompt,
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
    const run: LeadRun = { prompt, images, startedAt: Date.now(), model: this.model }
    this.running = run
    this.started = true
    this.save()

    let out = ''
    let err = ''
    const child = spawn('claude', args, { cwd: this.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    child.stdout.on('data', (b) => (out = (out + b).slice(-200_000)))
    child.stderr.on('data', (b) => (err = (err + b).slice(-20_000)))

    const finish = (ok: boolean, reply: string) => {
      if (this.running !== run) return
      run.endedAt = Date.now()
      run.ok = ok
      run.reply = trim(reply, MAX_REPLY)
      this.history = [run, ...this.history].slice(0, KEEP_HISTORY)
      this.running = null
      this.child = null
      this.next()
    }
    child.on('error', (e) => finish(false, `Could not start claude: ${e.message}`))
    child.on('close', (code, signal) => {
      let reply = ''
      let ok = code === 0
      try {
        const j = JSON.parse(out)
        reply = typeof j.result === 'string' ? j.result : ''
        if (j.is_error) ok = false
      } catch {
        reply = out
      }
      if (signal) reply = `Stopped (${signal}). ${reply}`
      if (!ok && !reply) reply = err || `claude exited with code ${code}`
      finish(ok, reply || '(no reply)')
    })
  }
}

const KEY = Symbol.for('swarm.lead')

export function getLead(): Lead {
  const g = globalThis as unknown as Record<symbol, Lead | undefined>
  return (g[KEY] ??= new Lead())
}
