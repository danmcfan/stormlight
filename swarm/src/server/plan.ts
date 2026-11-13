// Plan-usage attribution. Pure logic plus an incremental JSONL reader. Server only.
//
// Readings of the account's 5-hour and 7-day rate-limit windows are appended to
// a JSONL file (SWARM_PLAN_USAGE_FILE, default ~/.claude/swarm/plan-usage.jsonl).
// A session's points used = utilization at the end of its span minus utilization
// at its start, summed across window periods (resets). Each agent gets a share
// proportional to its API-equivalent cost. This is an estimate.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PlanReading, PlanWindowUsage, SwarmSnapshot } from '../lib/types'
import { splitLines } from './parse'

export type WindowKey = 'fiveHour' | 'sevenDay'
const WINDOWS: WindowKey[] = ['fiveHour', 'sevenDay']
const RESET_TOLERANCE_MS = 60_000
const KEEP = 200

export const planNote =
  'Estimate: plan usage is assumed proportional to API-equivalent cost (Anthropic does not publish the exact rule), ' +
  'and utilization moves in whole-percent steps. The windows count all usage on the account, including other sessions running at the same time.'

export function planFile(): string {
  return process.env.SWARM_PLAN_USAGE_FILE || join(homedir(), '.claude', 'swarm', 'plan-usage.jsonl')
}

function win(v: any): { utilization: number; resetsAt?: number } | undefined {
  if (!v || typeof v !== 'object') return undefined
  const u = Number(v.utilization)
  if (!Number.isFinite(u)) return undefined
  const r = Number(v.resetsAt)
  return { utilization: u, resetsAt: Number.isFinite(r) && v.resetsAt != null ? r : undefined }
}

/** Parse one line; undefined when malformed or without a usable window. */
export function parseReading(line: string): PlanReading | undefined {
  let j: any
  try {
    j = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!j || typeof j !== 'object' || !Number.isFinite(Number(j.at))) return undefined
  const fiveHour = win(j.fiveHour)
  const sevenDay = win(j.sevenDay)
  if (!fiveHour && !sevenDay) return undefined
  const r: PlanReading = { at: Number(j.at) }
  if (typeof j.source === 'string') r.source = j.source
  if (fiveHour) r.fiveHour = fiveHour
  if (sevenDay) r.sevenDay = sevenDay
  if (typeof j.isUsingOverage === 'boolean') r.isUsingOverage = j.isUsingOverage
  return r
}

export function parseReadings(text: string): PlanReading[] {
  const out: PlanReading[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const r = parseReading(line)
    if (r) out.push(r)
  }
  return out.sort((a, b) => a.at - b.at)
}

/**
 * Points (0..100 scale) one window moved between `start` and `end` (epoch ms).
 * Start reading: latest at or before start, else the first after. End reading:
 * first at or after end, else the last. Across a reset the earlier period ends
 * at its last reading and the new one is counted from 0. Never negative.
 */
export function windowPoints(readings: PlanReading[], key: WindowKey, start: number, end: number): PlanWindowUsage | undefined {
  const rs = readings.filter((r) => r[key]).sort((a, b) => a.at - b.at)
  if (rs.length === 0) return undefined
  const latest = rs[rs.length - 1][key]!
  let si = -1
  for (let i = 0; i < rs.length; i++) if (rs[i].at <= start) si = i
  if (si < 0) si = 0
  let ei = rs.findIndex((r) => r.at >= end)
  if (ei < 0) ei = rs.length - 1
  if (ei < si) ei = si
  const same = (a?: number, b?: number) => a === b || (a !== undefined && b !== undefined && Math.abs(a - b) <= RESET_TOLERANCE_MS)
  let points = 0
  let periodStart = rs[si][key]!.utilization
  let prev = rs[si]
  for (let i = si + 1; i <= ei; i++) {
    const cur = rs[i]
    if (!same(prev[key]!.resetsAt, cur[key]!.resetsAt)) {
      points += Math.max(0, prev[key]!.utilization - periodStart)
      periodStart = 0
    }
    prev = cur
  }
  points += Math.max(0, prev[key]!.utilization - periodStart)
  return { pointsUsed: points * 100, latestUtilization: latest.utilization, resetsAt: latest.resetsAt }
}

/** Adds plan fields to a snapshot in place. Does nothing without readings. */
export function applyPlan(snap: SwarmSnapshot, all: PlanReading[]): SwarmSnapshot {
  if (all.length === 0) return snap
  const readings = all.slice(-KEEP)
  const byModel: Record<string, { fiveHour?: number; sevenDay?: number }> = {}
  const byId = new Map(snap.agents.map((a) => [a.id, a]))
  for (const s of snap.sessions) {
    const agents = s.agentIds.map((id) => byId.get(id)).filter((a) => !!a)
    const cost = agents.reduce((n, a) => n + a.costUsd, 0)
    const plan: NonNullable<typeof s.plan> = {}
    for (const key of WINDOWS) {
      const u = windowPoints(all, key, s.startedAt, s.lastActivityAt)
      if (!u) continue
      plan[key] = u
      for (const a of agents) {
        const pts = cost > 0 ? (a.costUsd / cost) * u.pointsUsed : 0
        ;(a.plan ??= {})[key] = pts
        const m = (byModel[a.model] ??= {})
        m[key] = (m[key] ?? 0) + pts
      }
    }
    if (plan.fiveHour && plan.fiveHour.pointsUsed > 0 && cost > 0) plan.costPerFiveHourPoint = cost / plan.fiveHour.pointsUsed
    if (plan.fiveHour || plan.sevenDay) s.plan = plan
  }
  snap.plan = { readings, latest: all[all.length - 1], note: planNote, byModel }
  return snap
}

/** Reads appended bytes of the plan file; keeps all parsed readings. */
export class PlanReader {
  readings: PlanReading[] = []
  private offset = 0
  private rest: Buffer = Buffer.alloc(0)
  constructor(private path = planFile()) {}

  /** True when the readings changed. A missing file yields no readings. */
  poll(): boolean {
    let fd: number | undefined
    try {
      fd = openSync(this.path, 'r')
      const size = fstatSync(fd).size
      let changed = false
      if (size < this.offset) {
        this.readings = []
        this.offset = 0
        this.rest = Buffer.alloc(0)
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
          const r = parseReading(l)
          if (r) {
            this.readings.push(r)
            changed = true
          }
        }
      }
      if (changed) this.readings.sort((a, b) => a.at - b.at)
      return changed
    } catch {
      const had = this.readings.length > 0
      this.readings = []
      this.offset = 0
      this.rest = Buffer.alloc(0)
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
}
