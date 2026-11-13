import type { Agent, AgentStatus, SwarmSnapshot } from '../../lib/types'

export type SortKey =
  | 'tree'
  | 'status'
  | 'label'
  | 'kind'
  | 'model'
  | 'round'
  | 'started'
  | 'duration'
  | 'turns'
  | 'input'
  | 'output'
  | 'cacheRead'
  | 'cost'

export interface Filters {
  /** Round index as a string, or 'all'. */
  round: string
  /** A status, or 'all'. */
  status: AgentStatus | 'all'
  /** A model id, or 'all'. */
  model: string
  query: string
}

export interface Row {
  agent: Agent
  depth: number
  round: number | null
}

export function roundIndexes(snapshot: SwarmSnapshot): Map<string, number> {
  return new Map(snapshot.rounds.map((r) => [r.id, r.index]))
}

export function agentDuration(a: Agent, now: number): number {
  const end = a.endedAt ?? (a.status === 'running' ? now : a.lastActivityAt)
  return Math.max(0, end - a.startedAt)
}

export function treeOrder(snapshot: SwarmSnapshot): Row[] {
  const rounds = roundIndexes(snapshot)
  const roundOf = (a: Agent) => (a.roundId ? (rounds.get(a.roundId) ?? null) : null)
  const byId = new Map(snapshot.agents.map((a) => [a.id, a]))
  const children = new Map<string, Agent[]>()
  const roots: Agent[] = []
  for (const a of snapshot.agents) {
    if (a.parentId && byId.has(a.parentId)) {
      const list = children.get(a.parentId) ?? []
      list.push(a)
      children.set(a.parentId, list)
    } else roots.push(a)
  }
  const byLaunch = (x: Agent, y: Agent) =>
    (roundOf(x) ?? 0) - (roundOf(y) ?? 0) || x.startedAt - y.startedAt
  roots.sort((x, y) => (x.kind === y.kind ? y.startedAt - x.startedAt : x.kind === 'main' ? -1 : 1))
  const out: Row[] = []
  const seen = new Set<string>()
  const walk = (a: Agent, depth: number) => {
    if (seen.has(a.id)) return
    seen.add(a.id)
    out.push({ agent: a, depth, round: roundOf(a) })
    for (const c of (children.get(a.id) ?? []).sort(byLaunch)) walk(c, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return out
}

function sortValue(row: Row, key: SortKey, now: number): number | string {
  const a = row.agent
  switch (key) {
    case 'status':
      return ['running', 'idle', 'error', 'done'].indexOf(a.status)
    case 'label':
      return a.label.toLowerCase()
    case 'kind':
      return a.kind
    case 'model':
      return a.model
    case 'round':
      return row.round ?? 0
    case 'started':
      return a.startedAt
    case 'duration':
      return agentDuration(a, now)
    case 'turns':
      return a.turns
    case 'input':
      return a.usage.input
    case 'output':
      return a.usage.output
    case 'cacheRead':
      return a.usage.cacheRead
    case 'cost':
      return a.costUsd
    default:
      return 0
  }
}

export function buildRows(
  snapshot: SwarmSnapshot,
  filters: Filters,
  sort: SortKey,
  desc: boolean,
  now: number,
): Row[] {
  const q = filters.query.trim().toLowerCase()
  let rows = treeOrder(snapshot).filter(({ agent, round }) => {
    if (filters.round !== 'all' && String(round) !== filters.round) return false
    if (filters.status !== 'all' && agent.status !== filters.status) return false
    if (filters.model !== 'all' && agent.model !== filters.model) return false
    if (!q) return true
    return [agent.label, agent.id, agent.model, agent.description, agent.currentActivity]
      .filter(Boolean)
      .some((s) => s!.toLowerCase().includes(q))
  })
  if (sort !== 'tree') {
    const dir = desc ? -1 : 1
    rows = rows
      .map((r) => ({ ...r, depth: 0 }))
      .sort((x, y) => {
        const vx = sortValue(x, sort, now)
        const vy = sortValue(y, sort, now)
        return (vx < vy ? -1 : vx > vy ? 1 : 0) * dir
      })
  }
  return rows
}
