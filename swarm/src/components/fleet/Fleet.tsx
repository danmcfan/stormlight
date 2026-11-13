import { createMemo, createSignal, onSettled, Show } from 'solid-js'
import { useSwarm } from '../../lib/useSwarm'
import type { SwarmSnapshot } from '../../lib/types'
import { Gem } from '../frame/Gem'
import { AgentDetail } from './AgentDetail'
import { AgentTable } from './AgentTable'
import { FilterBar, RoundSelector } from './Filters'
import { buildRows, type Filters, type SortKey } from './rows'
import { Totals } from './Totals'
import { PlanUsageSummary } from '../plan/PlanUsageSummary'
import { QueuePanel } from '../queue/QueuePanel'
import { SphereFrame } from '../frame/SphereFrame'
export function Fleet() {
  const swarm = useSwarm()
  return (
    <main class="page shell">
      <Show when={swarm.snapshot()} fallback={<Loading connected={swarm.connected()} />}>
        {(snap) => (
          <Show when={snap().agents.length > 0} fallback={<Empty snapshot={snap()} />}>
            <FleetBody snapshot={snap()} />
          </Show>
        )}
      </Show>
    </main>
  )
}

function Loading(props: { connected: boolean }) {
  return (
    <SphereFrame joined glow={0.6} live>
      <div class="state" role="status">
        <span class="st" data-status="running" aria-hidden="true">
          <Gem />
        </span>
        <p>{props.connected ? 'Loading the first snapshot…' : 'Connecting to the swarm server…'}</p>
      </div>
    </SphereFrame>
  )
}

function Empty(props: { snapshot: SwarmSnapshot }) {
  return (
    <SphereFrame joined glow={0.4}>
      <div class="state">
        <h1>No agent transcripts found</h1>
        <p>
          {props.snapshot.sessions.length === 0
            ? 'Start a Claude Code session in this repository and its agents will show up here live.'
            : 'Sessions were found but none has agent activity yet.'}
        </p>
      </div>
    </SphereFrame>
  )
}

function FleetBody(props: { snapshot: SwarmSnapshot }) {
  const [tick, setTick] = createSignal(0)
  onSettled(() => {
    setTick(Date.now())
    const t = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(t)
  })
  const now = () => tick() || props.snapshot.generatedAt

  const [filters, setFilters] = createSignal<Filters>({ round: 'all', status: 'all', model: 'all', query: '' })
  const [sort, setSort] = createSignal<SortKey>('tree')
  const [desc, setDesc] = createSignal(false)
  const [openId, setOpenId] = createSignal<string | null>(null)

  const running = () => props.snapshot.agents.filter((a) => a.status === 'running').length
  const hasQueue = () => (props.snapshot.queue?.jobs ?? []).some((j) => j.state === 'queued' || j.state === 'running')
  const glow = () => (running() > 0 ? 1 : 0.35)

  const rows = createMemo(() => buildRows(props.snapshot, filters(), sort(), desc(), now()))
  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }))

  const onSort = (key: SortKey) => {
    const first = key !== 'label' && key !== 'kind' && key !== 'model'
    if (sort() !== key) {
      setSort(key)
      setDesc(first)
    } else if (desc() === first) setDesc(!first)
    else {
      setSort('tree')
      setDesc(false)
    }
  }

  return (
    <>
      <Show when={props.snapshot.plan || hasQueue()}>
        <SphereFrame glow={glow()} live={running() > 0}>
          <div class="ops">
            <Show when={props.snapshot.plan}>
              <PlanUsageSummary snapshot={props.snapshot} />
            </Show>
            <Show when={hasQueue()}>
              <QueuePanel snapshot={props.snapshot} />
            </Show>
          </div>
        </SphereFrame>
      </Show>
      <SphereFrame glow={glow()} live={running() > 0} aria-label="Totals">
        <Totals snapshot={props.snapshot} />
      </SphereFrame>
      <SphereFrame glow={glow()} live={running() > 0}>
        <section aria-labelledby="fleet-title">
          <h2 class="ptitle" id="fleet-title">Fleet</h2>
          <div class="fleet-tools">
            <RoundSelector
              snapshot={props.snapshot}
              now={now()}
              value={filters().round}
              onChange={(round) => patch({ round })}
            />
            <FilterBar snapshot={props.snapshot} filters={filters()} onChange={patch} />
            <p class="count" aria-live="polite">
              {rows().length} of {props.snapshot.agents.length} agents
              <Show when={sort() !== 'tree'}>
                {' '}· sorted flat · click the column a third time to group again
              </Show>
            </p>
          </div>
          <AgentTable
            rows={rows()}
            now={now()}
            sort={sort()}
            desc={desc()}
            onSort={onSort}
            onOpen={setOpenId}
            selectedId={openId()}
          />
        </section>
      </SphereFrame>
      <AgentDetail
        snapshot={props.snapshot}
        agentId={openId()}
        now={now()}
        onClose={() => setOpenId(null)}
      />
    </>
  )
}
