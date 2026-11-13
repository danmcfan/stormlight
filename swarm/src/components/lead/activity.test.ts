import { describe, expect, it } from 'vitest'
import type { Agent, SwarmSnapshot, TokenUsage, ToolCall } from '../../lib/types'
import { MAX_CALLS, selectActivity, totalCalls } from './activity'

const zero: TokenUsage = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }

function call(id: string, name: string, at: number, summary?: string): ToolCall {
  return { id, name, at, summary: summary ?? `${name} thing-${id}` }
}

function agent(partial: Partial<Agent> & Pick<Agent, 'id' | 'sessionId' | 'parentId' | 'kind'>): Agent {
  return {
    label: partial.id,
    model: 'claude-sonnet-5-5',
    status: 'running',
    roundId: null,
    startedAt: 0,
    lastActivityAt: 0,
    turns: 0,
    usage: zero,
    costUsd: 0,
    toolCalls: [],
    touched: {},
    ...partial,
  }
}

function snapshot(agents: Agent[]): SwarmSnapshot {
  return {
    generatedAt: Date.now(),
    sessions: [],
    agents,
    rounds: [],
    components: [],
    totals: { usage: zero, costUsd: 0, byModel: {} },
    pricingNote: '',
  }
}

describe('selectActivity', () => {
  it('returns the empty selection with no snapshot, no sessionId, or no matching main agent', () => {
    const lead = agent({ id: 'main', sessionId: 's1', parentId: null, kind: 'main' })
    const snap = snapshot([lead])
    expect(selectActivity(undefined, 's1', 0, undefined)).toEqual({
      lead: null,
      calls: [],
      earlierCount: 0,
      subagents: [],
    })
    expect(selectActivity(snap, null, 0, undefined).lead).toBeNull()
    expect(selectActivity(snap, 'no-such-session', 0, undefined).lead).toBeNull()
  })

  it('filters tool calls to the [from, to] window', () => {
    const calls = [call('a', 'Read', 100), call('b', 'Edit', 200), call('c', 'Bash', 300)]
    const lead = agent({ id: 'main', sessionId: 's1', parentId: null, kind: 'main', toolCalls: calls })
    const snap = snapshot([lead])

    expect(selectActivity(snap, 's1', 150, 250).calls.map((g) => g.id)).toEqual(['b'])
    expect(selectActivity(snap, 's1', 0, undefined).calls.map((g) => g.id)).toEqual(['a', 'b', 'c'])
    expect(selectActivity(snap, 's1', 0, 150).calls.map((g) => g.id)).toEqual(['a'])
    // to undefined means "still open": a call after `from` with no upper bound is included.
    expect(selectActivity(snap, 's1', 250, undefined).calls.map((g) => g.id)).toEqual(['c'])
  })

  it('groups consecutive calls of the same tool, keeping the latest summary/id/at', () => {
    const calls = [
      call('a', 'Read', 100, 'Read src/a.ts'),
      call('b', 'Read', 110, 'Read src/b.ts'),
      call('c', 'Read', 120, 'Read src/c.ts'),
      call('d', 'Edit', 130, 'Edit src/c.ts'),
      call('e', 'Read', 140, 'Read src/d.ts'),
    ]
    const lead = agent({ id: 'main', sessionId: 's1', parentId: null, kind: 'main', toolCalls: calls })
    const snap = snapshot([lead])

    const sel = selectActivity(snap, 's1', 0, undefined)
    expect(sel.calls).toEqual([
      { name: 'Read', count: 3, summary: 'Read src/c.ts', id: 'c', at: 120 },
      { name: 'Edit', count: 1, summary: 'Edit src/c.ts', id: 'd', at: 130 },
      { name: 'Read', count: 1, summary: 'Read src/d.ts', id: 'e', at: 140 },
    ])
  })

  it('caps the window to the most recent MAX_CALLS and reports the rest as earlierCount', () => {
    const calls = Array.from({ length: MAX_CALLS + 7 }, (_, i) => call(`c${i}`, i % 2 ? 'Read' : 'Edit', i))
    const lead = agent({ id: 'main', sessionId: 's1', parentId: null, kind: 'main', toolCalls: calls })
    const snap = snapshot([lead])

    const sel = selectActivity(snap, 's1', 0, undefined)
    expect(sel.earlierCount).toBe(7)
    // the kept calls are the most recent ones, oldest of the kept slice first
    expect(sel.calls[0].id).toBe('c7')
    expect(sel.calls[sel.calls.length - 1].id).toBe(`c${MAX_CALLS + 6}`)
    expect(totalCalls(sel)).toBe(MAX_CALLS + 7)
  })

  it('attributes subagents by parentId and filters them to the window by startedAt', () => {
    const lead = agent({ id: 'main', sessionId: 's1', parentId: null, kind: 'main' })
    const early = agent({
      id: 'sub-early',
      sessionId: 's1',
      parentId: 'main',
      kind: 'subagent',
      startedAt: 50,
      description: 'Survey the combat module',
      model: 'claude-sonnet-5-5',
      status: 'done',
    })
    const inWindow = agent({
      id: 'sub-in',
      sessionId: 's1',
      parentId: 'main',
      kind: 'subagent',
      startedAt: 150,
      description: 'Build the render pipeline',
      model: 'claude-sonnet-5-5',
      status: 'running',
      currentActivity: 'Edit src/render/humanoid.ts',
    })
    const otherParent = agent({
      id: 'sub-other',
      sessionId: 's1',
      parentId: 'some-other-agent',
      kind: 'subagent',
      startedAt: 160,
    })
    const snap = snapshot([lead, early, inWindow, otherParent])

    const sel = selectActivity(snap, 's1', 100, 200)
    expect(sel.subagents).toEqual([
      {
        id: 'sub-in',
        label: 'sub-in',
        description: 'Build the render pipeline',
        model: 'claude-sonnet-5-5',
        status: 'running',
        currentActivity: 'Edit src/render/humanoid.ts',
      },
    ])
  })

  it('is the empty case when the lead has no calls and launched no subagents in the window', () => {
    const lead = agent({ id: 'main', sessionId: 's1', parentId: null, kind: 'main' })
    const snap = snapshot([lead])

    const sel = selectActivity(snap, 's1', 0, undefined)
    expect(sel.lead).toBe(lead)
    expect(sel.calls).toEqual([])
    expect(sel.subagents).toEqual([])
    expect(totalCalls(sel)).toBe(0)
  })
})
