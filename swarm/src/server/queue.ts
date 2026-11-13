// Agent queue. Pure folding logic plus an incremental JSONL reader. Server only.
//
// The lead appends events to SWARM_QUEUE_FILE (default ~/.claude/swarm/queue.jsonl):
//   {"at": ms, "op": "queued"|"started"|"finished"|"cancelled", "jobId", "label", "model"?, "note"?}
// Later events for a jobId override earlier ones.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { QueueJob, SwarmSnapshot } from '../lib/types'
import { splitLines } from './parse'

export type QueueOp = 'queued' | 'started' | 'finished' | 'cancelled'
export interface QueueEvent {
  at: number
  op: QueueOp
  jobId: string
  label: string
  model?: string
  note?: string
}

const OPS: QueueOp[] = ['queued', 'started', 'finished', 'cancelled']
const KEEP_ENDED = 20
const MAX_EVENTS = 5000

export function queueFile(): string {
  return process.env.SWARM_QUEUE_FILE || join(homedir(), '.claude', 'swarm', 'queue.jsonl')
}

export function maxConcurrent(): number {
  const n = Number(process.env.SWARM_MAX_AGENTS ?? 4)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4
}

/** Parse one line; undefined when malformed. */
export function parseQueueEvent(line: string): QueueEvent | undefined {
  let j: any
  try {
    j = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!j || typeof j !== 'object') return undefined
  const at = Number(j.at)
  if (!Number.isFinite(at) || j.at === null || !OPS.includes(j.op)) return undefined
  if (typeof j.jobId !== 'string' || !j.jobId) return undefined
  const e: QueueEvent = { at, op: j.op, jobId: j.jobId, label: typeof j.label === 'string' ? j.label : j.jobId }
  if (typeof j.model === 'string') e.model = j.model
  if (typeof j.note === 'string') e.note = j.note
  return e
}

const STATE: Record<QueueOp, QueueJob['state']> = {
  queued: 'queued',
  started: 'running',
  finished: 'finished',
  cancelled: 'cancelled',
}

/**
 * Folds events (in the order given, after a stable sort by time) into jobs.
 * Queued first by position (earliest queuedAt first), then running by start,
 * then the last 20 finished or cancelled, newest first.
 */
export function foldQueue(events: QueueEvent[]): QueueJob[] {
  const sorted = events.map((e, i) => [e, i] as const).sort((a, b) => a[0].at - b[0].at || a[1] - b[1])
  const jobs = new Map<string, QueueJob>()
  for (const [e] of sorted) {
    const job = jobs.get(e.jobId) ?? { jobId: e.jobId, label: e.label, state: 'queued' as const }
    jobs.set(e.jobId, job)
    job.label = e.label
    if (e.model !== undefined) job.model = e.model
    if (e.note !== undefined) job.note = e.note
    job.state = STATE[e.op]
    if (e.op === 'queued') {
      job.queuedAt ??= e.at
      delete job.startedAt
      delete job.endedAt
    } else if (e.op === 'started') {
      job.startedAt = e.at
      delete job.endedAt
    } else job.endedAt = e.at
  }
  const all = [...jobs.values()]
  const queued = all
    .filter((j) => j.state === 'queued')
    .sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0))
    .map((j, i) => ({ ...j, position: i + 1 }))
  const running = all.filter((j) => j.state === 'running').sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  const ended = all
    .filter((j) => j.state === 'finished' || j.state === 'cancelled')
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, KEEP_ENDED)
  return [...queued, ...running, ...ended]
}

/** Adds the queue to a snapshot in place. Does nothing without events. */
export function applyQueue(snap: SwarmSnapshot, events: QueueEvent[], max = maxConcurrent()): SwarmSnapshot {
  if (events.length === 0) return snap
  snap.queue = {
    maxConcurrent: max,
    running: snap.agents.filter((a) => a.kind === 'subagent' && a.status === 'running').length,
    jobs: foldQueue(events),
  }
  return snap
}

/** Reads appended bytes of the queue file. */
export class QueueReader {
  events: QueueEvent[] = []
  private offset = 0
  private rest: Buffer = Buffer.alloc(0)
  constructor(private path = queueFile()) {}

  /** True when the events changed. A missing file yields no events. */
  poll(): boolean {
    let fd: number | undefined
    try {
      fd = openSync(this.path, 'r')
      const size = fstatSync(fd).size
      let changed = false
      if (size < this.offset) {
        this.reset()
        changed = true
      }
      while (this.offset < size) {
        const len = Math.min(1 << 20, size - this.offset)
        const buf = Buffer.allocUnsafe(len)
        const n = readSync(fd, buf, 0, len, this.offset)
        if (n <= 0) break
        this.offset += n
        const { lines, rest } = splitLines(this.rest, buf.subarray(0, n))
        this.rest = rest
        for (const l of lines) {
          const e = parseQueueEvent(l)
          if (e) {
            this.events.push(e)
            changed = true
          }
        }
      }
      if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS)
      return changed
    } catch {
      const had = this.events.length > 0
      this.reset()
      return had
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

  private reset() {
    this.events = []
    this.offset = 0
    this.rest = Buffer.alloc(0)
  }
}
