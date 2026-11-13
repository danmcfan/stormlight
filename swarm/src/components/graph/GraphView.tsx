import { For, Show, createEffect, createMemo, createSignal, onSettled } from 'solid-js'
import { Button } from '@ui-sdk/solid/button'
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/solid/segmented-control'
import { Switch, SwitchThumb } from '@ui-sdk/solid/switch'
import type { SwarmSnapshot } from '../../lib/types'
import { createLayout, type Layout } from './layout'
import {
  FAMILY_COLOR,
  STATUS_LABEL,
  buildGraph,
  clamp,
  edgeWidth,
  isRecent,
  neighborIds,
  recency,
  roundIndexes,
  shortModel,
  type GraphNode,
  type ModelFamily,
} from './model'
import Panel from './Panel'
import './graph.css'

interface View {
  x: number
  y: number
  k: number
}

const MIN_K = 0.12
const MAX_K = 4

function hex(r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`
  }).join(' ')
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export default function GraphView(props: { snapshot: SwarmSnapshot | undefined; connected: boolean }) {
  const [round, setRound] = createSignal('all')
  const [showUntouched, setShowUntouched] = createSignal(true)
  const [selected, setSelected] = createSignal<string | null>(null)
  const [hover, setHover] = createSignal<{ id: string; x: number; y: number } | null>(null)
  const [view, setView] = createSignal<View>({ x: 0, y: 0, k: 1 })
  const [tick, setTick] = createSignal(0)
  const [clock, setClock] = createSignal(Date.now())

  let svgEl!: SVGSVGElement
  let pageEl!: HTMLDivElement
  let layout: Layout | undefined
  let cur: View = { x: 0, y: 0, k: 1 }
  let autoFit = true
  let size = { w: 800, h: 600 }

  const setV = (v: View) => {
    cur = v
    setView(v)
  }

  const graph = createMemo(() =>
    props.snapshot
      ? buildGraph(props.snapshot, { round: round(), showUntouched: showUntouched() })
      : { nodes: [] as GraphNode[], links: [] },
  )
  const nodeById = createMemo(() => new Map(graph().nodes.map((n) => [n.id, n])))
  const rounds = createMemo(() => (props.snapshot ? roundIndexes(props.snapshot) : []))

  const base = createMemo(() => (props.snapshot ? { gen: props.snapshot.generatedAt, local: Date.now() } : null))
  const now = () => {
    const b = base()
    return b ? b.gen + (clock() - b.local) : clock()
  }

  const neighbors = createMemo(() => {
    const s = selected()
    return s ? neighborIds(graph(), s) : null
  })

  const pos = (id: string): [number, number] => {
    tick()
    const n = layout?.nodes.get(id)
    return [n?.x ?? 0, n?.y ?? 0]
  }

  function fit() {
    const b = layout?.bounds()
    if (!b) return
    const pad = 56
    const bw = Math.max(b.x1 - b.x0, 80)
    const bh = Math.max(b.y1 - b.y0, 80)
    const k = clamp(Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh), MIN_K, 1.5)
    setV({ k, x: size.w / 2 - ((b.x0 + b.x1) / 2) * k, y: size.h / 2 - ((b.y0 + b.y1) / 2) * k })
  }

  createEffect(
    () => graph(),
    (g) => {
      layout?.sync(g)
    },
  )

  onSettled(() => {
    let raf = 0
    layout = createLayout(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (autoFit) fit()
        setTick((t) => t + 1)
      })
    })
    layout.sync(graph())

    const measure = () => {
      pageEl.style.setProperty('--graph-top', `${pageEl.getBoundingClientRect().top + window.scrollY}px`)
      const r = svgEl.getBoundingClientRect()
      size = { w: r.width, h: r.height }
      if (autoFit) fit()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(svgEl)

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = svgEl.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
    }
    svgEl.addEventListener('wheel', onWheel, { passive: false })
    const timer = setInterval(() => setClock(Date.now()), 1000)

    return () => {
      clearInterval(timer)
      ro.disconnect()
      svgEl.removeEventListener('wheel', onWheel)
      if (raf) cancelAnimationFrame(raf)
      layout?.stop()
      layout = undefined
    }
  })

  function zoomAt(px: number, py: number, factor: number) {
    autoFit = false
    const k = clamp(cur.k * factor, MIN_K, MAX_K)
    const wx = (px - cur.x) / cur.k
    const wy = (py - cur.y) / cur.k
    setV({ k, x: px - wx * k, y: py - wy * k })
  }

  const zoomCenter = (f: number) => zoomAt(size.w / 2, size.h / 2, f)

  const pointers = new Map<number, { x: number; y: number }>()
  let mode: 'none' | 'pan' | 'drag' | 'pinch' = 'none'
  let downNode: string | null = null
  let moved = 0
  let last = { x: 0, y: 0 }
  let pinch = { d: 1, k: 1, wx: 0, wy: 0 }

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgEl.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const nodeAt = (t: EventTarget | null) => (t as Element | null)?.closest?.('[data-node]')?.getAttribute('data-node') ?? null

  function startPinch() {
    const [a, b] = [...pointers.values()]
    const cx = (a.x + b.x) / 2
    const cy = (a.y + b.y) / 2
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: cur.k, wx: (cx - cur.x) / cur.k, wy: (cy - cur.y) / cur.k }
    if (downNode && mode === 'drag') layout?.release(downNode)
    mode = 'pinch'
    moved = 99
  }

  function onPointerDown(e: PointerEvent) {
    const p = local(e)
    pointers.set(e.pointerId, p)
    svgEl.setPointerCapture(e.pointerId)
    setHover(null)
    if (pointers.size === 2) return startPinch()
    if (pointers.size > 2) return
    downNode = nodeAt(e.target)
    mode = downNode ? 'drag' : 'pan'
    moved = 0
    last = p
  }

  function onPointerMove(e: PointerEvent) {
    const p = local(e)
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        const id = nodeAt(e.target)
        setHover(id ? { id, x: p.x, y: p.y } : null)
      }
      return
    }
    pointers.set(e.pointerId, p)
    if (mode === 'pinch' && pointers.size >= 2) {
      autoFit = false
      const [a, b] = [...pointers.values()]
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      const k = clamp((pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d, MIN_K, MAX_K)
      setV({ k, x: cx - pinch.wx * k, y: cy - pinch.wy * k })
      return
    }
    const dx = p.x - last.x
    const dy = p.y - last.y
    moved += Math.abs(dx) + Math.abs(dy)
    last = p
    if (mode === 'pan' && moved > 3) {
      autoFit = false
      setV({ ...cur, x: cur.x + dx, y: cur.y + dy })
    } else if (mode === 'drag' && downNode && moved > 5) {
      autoFit = false
      layout?.pin(downNode, (p.x - cur.x) / cur.k, (p.y - cur.y) / cur.k)
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return
    if (pointers.size === 1 && mode === 'pinch') {
      mode = 'pan'
      last = [...pointers.values()][0]
      downNode = null
      return
    }
    if (pointers.size > 0) return
    if (mode === 'drag' && downNode) {
      layout?.release(downNode)
      if (moved <= 5) setSelected(downNode)
    } else if (mode === 'pan' && moved <= 3) {
      setSelected(null)
    }
    mode = 'none'
    downNode = null
  }

  const onNodeKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSelected(id)
    }
  }

  const dim = (id: string) => {
    const nb = neighbors()
    return nb !== null && !nb.has(id)
  }

  const tooltip = createMemo(() => {
    const h = hover()
    const n = h && nodeById().get(h.id)
    return h && n ? { h, n } : null
  })

  const tipStyle = (h: { x: number; y: number }) => {
    const flip = h.x > size.w - 240
    return { left: `${flip ? h.x - 14 : h.x + 14}px`, top: `${h.y + 14}px`, transform: flip ? 'translateX(-100%)' : 'none' }
  }

  const families: ModelFamily[] = ['opus', 'sonnet', 'haiku', 'other']

  return (
    <div ref={pageEl} class={['graph-page', { 'has-sel': selected() !== null }]}>
      <div class="graph-canvas" >
        <svg
          ref={svgEl}
          class="graph-svg"
          aria-label="Agent and component graph"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHover(null)}
        >
          <g transform={`translate(${view().x} ${view().y}) scale(${view().k})`}>
            <g class="links">
              <For each={graph().links} keyed={(l) => l.id}>
                {(l) => {
                  const s = () => pos(l().source)
                  const t = () => pos(l().target)
                  const hot = () => l().kind !== 'tree' && isRecent(l().lastAt, now())
                  const incident = () => selected() === l().source || selected() === l().target
                  return (
                    <line
                      class={['edge', l().kind, { hot: hot(), dim: selected() !== null && !incident(), lit: incident() }]}
                      x1={s()[0]}
                      y1={s()[1]}
                      x2={t()[0]}
                      y2={t()[1]}
                      stroke-width={l().kind === 'touch' ? edgeWidth(l().count) : l().kind === 'spawn' ? 1.6 : 1}
                      style={hot() ? { 'stroke-opacity': 0.55 + 0.45 * recency(l().lastAt, now()) } : undefined}
                    />
                  )
                }}
              </For>
            </g>
            <g class="nodes">
              <For each={graph().nodes} keyed={(n) => n.id}>
                {(n) => {
                  const p = () => pos(n().id)
                  const hot = () => isRecent(n().lastAt, now()) && (n().kind === 'component' || n().status === 'running')
                  const color = () => (n().family ? FAMILY_COLOR[n().family!] : undefined)
                  const showLabel = () =>
                    n().kind === 'agent' || n().r >= 9 || view().k > 1.2 || (neighbors()?.has(n().id) ?? false) || hover()?.id === n().id
                  return (
                    <g
                      class={[
                        'node',
                        n().kind,
                        {
                          hot: hot(),
                          dim: dim(n().id),
                          sel: selected() === n().id,
                          done: n().status === 'done' || n().status === 'idle',
                          running: n().status === 'running',
                          error: n().status === 'error',
                        },
                      ]}
                      transform={`translate(${p()[0]} ${p()[1]})`}
                      data-node={n().id}
                      tabindex="0"
                      role="button"
                      aria-label={`${n().kind === 'agent' ? 'Agent' : 'Component'} ${n().label}`}
                      onKeyDown={(e) => onNodeKey(e, n().id)}
                    >
                      <Show when={hot()}>
                        <circle class="halo" r={n().r + 7} />
                      </Show>
                      <Show when={n().status === 'running'}>
                        <polygon class="ring" points={hex(n().r + 5)} style={{ stroke: color() }} />
                      </Show>
                      <Show
                        when={n().kind === 'agent'}
                        fallback={<circle class="shape comp" r={n().r} style={{ '--depth': Math.min(n().depth ?? 0, 4) }} />}
                      >
                        <polygon class="shape" points={hex(n().r)} style={{ fill: color(), stroke: color() }} />
                        <Show when={n().main}>
                          <circle class="core" r={n().r * 0.38} />
                        </Show>
                      </Show>
                      <Show when={showLabel()}>
                        <text class="lbl" y={n().r + 12} text-anchor="middle">
                          {trunc(n().label, 22)}
                        </text>
                      </Show>
                      <Show when={n().activity}>
                        <text class="act" y={n().r + 24} text-anchor="middle">
                          {trunc(n().activity!, 38)}
                        </text>
                      </Show>
                    </g>
                  )
                }}
              </For>
            </g>
          </g>
        </svg>

        <Show when={tooltip()}>
          {(t) => (
            <div class="graph-tip" style={tipStyle(t().h)} aria-hidden="true">
              <strong>{t().n.label}</strong>
              <Show
                when={t().n.kind === 'agent'}
                fallback={
                  <span>
                    {t().n.refId === '.' ? 'repo root' : t().n.refId} · {t().n.fileCount} files
                  </span>
                }
              >
                <span>
                  {STATUS_LABEL[t().n.status!]} · {shortModel(props.snapshot?.agents.find((a) => a.id === t().n.refId)?.model ?? '')}
                </span>
                <Show when={t().n.activity}>
                  <span class="mono">{t().n.activity}</span>
                </Show>
              </Show>
            </div>
          )}
        </Show>

        <div class="graph-toolbar">
          <SegmentedControl aria-label="Round" value={round()} onValueChange={(v) => v && setRound(v)}>
            <SegmentedControlIndicator />
            <SegmentedControlItem value="all">All</SegmentedControlItem>
            <For each={rounds()}>{(i) => <SegmentedControlItem value={String(i)}>Round {i}</SegmentedControlItem>}</For>
          </SegmentedControl>
          <label class="graph-switch">
            <Switch checked={showUntouched()} onCheckedChange={(v) => setShowUntouched(v)}>
              <SwitchThumb />
            </Switch>
            Untouched components
          </label>
          <Button
            class="graph-btn"
            onClick={() => {
              autoFit = true
              fit()
            }}
          >
            Fit to view
          </Button>
          <div class="graph-zoom">
            <Button class="graph-btn" aria-label="Zoom in" onClick={() => zoomCenter(1.3)}>
              +
            </Button>
            <Button class="graph-btn" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.3)}>
              −
            </Button>
          </div>
        </div>

        <div class="graph-legend">
          <For each={families}>
            {(f) => (
              <span>
                <svg width="12" height="12" viewBox="-7 -7 14 14" aria-hidden="true">
                  <polygon points={hex(6)} fill={FAMILY_COLOR[f]} />
                </svg>
                {f}
              </span>
            )}
          </For>
          <span>
            <i class="lg-run" />
            running
          </span>
          <span>
            <i class="lg-done" />
            done
          </span>
          <span>
            <svg width="12" height="12" viewBox="-7 -7 14 14" aria-hidden="true">
              <circle r="5.5" class="lg-comp" />
            </svg>
            directory
          </span>
          <span>
            <i class="lg-edge" />
            active &lt;10s
          </span>
        </div>

        <Show when={!props.snapshot}>
          <p class="graph-empty">{props.connected ? 'Loading swarm…' : 'Connecting to the swarm…'}</p>
        </Show>
        <Show when={props.snapshot && graph().nodes.length === 0}>
          <p class="graph-empty">Nothing to show for this filter.</p>
        </Show>
      </div>

      <Show when={selected() && props.snapshot}>
        <Panel
          snapshot={props.snapshot!}
          selectedId={selected()!}
          now={now()}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
        />
      </Show>
    </div>
  )
}
