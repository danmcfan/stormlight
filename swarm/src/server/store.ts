// Transcript discovery and incremental reading. Server only.
//
// Layout under the root (SWARM_TRANSCRIPTS_DIR, default ~/.claude/projects):
//   <project>/<sessionId>.jsonl
//   <project>/<sessionId>/subagents/agent-<agentId>.jsonl (+ .meta.json)
// Each file keeps a byte offset; a poll reads only appended bytes and keeps an
// unterminated last line for the next round.
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  watch,
  type FSWatcher,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Component, SwarmSnapshot } from '../lib/types'
import { AgentAcc, buildSnapshot, splitLines, type AgentMeta, type SessionInput } from './parse'
import { scanComponents } from './components'
import { PlanReader, applyPlan } from './plan'
import { QueueReader, applyQueue } from './queue'

const POLL_MS = 1000
const DISCOVER_MS = 3000
const SCAN_TTL_MS = 30_000
const CHUNK = 4 * 1024 * 1024

interface FileEntry {
  path: string
  sessionId: string
  agentId: string | null
  offset: number
  rest: Buffer
  acc: AgentAcc
  metaPath?: string
  metaDone: boolean
}

interface SessionEntry {
  id: string
  main?: FileEntry
  subs: Map<string, FileEntry>
}

export function transcriptsRoot(): string {
  return process.env.SWARM_TRANSCRIPTS_DIR || join(homedir(), '.claude', 'projects')
}

function maxAgeMs(): number {
  const h = Number(process.env.SWARM_MAX_AGE_HOURS ?? 24)
  return Number.isFinite(h) && h > 0 ? h * 3_600_000 : Infinity
}

