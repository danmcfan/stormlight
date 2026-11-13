import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Agent, PlanReading, SwarmSnapshot } from '../lib/types'
import { PlanReader, applyPlan, parseReading, parseReadings, windowPoints } from './plan'

const H = 3_600_000
const rd = (at: number, five: number, reset5 = 5 * H, seven?: number): PlanReading => ({
  at,
  fiveHour: { utilization: five, resetsAt: reset5 },
  ...(seven !== undefined ? { sevenDay: { utilization: seven, resetsAt: 100 * H } } : {}),
})

function snap(agents: Partial<Agent>[], startedAt = H, lastActivityAt = 2 * H): SwarmSnapshot {
  const full = agents.map((a, i) => ({ id: `a${i}`, sessionId: 's', model: 'm', costUsd: 0, ...a }) as Agent)
  return {
    generatedAt: 0,
    sessions: [{ id: 's', cwd: '/', startedAt, lastActivityAt, agentIds: full.map((a) => a.id) }],
    agents: full,
    rounds: [],
    components: [],
    totals: { usage: {} as any, costUsd: 0, byModel: {} },
    pricingNote: '',
  }
}

describe('parsing', () => {
  it('tolerates malformed lines and missing windows', () => {
    const text = ['not json', '{"at":1}', '{"at":5,"sevenDay":{"utilization":0.3}}', '', '{"at":2,"fiveHour":{"utilization":0.1,"resetsAt":9}}'].join('\n')
    const rs = parseReadings(text)
    expect(rs.map((r) => r.at)).toEqual([2, 5])
    expect(rs[1].fiveHour).toBeUndefined()
    expect(parseReading('{"at":"x","fiveHour":{"utilization":0.1}}')).toBeUndefined()
  })
})

describe('windowPoints', () => {
  it('subtracts the reading at/before start from the one at the end', () => {
    const rs = [rd(0, 0.1), rd(H, 0.12), rd(2 * H, 0.2)]
    expect(windowPoints(rs, 'fiveHour', H + 1, 2 * H)!.pointsUsed).toBeCloseTo(8)
  })
  it('uses the first reading after start when none is before it', () => {
    const rs = [rd(H, 0.05), rd(2 * H, 0.1)]
    expect(windowPoints(rs, 'fiveHour', 0, 3 * H)!.pointsUsed).toBeCloseTo(5)
  })
  it('a single reading gives zero points but still reports the latest', () => {
    const w = windowPoints([rd(H, 0.4)], 'fiveHour', 0, 2 * H)!
    expect(w.pointsUsed).toBe(0)
    expect(w.latestUtilization).toBe(0.4)
    expect(w.resetsAt).toBe(5 * H)
  })
  it('sums pieces across a reset, counting the new period from zero', () => {
    const rs = [rd(0, 0.5, 5 * H), rd(H, 0.9, 5 * H), rd(6 * H, 0.03, 10 * H), rd(7 * H, 0.1, 10 * H)]
    // 0.5 -> 0.9 in the first period, then 0 -> 0.1 in the second.
    expect(windowPoints(rs, 'fiveHour', 0, 7 * H)!.pointsUsed).toBeCloseTo(50)
  })
  it('never goes negative', () => {
    const rs = [rd(0, 0.5), rd(H, 0.2)]
    expect(windowPoints(rs, 'fiveHour', 0, H)!.pointsUsed).toBe(0)
  })
  it('is undefined without readings of that window', () => {
    expect(windowPoints([rd(0, 0.1)], 'sevenDay', 0, H)).toBeUndefined()
    expect(windowPoints([], 'fiveHour', 0, H)).toBeUndefined()
  })
})

describe('applyPlan', () => {
  it('leaves the snapshot alone without readings', () => {
    const s = applyPlan(snap([{ costUsd: 1 }]), [])
    expect(s.plan).toBeUndefined()
    expect(s.agents[0].plan).toBeUndefined()
  })
  it('splits points by cost share and rolls up by model', () => {
    const s = applyPlan(
      snap([{ costUsd: 3, model: 'opus' }, { costUsd: 1, model: 'sonnet' }]),
      [rd(0, 0.1, 5 * H, 0.2), rd(H, 0.1, 5 * H, 0.2), rd(2 * H, 0.18, 5 * H, 0.24)],
    )
    expect(s.agents[0].plan!.fiveHour).toBeCloseTo(6)
    expect(s.agents[1].plan!.fiveHour).toBeCloseTo(2)
    expect(s.agents[0].plan!.sevenDay).toBeCloseTo(3)
    expect(s.sessions[0].plan!.fiveHour!.pointsUsed).toBeCloseTo(8)
    expect(s.sessions[0].plan!.costPerFiveHourPoint).toBeCloseTo(0.5)
    expect(s.plan!.byModel.opus.fiveHour).toBeCloseTo(6)
    expect(s.plan!.latest!.at).toBe(2 * H)
    expect(s.plan!.note).toMatch(/estimate/i)
  })
  it('omits $/point when no points were used, and keeps zero-cost agents at 0', () => {
    const s = applyPlan(snap([{ costUsd: 0 }]), [rd(0, 0.1), rd(2 * H, 0.1)])
    expect(s.sessions[0].plan!.costPerFiveHourPoint).toBeUndefined()
    expect(s.agents[0].plan!.fiveHour).toBe(0)
  })
  it('keeps only the last 200 readings', () => {
    const rs = Array.from({ length: 300 }, (_, i) => rd(i, 0.1))
    expect(applyPlan(snap([{ costUsd: 1 }]), rs).plan!.readings).toHaveLength(200)
  })
})

describe('PlanReader', () => {
  it('has no readings for a missing file', () => {
    const r = new PlanReader(join(tmpdir(), 'swarm-nonexistent-plan.jsonl'))
    expect(r.poll()).toBe(false)
    expect(r.readings).toEqual([])
  })
  it('reads appended lines incrementally and holds back a partial one', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'plan-')), 'p.jsonl')
    writeFileSync(f, 'junk\n{"at":1,"fiveHour":{"utilization":0.1,"resetsAt":9}}\n{"at":2,"fiveHo')
    const r = new PlanReader(f)
    expect(r.poll()).toBe(true)
    expect(r.readings).toHaveLength(1)
    expect(r.poll()).toBe(false)
    appendFileSync(f, 'ur":{"utilization":0.2,"resetsAt":9}}\n')
    expect(r.poll()).toBe(true)
    expect(r.readings.map((x) => x.at)).toEqual([1, 2])
  })
})
