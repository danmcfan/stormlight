import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { GraphData, GraphNode } from './model'

export interface SimNode extends SimulationNodeDatum {
  id: string
  kind: GraphNode['kind']
  r: number
  main: boolean
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: 'touch' | 'spawn' | 'tree'
  count: number
}

export interface Layout {
  nodes: Map<string, SimNode>
  sync(data: GraphData): void
  pin(id: string, x: number, y: number): void
  release(id: string): void
  bounds(): { x0: number; y0: number; x1: number; y1: number } | null
  stop(): void
}

/**
 * Wraps one d3-force simulation whose node objects live as long as their id:
 * sync() adds and removes only what changed, so positions stay put across snapshots.
 */
export function createLayout(onTick: () => void): Layout {
  const nodes = new Map<string, SimNode>()
  const linkForce = forceLink<SimNode, SimLink>([])
    .id((d) => d.id)
    .distance((l) => {
      const s = l.source as SimNode
      const t = l.target as SimNode
      if (l.kind === 'tree') return 34 + s.r + t.r
      if (l.kind === 'spawn') return 80
      return 95 + t.r
    })
    .strength((l) => (l.kind === 'tree' ? 0.8 : l.kind === 'spawn' ? 0.5 : 0.1 + Math.min(l.count, 20) * 0.008))

  const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode, SimLink>([])
    .force('link', linkForce)
    .force('charge', forceManyBody<SimNode>().strength((d) => (d.kind === 'agent' ? -320 : -90 - d.r * 5)))
    .force('collide', forceCollide<SimNode>((d) => d.r + (d.kind === 'agent' ? 26 : 8)).strength(0.9))
    .force('x', forceX<SimNode>(0).strength(0.035))
    .force('y', forceY<SimNode>(0).strength(0.035))
    .alphaDecay(0.025)
    .on('tick', onTick)

  let signature = ''

  function place(n: GraphNode, data: GraphData): { x: number; y: number } {
    const anchors: SimNode[] = []
    for (const l of data.links) {
      const other = l.source === n.id ? l.target : l.target === n.id ? l.source : null
      const o = other && nodes.get(other)
      if (o && o.x !== undefined) anchors.push(o)
    }
    if (anchors.length) {
      const cx = anchors.reduce((a, o) => a + (o.x ?? 0), 0) / anchors.length
      const cy = anchors.reduce((a, o) => a + (o.y ?? 0), 0) / anchors.length
      return { x: cx + (Math.random() - 0.5) * 60, y: cy + (Math.random() - 0.5) * 60 }
    }
    const a = Math.random() * Math.PI * 2
    const d = 60 + Math.random() * 160
    return { x: Math.cos(a) * d, y: Math.sin(a) * d }
  }

  return {
    nodes,
    sync(data) {
      const keep = new Set(data.nodes.map((n) => n.id))
      for (const id of [...nodes.keys()]) if (!keep.has(id)) nodes.delete(id)
      for (const n of data.nodes) {
        const existing = nodes.get(n.id)
        if (existing) {
          existing.r = n.r
          continue
        }
        const p = place(n, data)
        nodes.set(n.id, { id: n.id, kind: n.kind, r: n.r, main: !!n.main, x: p.x, y: p.y })
      }
      const sig = data.nodes.map((n) => n.id).join('|') + '#' + data.links.map((l) => l.id).join('|')
      sim.nodes([...nodes.values()])
      linkForce.links(data.links.map((l) => ({ source: l.source, target: l.target, kind: l.kind, count: l.count })))
      if (sig !== signature) {
        signature = sig
        sim.alpha(Math.max(sim.alpha(), 0.5)).restart()
      }
    },
    pin(id, x, y) {
      const n = nodes.get(id)
      if (!n) return
      n.fx = x
      n.fy = y
      sim.alphaTarget(0.25).restart()
    },
    release(id) {
      const n = nodes.get(id)
      if (n) {
        n.fx = null
        n.fy = null
      }
      sim.alphaTarget(0)
    },
    bounds() {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity
      for (const n of nodes.values()) {
        if (n.x === undefined || n.y === undefined) continue
        x0 = Math.min(x0, n.x - n.r)
        y0 = Math.min(y0, n.y - n.r)
        x1 = Math.max(x1, n.x + n.r)
        y1 = Math.max(y1, n.y + n.r)
      }
      return x0 === Infinity ? null : { x0, y0, x1, y1 }
    },
    stop() {
      sim.stop()
    },
  }
}