function safeReaddir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export class SwarmStore {
  readonly root: string
  private files = new Map<string, FileEntry>()
  private sessions = new Map<string, SessionEntry>()
  private listeners = new Set<(s: SwarmSnapshot) => void>()
  private scans = new Map<string, { at: number; components: Component[] }>()
  private plan = new PlanReader()
  private queue = new QueueReader()
  private snapshot: SwarmSnapshot | undefined
  private snapshotKey = ''
  private lastBuild = 0
  private lastDiscover = 0
  private lastPoll = 0
  private dirty = true
  private timer: ReturnType<typeof setInterval> | undefined
  private watcher: FSWatcher | undefined
  private watchTimer: ReturnType<typeof setTimeout> | undefined

  constructor(root = transcriptsRoot()) {
    this.root = root
  }

  /** Start polling and watching. Idempotent. */
  start() {
    if (this.timer) return
    this.refresh(true)
    this.timer = setInterval(() => this.refresh(false), POLL_MS)
    this.timer.unref?.()
    try {
      this.watcher = watch(this.root, { recursive: true }, () => {
        // Debounce bursts of events into one early poll.
        if (this.watchTimer) return
        this.watchTimer = setTimeout(() => {
          this.watchTimer = undefined
          this.lastDiscover = 0
          this.refresh(false)
        }, 100)
      })
      this.watcher.on('error', () => this.watcher?.close())
      this.watcher.unref?.()
    } catch {
      // fs.watch is best effort; the poll covers it.
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.watcher?.close()
    this.watcher = undefined
  }

  subscribe(fn: (s: SwarmSnapshot) => void): () => void {
    this.start()
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Current snapshot, refreshed if the last poll is stale. */
  getSnapshot(): SwarmSnapshot {
    this.start()
    if (Date.now() - this.lastPoll > 500 || !this.snapshot) this.refresh(false)
    return this.snapshot!
  }

  /** Poll files, rebuild the snapshot if needed, notify listeners on change. */
  refresh(force: boolean) {
    const now = Date.now()
    this.lastPoll = now
    try {
      if (force || now - this.lastDiscover >= DISCOVER_MS) {
        this.lastDiscover = now
        this.discover()
      }
      this.readAll()
      if (this.plan.poll()) this.dirty = true
      if (this.queue.poll()) this.dirty = true
    } catch {
      // never let a bad file take the poller down
    }
    const hasLive = this.snapshot?.agents.some((a) => a.status === 'running') ?? false
    const stale = now - this.lastBuild >= (hasLive ? 2000 : 5000)
    if (!this.snapshot || this.dirty || stale) this.rebuild(now)
  }

  private rebuild(now: number) {
    this.dirty = false
    this.lastBuild = now
    const inputs: SessionInput[] = []
    for (const s of this.sessions.values()) {
      const main = s.main?.acc
      const subs = [...s.subs.values()].map((f) => f.acc)
      const cwd = main?.cwd ?? subs.find((a) => a.cwd)?.cwd
      inputs.push({ id: s.id, main, subs, components: cwd ? this.componentsFor(cwd, now) : [] })
    }
    const snap = applyQueue(applyPlan(buildSnapshot(inputs, now), this.plan.readings), this.queue.events)
    const key = JSON.stringify({ ...snap, generatedAt: 0 })
    const changed = key !== this.snapshotKey || !this.snapshot
    this.snapshot = snap
    this.snapshotKey = key
    if (changed) for (const fn of this.listeners) fn(snap)
  }

  private componentsFor(cwd: string, now: number): Component[] {
    const hit = this.scans.get(cwd)
    if (hit && now - hit.at < SCAN_TTL_MS) return hit.components
    let components: Component[] = []
    try {
      components = scanComponents(cwd)
    } catch {
      /* directory may not exist on this machine */
    }
    this.scans.set(cwd, { at: now, components })
    return components
  }

  // ---- discovery ----

  private discover() {
    const cutoff = Date.now() - maxAgeMs()
    const recent = (p: string) => {
      if (this.files.has(p)) return true
      try {
        return statSync(p).mtimeMs >= cutoff
      } catch {
        return false
      }
    }
    for (const proj of safeReaddir(this.root)) {
      if (!proj.isDirectory()) continue
      const pdir = join(this.root, proj.name)
      for (const e of safeReaddir(pdir)) {
        const p = join(pdir, e.name)
        if (e.isFile() && e.name.endsWith('.jsonl')) {
          if (recent(p)) this.track(p, basename(e.name, '.jsonl'), null)
        } else if (e.isDirectory()) {
          const sdir = join(p, 'subagents')
          if (!existsSync(sdir)) continue
          for (const f of safeReaddir(sdir)) {
            const m = /^agent-(.+)\.jsonl$/.exec(f.name)
            if (!f.isFile() || !m) continue
            const fp = join(sdir, f.name)
            if (recent(fp)) this.track(fp, e.name, m[1])
          }
        }
      }
    }
  }

  private track(path: string, sessionId: string, agentId: string | null) {
    if (this.files.has(path)) return
    const entry: FileEntry = {
      path,
      sessionId,
      agentId,
      offset: 0,
      rest: Buffer.alloc(0),
      acc: new AgentAcc(sessionId, agentId),
      metaPath: agentId ? path.replace(/\.jsonl$/, '.meta.json') : undefined,
      metaDone: agentId === null,
    }
    this.files.set(path, entry)
    let s = this.sessions.get(sessionId)
    if (!s) this.sessions.set(sessionId, (s = { id: sessionId, subs: new Map() }))
    if (agentId) s.subs.set(agentId, entry)
    else s.main = entry
    this.dirty = true
  }

  // ---- reading ----

  private readAll() {
    // Main transcripts first, so subagents learn the session root before ingesting.
    const entries = [...this.files.values()].sort((a, b) => Number(a.agentId !== null) - Number(b.agentId !== null))
    for (const f of entries) {
      if (f.agentId) {
        const main = this.sessions.get(f.sessionId)?.main?.acc
        if (main?.cwd) f.acc.rootCwd = main.cwd
        if (!f.metaDone) this.readMeta(f)
      }
      this.readAppended(f)
    }
  }

  private readMeta(f: FileEntry) {
    if (!f.metaPath) return
    try {
      const j = JSON.parse(readFileSync(f.metaPath, 'utf8'))
      const meta: AgentMeta = {
        description: typeof j.description === 'string' ? j.description : undefined,
        agentType: typeof j.agentType === 'string' ? j.agentType : undefined,
        model: typeof j.model === 'string' ? j.model : undefined,
        toolUseId: typeof j.toolUseId === 'string' ? j.toolUseId : undefined,
      }
      f.acc.meta = meta
      f.metaDone = true
      this.dirty = true
    } catch {
      // not written yet, or unreadable; try again on the next poll
    }
  }

  private readAppended(f: FileEntry) {
    let fd: number | undefined
    try {
      fd = openSync(f.path, 'r')
      const size = fstatSync(fd).size
      if (size < f.offset) {
        // Truncated or rewritten: start over.
        f.acc = new AgentAcc(f.sessionId, f.agentId)
        f.offset = 0
        f.rest = Buffer.alloc(0)
        this.dirty = true
      }
      if (size === f.offset) return
      while (f.offset < size) {
        const len = Math.min(CHUNK, size - f.offset)
        const buf = Buffer.allocUnsafe(len)
        const n = readSync(fd, buf, 0, len, f.offset)
        if (n <= 0) break
        f.offset += n
        const { lines, rest } = splitLines(f.rest, buf.subarray(0, n))
        f.rest = rest
        for (const line of lines) f.acc.ingestLine(line)
      }
      this.dirty = true
    } catch {
      // file vanished or is unreadable; keep what we have
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          /* ignore */
        }
      }
    }
  }
}

const KEY = Symbol.for('swarm.store')

/** Process-wide store (survives Vite HMR re-evaluation of this module). */
export function getStore(): SwarmStore {
  const g = globalThis as any
  const existing: SwarmStore | undefined = g[KEY]
  if (existing && existing.root === transcriptsRoot()) return existing
  existing?.stop()
  const s = new SwarmStore()
  g[KEY] = s
  return s
}
