import { describe, expect, it } from 'vitest'
import type { Agent, SwarmSnapshot } from '../../lib/types'
import { buildGraph, isRecent, modelFamily, neighborIds, recency, roundIndexes } from './model'

const usage = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }
const T = 1_000_000

function agent(p: Partial<Agent> & { id: string }): Agent {
  return {
    sessionId: 's',
    parentId: null,
    kind: 'main',
    label: p.id,
    model: 'claude-opus-4-7',
    status: 'running',
    roundId: null,
    startedAt: T - 100_000,
    lastActivityAt: T,
    turns: 1,
    usage,
    costUsd: 0,
    toolCalls: [],
    touched: {},
    ...p,
  }
}

const snap: SwarmSnapshot = {
  generatedAt: T,
  sessions: [],
  agents: [
    agent({ id: 'm' }),
    agent({
      id: 'a',
      parentId: 'm',
      kind: 'subagent',
      roundId: 'r1',
      touched: { 'src/x': 3, ghost: 2 },
      toolCalls: [
        { id: '1', name: 'Edit', at: T - 2000, componentId: 'src/x', summary: 'Edit' },
        { id: '2', name: 'Read', at: T - 60_000, componentId: 'src/x', summary: 'Read' },
      ],
    }),
    agent({ id: 'b', parentId: 'm', kind: 'subagent', roundId: 'r2', touched: { docs: 1 } }),
  ],
  rounds: [
    { id: 'r1', sessionId: 's', index: 1, startedAt: 0, agentIds: ['a'], usage, costUsd: 0 },
    { id: 'r2', sessionId: 's', index: 2, startedAt: 0, agentIds: ['b'], usage, costUsd: 0 },
  ],
  components: [
    { id: '.', label: 'repo', parentId: null, fileCount: 1 },
    { id: 'src', label: 'src', parentId: '.', fileCount: 2 },
    { id: 'src/x', label: 'x', parentId: 'src', fileCount: 4 },
    { id: 'docs', label: 'docs', parentId: '.', fileCount: 5 },
    { id: 'tests', label: 'tests', parentId: '.', fileCount: 5 },
  ],
  totals: { usage, costUsd: 0, byModel: {} },
  pricingNote: '',
}

const ids = (g: { nodes: { id: string }[] }) => g.nodes.map((n) => n.id).sort()

describe('buildGraph', () => {
  it('shows every component and agent when untouched are shown', () => {
    const g = buildGraph(snap, { round: 'all', showUntouched: true })
    expect(g.nodes.filter((n) => n.kind === 'component')).toHaveLength(5)
    expect(g.nodes.filter((n) => n.kind === 'agent')).toHaveLength(3)
  })

  it('hides untouched components but keeps ancestors of touched ones', () => {
    const g = buildGraph(snap, { round: 'all', showUntouched: false })
    expect(ids(g)).not.toContain('c:tests')
    expect(ids(g)).toEqual(expect.arrayContaining(['c:.', 'c:src', 'c:src/x', 'c:docs']))
  })

  it('filters by round, keeping the parent agent', () => {
    const g = buildGraph(snap, { round: '2', showUntouched: false })
    expect(ids(g).filter((i) => i.startsWith('a:'))).toEqual(['a:b', 'a:m'])
    expect(ids(g)).not.toContain('c:src/x')
  })

  it('links agents to known components only, with counts and recency', () => {
    const g = buildGraph(snap, { round: 'all', showUntouched: true })
    const touch = g.links.filter((l) => l.kind === 'touch' && l.source === 'a:a')
    expect(touch).toHaveLength(1)
    expect(touch[0]).toMatchObject({ target: 'c:src/x', count: 3, lastAt: T - 2000 })
  })

  it('adds spawn and tree links', () => {
    const g = buildGraph(snap, { round: 'all', showUntouched: true })
    expect(g.links.some((l) => l.kind === 'spawn' && l.source === 'a:m' && l.target === 'a:a')).toBe(true)
    expect(g.links.some((l) => l.kind === 'tree' && l.source === 'c:src' && l.target === 'c:src/x')).toBe(true)
  })
})

describe('helpers', () => {
  it('classifies model families', () => {
    expect(modelFamily('claude-sonnet-5-5')).toBe('sonnet')
    expect(modelFamily('claude-opus-4-7')).toBe('opus')
    expect(modelFamily('claude-haiku-4-5')).toBe('haiku')
    expect(modelFamily('gpt')).toBe('other')
  })
  it('judges recency against a window', () => {
    expect(isRecent(T - 9000, T)).toBe(true)
    expect(isRecent(T - 11_000, T)).toBe(false)
    expect(isRecent(0, T)).toBe(false)
    expect(recency(T - 5000, T)).toBeCloseTo(0.5)
  })
  it('lists distinct round indexes and neighbors', () => {
    expect(roundIndexes(snap)).toEqual([1, 2])
    const g = buildGraph(snap, { round: 'all', showUntouched: true })
    expect([...neighborIds(g, 'a:a')].sort()).toEqual(['a:a', 'a:m', 'c:src/x'])
  })
})
