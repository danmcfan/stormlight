import { For, Show } from 'solid-js'
import { GemButton } from '../ui/GemButton'
import { Gem } from '../frame/Gem'
import type { Agent, Component, SwarmSnapshot } from '../../lib/types'
import {
  STATUS_LABEL,
  agentNodeId,
  componentNodeId,
  fmtAgo,
  fmtCost,
  fmtTokens,
  isRecent,
  modelFamily,
  shortModel,
  totalTokens,
} from './model'
import { AgentPlanCell } from '../plan/AgentPlanCell'

interface PanelProps {
  snapshot: SwarmSnapshot
  /** Graph node id ("a:..." or "c:..."). */
  selectedId: string
  now: number
  onSelect: (nodeId: string) => void
  onClose: () => void
}

function Stat(props: { label: string; value: string }) {
  return (
    <div class="gp-stat">
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  )
}

function AgentDetails(props: { agent: Agent; snapshot: SwarmSnapshot; now: number; onSelect: (id: string) => void }) {
  const a = () => props.agent
  const compIds = () => Object.entries(a().touched).sort((x, y) => y[1] - x[1])
  const recent = () => [...a().toolCalls].reverse().slice(0, 14)
  const parent = () => props.snapshot.agents.find((x) => x.id === a().parentId)
  const children = () => props.snapshot.agents.filter((x) => x.parentId === a().id)
  return (
    <div class="gp-frag">
      <div class="gp-tags">
        <span class="chip">
          <Gem family={modelFamily(a().model)} />
          <span class="mono">{shortModel(a().model)}</span>
        </span>
        <span class="chip" data-status={a().status}>
          <span class="st" data-status={a().status} aria-hidden="true">
            <Gem kind={a().status === 'done' ? 'set' : a().status === 'error' ? 'dead' : 'live'} />
          </span>
          {STATUS_LABEL[a().status]}
        </span>
        <span class="chip">{a().kind}</span>
      </div>
      <Show when={a().description}>
        <p class="gp-desc">{a().description}</p>
      </Show>
      <Show when={a().currentActivity && a().status === 'running'}>
        <p class="gp-now">{a().currentActivity}</p>
      </Show>
      <dl class="gp-stats">
        <Stat label="Tokens" value={fmtTokens(totalTokens(a().usage))} />
        <Stat label="Est. cost" value={fmtCost(a().costUsd)} />
        <Show when={a().plan}>
          <div class="gp-stat">
            <dt>Plan (est.)</dt>
            <dd>
              <AgentPlanCell agent={a()} />
            </dd>
          </div>
        </Show>
        <Stat label="Turns" value={String(a().turns)} />
        <Stat label="Output" value={fmtTokens(a().usage.output)} />
        <Stat label="Cache read" value={fmtTokens(a().usage.cacheRead)} />
        <Stat label="Last active" value={fmtAgo(a().lastActivityAt, props.now)} />
      </dl>
      <Show when={parent()}>
        {(p) => (
          <p class="gp-line">
            Spawned by{' '}
            <button type="button" class="gp-link" onClick={() => props.onSelect(agentNodeId(p().id))}>
              {p().label}
            </button>
          </p>
        )}
      </Show>
      <Show when={children().length}>
        <h4>Subagents ({children().length})</h4>
        <ul class="gp-list">
          <For each={children()} keyed={(c) => c.id}>
            {(c) => (
              <li>
                <button type="button" class="gp-link" onClick={() => props.onSelect(agentNodeId(c.id))}>
                  {c.label}
                </button>
                <span class="gp-sub">{STATUS_LABEL[c.status]}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={compIds().length}>
        <h4>Components touched</h4>
        <ul class="gp-list">
          <For each={compIds()} keyed={([id]) => id}>
            {([id, n]) => (
              <li>
                <button type="button" class="gp-link mono" onClick={() => props.onSelect(componentNodeId(id))}>
                  {id}
                </button>
                <span class="gp-sub">{n}x</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <h4>Recent tool calls</h4>
      <ul class="gp-calls">
        <For each={recent()} keyed={(t) => t.id} fallback={<li class="gp-sub">None yet</li>}>
          {(t) => (
            <li data-hot={isRecent(t.at, props.now)}>
              <span class="mono">{t.summary}</span>
              <span class="gp-sub">{fmtAgo(t.at, props.now)}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}

function ComponentDetails(props: { comp: Component; snapshot: SwarmSnapshot; now: number; onSelect: (id: string) => void }) {
  const c = () => props.comp
  const children = () => props.snapshot.components.filter((x) => x.parentId === c().id)
  const touchers = () =>
    props.snapshot.agents
      .map((a) => ({ a, n: a.touched[c().id] ?? 0 }))
      .filter((x) => x.n > 0)
      .sort((x, y) => y.n - x.n)
  const lastTouch = () => {
    let at = 0
    for (const a of props.snapshot.agents) for (const t of a.toolCalls) if (t.componentId === c().id && t.at > at) at = t.at
    return at
  }
  return (
    <div class="gp-frag">
      <p class="gp-path mono">{c().id === '.' ? '(repo root)' : c().id + '/'}</p>
      <dl class="gp-stats">
        <Stat label="Files" value={String(c().fileCount)} />
        <Stat label="Subdirs" value={String(children().length)} />
        <Stat label="Agents" value={String(touchers().length)} />
        <Stat label="Tool calls" value={String(touchers().reduce((s, x) => s + x.n, 0))} />
        <Stat label="Last touched" value={lastTouch() ? fmtAgo(lastTouch(), props.now) : 'never'} />
      </dl>
      <Show when={c().parentId}>
        <p class="gp-line">
          Inside{' '}
          <button type="button" class="gp-link mono" onClick={() => props.onSelect(componentNodeId(c().parentId!))}>
            {c().parentId}
          </button>
        </p>
      </Show>
      <h4>Touched by</h4>
      <ul class="gp-list">
        <For each={touchers()} keyed={(x) => x.a.id} fallback={<li class="gp-sub">No agent has touched this</li>}>
          {(x) => (
            <li>
              <button type="button" class="gp-link" onClick={() => props.onSelect(agentNodeId(x.a.id))}>
                <Gem class="gp-gem" family={modelFamily(x.a.model)} />
                {x.a.label}
              </button>
              <span class="gp-sub">{x.n}x</span>
            </li>
          )}
        </For>
      </ul>
      <Show when={children().length}>
        <h4>Subdirectories</h4>
        <ul class="gp-list">
          <For each={children()} keyed={(k) => k.id}>
            {(k) => (
              <li>
                <button type="button" class="gp-link mono" onClick={() => props.onSelect(componentNodeId(k.id))}>
                  {k.label}
                </button>
                <span class="gp-sub">{k.fileCount} files</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

export default function Panel(props: PanelProps) {
  const agent = () =>
    props.selectedId.startsWith('a:') ? props.snapshot.agents.find((a) => agentNodeId(a.id) === props.selectedId) : undefined
  const comp = () =>
    props.selectedId.startsWith('c:') ? props.snapshot.components.find((c) => componentNodeId(c.id) === props.selectedId) : undefined
  return (
    <aside class="graph-panel" aria-label="Selection details">
      <header class="gp-head">
        <div class="gp-grip" aria-hidden="true" />
        <h3>{agent()?.label ?? comp()?.label ?? 'Not found'}</h3>
        <GemButton icon="close" class="gp-close" aria-label="Close details" onClick={props.onClose} />
      </header>
      <div class="gp-body">
        <Show when={agent()}>{(a) => <AgentDetails agent={a()} snapshot={props.snapshot} now={props.now} onSelect={props.onSelect} />}</Show>
        <Show when={comp()}>{(c) => <ComponentDetails comp={c()} snapshot={props.snapshot} now={props.now} onSelect={props.onSelect} />}</Show>
        <Show when={!agent() && !comp()}>
          <p class="gp-sub">This item is not in the current snapshot.</p>
        </Show>
      </div>
    </aside>
  )
}
