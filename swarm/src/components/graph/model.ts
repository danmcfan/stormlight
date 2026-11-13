import type { Agent, AgentStatus, SwarmSnapshot, TokenUsage } from '../../lib/types'

export const RECENT_MS = 10_000

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'other'

export const FAMILY_COLOR: Record<ModelFamily, string> = {
  opus: '#9a8cff',
  sonnet: '#6cc4ff',
  haiku: '#5be3f0',
  other: '#8ea3c6',
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  running: 'Running',
  idle: 'Idle',
  done: 'Done',
  error: 'Error',
}

export function modelFamily(model: string): ModelFamily {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  return 'other'
}

export interface GraphNode {
  /** "a:<agentId>" or "c:<componentId>". */
  id: string
  kind: 'agent' | 'component'
  /** Agent id or component id without the prefix. */
  refId: string
  label: string
  r: number
  /** Epoch ms of the latest activity on this node; 0 when none. */
  lastAt: number
  family?: ModelFamily
  status?: AgentStatus
  main?: boolean
  fileCount?: number
  depth?: number
  untouched?: boolean
  activity?: string
}

export interface GraphLink {
  id: string
  source: string
  target: string
  kind: 'touch' | 'spawn' | 'tree'
  count: number
  lastAt: number
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

export interface GraphOptions {
  /** "all" or a round index as a string. */
  round: string
  showUntouched: boolean
}

export const agentNodeId = (id: string) => `a:${id}`
export const componentNodeId = (id: string) => `c:${id}`

export function componentRadius(fileCount: number): number {
  return Math.min(26, 5 + Math.sqrt(Math.max(0, fileCount)) * 1.7)
}

export function agentRadius(main: boolean): number {
  return main ? 15 : 11
}

export function edgeWidth(count: number): number {
  return Math.min(7, 1 + Math.log2(1 + Math.max(0, count)) * 0.8)
}

export function isRecent(lastAt: number, now: number, windowMs = RECENT_MS): boolean {
  return lastAt > 0 && now - lastAt <= windowMs
}

/** 1 when just touched, fading to 0 at the end of the window. */
export function recency(lastAt: number, now: number, windowMs = RECENT_MS): number {
  if (!lastAt) return 0
  return Math.max(0, Math.min(1, 1 - (now - lastAt) / windowMs))
}

export function roundIndexes(snapshot: SwarmSnapshot): number[] {
  return [...new Set(snapshot.rounds.map((r) => r.index))].sort((a, b) => a - b)
}

function agentVisible(a: Agent, roundByAgent: Map<string, number>, round: string, keepParents: Set<string>): boolean {
  if (round === 'all') return true
  if (a.kind === 'subagent') return roundByAgent.get(a.id) === Number(round)
  return keepParents.has(a.id)
}

export function buildGraph(snapshot: SwarmSnapshot, opts: GraphOptions): GraphData {
  const compById = new Map(snapshot.components.map((c) => [c.id, c]))
  const roundByAgent = new Map<string, number>()
  for (const r of snapshot.rounds) for (const id of r.agentIds) roundByAgent.set(id, r.index)

  const keepParents = new Set<string>()
  if (opts.round !== 'all') {
    for (const a of snapshot.agents) {
      if (a.kind === 'subagent' && roundByAgent.get(a.id) === Number(opts.round) && a.parentId) {
        keepParents.add(a.parentId)
      }
    }
  }
  const agents = snapshot.agents.filter((a) => agentVisible(a, roundByAgent, opts.round, keepParents))
  const agentIds = new Set(agents.map((a) => a.id))

  const compLast = new Map<string, number>()
  const touchLinks: GraphLink[] = []
  const usedComps = new Set<string>()
  for (const a of agents) {
    const last = new Map<string, number>()
    for (const t of a.toolCalls) {
      if (t.componentId && t.at > (last.get(t.componentId) ?? 0)) last.set(t.componentId, t.at)
    }
    for (const [cid, count] of Object.entries(a.touched)) {
      if (!compById.has(cid) || count <= 0) continue
      usedComps.add(cid)
      const lastAt = last.get(cid) ?? 0
      compLast.set(cid, Math.max(compLast.get(cid) ?? 0, lastAt))
      touchLinks.push({
        id: `t:${a.id}>${cid}`,
        source: agentNodeId(a.id),
        target: componentNodeId(cid),
        kind: 'touch',
        count,
        lastAt,
      })
    }
  }

  const visibleComps = new Set<string>()
  if (opts.showUntouched) {
    for (const c of snapshot.components) visibleComps.add(c.id)
  } else {
    for (const id of usedComps) {
      let cur: string | null = id
      while (cur && !visibleComps.has(cur)) {
        visibleComps.add(cur)
        cur = compById.get(cur)?.parentId ?? null
      }
    }
  }

  const depthOf = (id: string): number => {
    let d = 0
    let cur = compById.get(id)?.parentId ?? null
    while (cur && d < 32) {
      d++
      cur = compById.get(cur)?.parentId ?? null
    }
    return d
  }

  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  for (const c of snapshot.components) {
    if (!visibleComps.has(c.id)) continue
    nodes.push({
      id: componentNodeId(c.id),
      kind: 'component',
      refId: c.id,
      label: c.label,
      r: componentRadius(c.fileCount) * (usedComps.has(c.id) ? 1 : 0.6),
      untouched: !usedComps.has(c.id),
      lastAt: compLast.get(c.id) ?? 0,
      fileCount: c.fileCount,
      depth: depthOf(c.id),
    })
    if (c.parentId && visibleComps.has(c.parentId)) {
      links.push({
        id: `p:${c.parentId}>${c.id}`,
        source: componentNodeId(c.parentId),
        target: componentNodeId(c.id),
        kind: 'tree',
        count: 0,
        lastAt: 0,
      })
    }
  }
  for (const a of agents) {
    const main = a.kind === 'main'
    nodes.push({
      id: agentNodeId(a.id),
      kind: 'agent',
      refId: a.id,
      label: a.label,
      r: agentRadius(main),
      lastAt: a.lastActivityAt,
      family: modelFamily(a.model),
      status: a.status,
      main,
      activity: a.status === 'running' && a.currentActivity ? shortActivity(a.currentActivity) : undefined,
    })
    if (a.parentId && agentIds.has(a.parentId)) {
      links.push({
        id: `s:${a.parentId}>${a.id}`,
        source: agentNodeId(a.parentId),
        target: agentNodeId(a.id),
        kind: 'spawn',
        count: 0,
        lastAt: a.startedAt,
      })
    }
  }
  links.push(...touchLinks)
  return { nodes, links }
}

export function neighborIds(data: GraphData, id: string): Set<string> {
  const out = new Set<string>([id])
  for (const l of data.links) {
    if (l.source === id) out.add(l.target)
    else if (l.target === id) out.add(l.source)
  }
  return out
}

export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead
}

