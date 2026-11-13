import { describe, expect, it } from 'vitest'
import { fixture } from './fixture'
import { buildRows, type Filters } from './rows'

const all: Filters = { round: 'all', status: 'all', model: 'all', query: '' }

describe('buildRows', () => {
  it('lists the main agent first with subagents under it by round', () => {
    const rows = buildRows(fixture, all, 'tree', false, Date.now())
    expect(rows[0].agent.kind).toBe('main')
    expect(rows.slice(1).every((r) => r.depth === 1)).toBe(true)
    expect(rows.slice(1).map((r) => r.round)).toEqual([1, 1, 1, 2, 2, 2])
  })

  it('filters by round, status and text', () => {
    const now = Date.now()
    expect(buildRows(fixture, { ...all, round: '2' }, 'tree', false, now)).toHaveLength(3)
    expect(buildRows(fixture, { ...all, status: 'error' }, 'tree', false, now)).toHaveLength(1)
    expect(buildRows(fixture, { ...all, query: 'RENDER' }, 'tree', false, now).length).toBeGreaterThan(0)
  })

  it('sorts flat by a column', () => {
    const rows = buildRows(fixture, all, 'cost', true, Date.now())
    expect(rows[0].agent.id).toBe('main')
    expect(rows.every((r) => r.depth === 0)).toBe(true)
  })
})
