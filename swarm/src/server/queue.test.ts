import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Agent, SwarmSnapshot } from '../lib/types'
import { QueueReader, applyQueue, foldQueue, parseQueueEvent, type QueueEvent } from './queue'

const ev = (at: number, op: QueueEvent['op'], jobId: string, extra: Partial<QueueEvent> = {}): QueueEvent => ({
  at,
  op,
  jobId,
  label: jobId.toUpperCase(),
  ...extra,
})

describe('parseQueueEvent', () => {
  it('accepts a valid line', () => {
    expect(parseQueueEvent('{"at":5,"op":"queued","jobId":"a","label":"A","model":"m","note":"n"}')).toEqual({
      at: 5,
      op: 'queued',
      jobId: 'a',
      label: 'A',
      model: 'm',
      note: 'n',
    })
  })
  it('rejects malformed lines', () => {
    for (const l of ['', 'nope', '{"at":1,"op":"bogus","jobId":"a"}', '{"op":"queued","jobId":"a"}', '{"at":1,"op":"queued"}', '[]', 'null'])
      expect(parseQueueEvent(l)).toBeUndefined()
  })
})

describe('foldQueue', () => {
  it('numbers queued jobs in queue order and lists queued, running, ended', () => {
    const jobs = foldQueue([
      ev(10, 'queued', 'b'),
      ev(5, 'queued', 'a'),
      ev(20, 'queued', 'r'),
      ev(30, 'started', 'r'),
      ev(1, 'queued', 'f'),
      ev(2, 'started', 'f'),
      ev(40, 'finished', 'f'),
    ])
    expect(jobs.map((j) => [j.jobId, j.state, j.position])).toEqual([
      ['a', 'queued', 1],
      ['b', 'queued', 2],
      ['r', 'running', undefined],
      ['f', 'finished', undefined],
    ])
    expect(jobs[2]).toMatchObject({ queuedAt: 20, startedAt: 30 })
    expect(jobs[3]).toMatchObject({ queuedAt: 1, startedAt: 2, endedAt: 40 })
  })

  it('lets later events override earlier ones and re-numbers', () => {
    const jobs = foldQueue([
      ev(1, 'queued', 'a'),
      ev(2, 'queued', 'b', { model: 'x' }),
      ev(3, 'queued', 'c'),
      ev(4, 'started', 'a'),
      ev(5, 'cancelled', 'b', { note: 'dropped' }),
    ])
    expect(jobs.map((j) => [j.jobId, j.state, j.position])).toEqual([
      ['c', 'queued', 1],
      ['a', 'running', undefined],
      ['b', 'cancelled', undefined],
    ])
    expect(jobs[2]).toMatchObject({ model: 'x', note: 'dropped' })
  })

  it('orders by time, not file order, and keeps the first queue time on requeue', () => {
    const jobs = foldQueue([ev(9, 'started', 'a'), ev(1, 'queued', 'a'), ev(3, 'queued', 'a')])
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ state: 'running', queuedAt: 1, startedAt: 9 })
  })

  it('handles a start with no queued event', () => {
    expect(foldQueue([ev(7, 'started', 'z')])[0]).toMatchObject({ state: 'running', startedAt: 7 })
  })

  it('keeps only the 20 most recent ended jobs, newest first', () => {
    const events: QueueEvent[] = []
    for (let i = 0; i < 25; i++) events.push(ev(100 + i, 'finished', `j${i}`))
    const jobs = foldQueue(events)
    expect(jobs).toHaveLength(20)
    expect(jobs[0].jobId).toBe('j24')
    expect(jobs[19].jobId).toBe('j5')
  })
})

function snap(statuses: Agent['status'][]): SwarmSnapshot {
  return {
    generatedAt: 0,
    sessions: [],
    agents: statuses.map((status, i) => ({ id: `a${i}`, kind: 'subagent', status }) as Agent),
    rounds: [],
    components: [],
    totals: { usage: {} as any, costUsd: 0, byModel: {} },
    pricingNote: '',
  }
}

describe('applyQueue', () => {
  it('counts running agents from the snapshot, not the file', () => {
    const s = applyQueue(snap(['running', 'done', 'running']), [ev(1, 'started', 'a'), ev(2, 'queued', 'b')], 4)
    expect(s.queue).toMatchObject({ maxConcurrent: 4, running: 2 })
    expect(s.queue!.jobs.map((j) => j.jobId)).toEqual(['b', 'a'])
  })
  it('adds nothing without events', () => {
    expect(applyQueue(snap([]), []).queue).toBeUndefined()
  })
})

describe('QueueReader', () => {
  it('reads appended lines incrementally and tolerates junk and a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'queue-'))
    const path = join(dir, 'q.jsonl')
    const r = new QueueReader(path)
    expect(r.poll()).toBe(false)
    writeFileSync(path, JSON.stringify(ev(1, 'queued', 'a')) + '\nnot json\n{"at":2,"op":"star')
    expect(r.poll()).toBe(true)
    expect(r.events).toHaveLength(1)
    appendFileSync(path, 'ted","jobId":"a","label":"A"}\n')
    expect(r.poll()).toBe(true)
    expect(r.events.map((e) => e.op)).toEqual(['queued', 'started'])
    expect(r.poll()).toBe(false)
    writeFileSync(path, JSON.stringify(ev(9, 'queued', 'z')) + '\n')
    expect(r.poll()).toBe(true)
    expect(r.events.map((e) => e.jobId)).toEqual(['z'])
  })
})
