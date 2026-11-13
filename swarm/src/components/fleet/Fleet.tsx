import { createMemo, createSignal, onSettled, Show } from 'solid-js'
import { useSwarm } from '../../lib/useSwarm'
import type { SwarmSnapshot } from '../../lib/types'
import { AgentDetail } from './AgentDetail'
import { AgentTable } from './AgentTable'
import { FilterBar, RoundSelector } from './Filters'
import { buildRows, type Filters, type SortKey } from './rows'
import { Totals } from './Totals'

export function Fleet() {
  const swarm = useSwarm()
  return (
    <main class="page">
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
    <div class="state" role="status">
      <span class="dot" data-status="running" aria-hidden="true" />
      <p>{props.connected ? 'Loading the first snapshot…' : 'Connecting to the swarm server…'}</p>
    </div>
  )
}

function Empty(props: { snapshot: SwarmSnapshot }) {
  return (
    <div class="state">
      <h1>No agent transcripts found</h1>
      <p>
        {props.snapshot.sessions.length === 0
          ? 'Start a Claude Code session in this repository and its agents will show up here live.'
          : 'Sessions were found but none has agent activity yet.'}
      </p>
    </div>
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
      <Totals snapshot={props.snapshot} />
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
      <AgentTable
        rows={rows()}
        now={now()}
        sort={sort()}
        desc={desc()}
        onSort={onSort}
        onOpen={setOpenId}
        selectedId={openId()}
      />
      <AgentDetail
        snapshot={props.snapshot}
        agentId={openId()}
        now={now()}
        onClose={() => setOpenId(null)}
      />
    </>
  )
}
