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
//   SWARM_LEAD_PERMISSION_MODE  claude --permission-mode (default bypassPermissions;
//                               headless runs cannot answer permission prompts)
//   SWARM_MAX_AGENTS            parallel subagents the lead may run (default 4)
//   SWARM_LEAD_STATE_FILE       session id store (default ~/.claude/swarm/lead.json)
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { maxConcurrent } from './queue'

export interface LeadRun {
  prompt: string
  startedAt: number
  endedAt?: number
  ok?: boolean
  /** The lead's final reply (or the error), trimmed. */
  reply?: string
}

export interface LeadState {
  sessionId: string | null
  model: string
  subagentModel: string
  cwd: string
  running: LeadRun | null
  waiting: string[]
  /** Most recent first. */
  history: LeadRun[]
}

const MAX_PROMPT = 20_000
const MAX_REPLY = 4_000
const KEEP_HISTORY = 10

function env(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : fallback
}

function stateFile(): string {
  return env('SWARM_LEAD_STATE_FILE', join(homedir(), '.claude', 'swarm', 'lead.json'))
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

export class Lead {
  private sessionId: string | null = null
  private started = false
  private running: LeadRun | null = null
  private child: ChildProcess | null = null
  private waiting: string[] = []
  private history: LeadRun[] = []

  readonly model = env('SWARM_LEAD_MODEL', 'opus')
  readonly subagentModel = env('SWARM_LEAD_SUBAGENT_MODEL', 'sonnet')
  readonly cwd = env('SWARM_LEAD_CWD', join(homedir(), 'stormlight'))
  readonly permissionMode = env('SWARM_LEAD_PERMISSION_MODE', 'bypassPermissions')

  constructor() {
    try {
      const j = JSON.parse(readFileSync(stateFile(), 'utf8'))
      if (typeof j.sessionId === 'string') {
        this.sessionId = j.sessionId
        this.started = j.started === true
      }
    } catch {
      /* first run */
    }
  }

  getState(): LeadState {
    return {
      sessionId: this.sessionId,
      model: this.model,
      subagentModel: this.subagentModel,
      cwd: this.cwd,
      running: this.running,
      waiting: [...this.waiting],
      history: [...this.history],
    }
  }

  /** Queue a prompt; starts at once when the lead is idle. */
  send(prompt: string): LeadState {
    const p = prompt.trim()
    if (!p) throw new Error('Empty prompt')
    if (p.length > MAX_PROMPT) throw new Error(`Prompt longer than ${MAX_PROMPT} characters`)
    this.waiting.push(p)
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
      writeFileSync(stateFile(), JSON.stringify({ sessionId: this.sessionId, started: this.started }))
    } catch {
      /* the lead still works; it just forgets its session on restart */
    }
  }

  private next() {
    if (this.running || this.waiting.length === 0) return
    const prompt = this.waiting.shift()!
    if (!this.sessionId) {
      this.sessionId = randomUUID()
      this.started = false
    }
    const args = [
      '-p',
      prompt,
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
    const run: LeadRun = { prompt, startedAt: Date.now() }
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