export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(Math.round(n))
}

export function fmtCost(usd: number): string {
  if (usd < 0.01) return '$0.00'
  return usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`
}

export function fmtAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Short model name for display: claude-sonnet-5-5 -> sonnet 5.5. */
export function shortModel(model: string): string {
  const m = model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  const parts = m.split('-')
  const fam = parts[0]
  const ver = parts.slice(1).join('.')
  return ver ? `${fam} ${ver}` : fam
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** "Bash S=/tmp/a/b/c.ts && x" -> "Bash b/c.ts": the tool plus a short target. */
export function shortActivity(summary: string, max = 28): string {
  const [tool, ...rest] = summary.trim().split(/\s+/)
  const target = rest.find((t) => t.includes('/')) ?? rest[0] ?? ''
  const path = target.replace(/^[A-Za-z_]+=/, '').replace(/^["'`]|["'`;]+$/g, '')
  const short = path.includes('/') ? path.split('/').filter(Boolean).slice(-2).join('/') : path
  const out = short ? `${tool} ${short}` : tool
  return out.length > max ? out.slice(0, max - 1) + '…' : out
}

/** Vertical nudges so labels of agents drawn near each other do not overlap. */
export function labelOffsets(pts: { id: string; x: number; y: number }[], w = 130, h = 28): Map<string, number> {
  const out = new Map<string, number>()
  const placed: { x: number; y: number }[] = []
  for (const p of [...pts].sort((a, b) => a.y - b.y)) {
    let dy = 0
    for (let i = 0; i < 8; i++) {
      const hit = placed.find((q) => Math.abs(q.x - p.x) < w && Math.abs(q.y - (p.y + dy)) < h)
      if (!hit) break
      dy = hit.y + h - p.y
    }
    out.set(p.id, dy)
    placed.push({ x: p.x, y: p.y + dy })
  }
  return out
}
