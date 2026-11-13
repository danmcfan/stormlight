import { For, Show } from 'solid-js'
import { formatCost, formatDuration, formatRelative, formatTokens, shortModel } from './format'
import { agentDuration, type Row, type SortKey } from './rows'
import { StatusDot } from './StatusDot'
import { AgentPlanCell } from '../plan/AgentPlanCell'
import { Icon } from '../frame/Gem'
import { modelFamily } from '../graph/model'

interface Col {
  key: SortKey | null
  label: string
  num?: boolean
  hideSm?: boolean
  hideMd?: boolean
}

const COLS: Col[] = [
  { key: 'status', label: 'Status' },
  { key: 'label', label: 'Agent' },
  { key: 'kind', label: 'Kind', hideSm: true, hideMd: true },
  { key: 'model', label: 'Model', hideSm: true },
  { key: 'round', label: 'Round', num: true },
  { key: 'started', label: 'Started', hideSm: true, hideMd: true },
  { key: 'duration', label: 'Time', num: true },
  { key: 'turns', label: 'Turns', num: true, hideSm: true },
  { key: 'input', label: 'In', num: true, hideSm: true, hideMd: true },
  { key: 'output', label: 'Out', num: true },
  { key: 'cacheRead', label: 'Cache read', num: true, hideSm: true },
  { key: 'cost', label: 'Est. cost', num: true },
  { key: null, label: 'Plan 5h / 7d', hideSm: true },
  { key: null, label: 'Activity' },
]

/** Sort keys offered on the phone card list's sort strip, shortest-label first. */
const CARD_SORTS: { key: SortKey; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'duration', label: 'Time' },
  { key: 'cost', label: 'Cost' },
  { key: 'output', label: 'Out' },
  { key: 'turns', label: 'Turns' },
  { key: 'label', label: 'Agent' },
  { key: 'round', label: 'Round' },
]

export function AgentTable(props: {
  rows: Row[]
  now: number
  sort: SortKey
  desc: boolean
  onSort: (key: SortKey) => void
  onOpen: (id: string) => void
  selectedId: string | null
}) {
  const ariaSort = (c: Col) =>
    c.key && props.sort === c.key ? (props.desc ? 'descending' : 'ascending') : c.key ? 'none' : undefined

  return (
    <>
      <AgentCards
        rows={props.rows}
        now={props.now}
        sort={props.sort}
        desc={props.desc}
        onSort={props.onSort}
        onOpen={props.onOpen}
        selectedId={props.selectedId}
      />
      <div class="table-wrap" tabindex="0" role="region" aria-label="Agents table">
      <table class="agents">
        <thead>
          <tr>
            <For each={COLS}>
              {(c) => (
                <th
                  scope="col"
                  class={`${c.num ? 'num' : ''} ${c.hideSm ? 'hide-sm' : ''} ${c.hideMd ? 'hide-md' : ''}`}
                  aria-sort={ariaSort(c)}
                >
                  <Show when={c.key} fallback={c.label}>
                    <button type="button" class="sort" onClick={() => props.onSort(c.key!)}>
                      {c.label}
                      <span class="sort-mark" aria-hidden="true">
                        {props.sort === c.key ? (props.desc ? '▼' : '▲') : ''}
                      </span>
                    </button>
                  </Show>
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For
            each={props.rows}
            keyed={(r) => r.agent.id}
            fallback={
              <tr>
                <td colspan={COLS.length} class="empty-row">
                  No agents match these filters.
                </td>
              </tr>
            }
          >
            {(row) => {
              const a = () => row().agent
              return (
                <tr
                  class="agent-row"
                  data-selected={props.selectedId === a().id ? '' : undefined}
                  data-kind={a().kind}
                  onClick={() => props.onOpen(a().id)}
                >
                  <td>
                    <StatusDot status={a().status} />
                  </td>
                  <td class="cell-label" style={{ '--depth': row().depth }}>
                    <button
                      type="button"
                      class="row-open"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onOpen(a().id)
                      }}
                    >
                      {a().label}
                    </button>
                  </td>
                  <td class="hide-sm hide-md">{a().kind}</td>
                  <td class="hide-sm">
                    <span class="model">
                      <Icon name={modelFamily(a().model)} />
                      {shortModel(a().model)}
                    </span>
                  </td>
                  <td class="num">{row().round ?? '–'}</td>
                  <td class="hide-sm hide-md">{formatRelative(a().startedAt, props.now)}</td>
                  <td class="num">{formatDuration(agentDuration(a(), props.now))}</td>
                  <td class="num hide-sm">{a().turns}</td>
                  <td class="num hide-sm hide-md">{formatTokens(a().usage.input)}</td>
                  <td class="num">{formatTokens(a().usage.output)}</td>
                  <td class="num hide-sm">{formatTokens(a().usage.cacheRead)}</td>
                  <td class="num cost">{formatCost(a().costUsd)}</td>
                  <td class="hide-sm">
                    <AgentPlanCell agent={a()} />
                  </td>
                  <td class="cell-activity" title={a().currentActivity}>
                    {a().currentActivity ?? ''}
                  </td>
                </tr>
              )
            }}
          </For>
        </tbody>
      </table>
      </div>
    </>
  )
}

/** The phone card list: one agent per card, with a sort strip in place of column headers. */
function AgentCards(props: {
  rows: Row[]
  now: number
  sort: SortKey
  desc: boolean
  onSort: (key: SortKey) => void
  onOpen: (id: string) => void
  selectedId: string | null
}) {
  return (
    <div class="agent-cards-wrap">
      <div class="sort-strip" role="group" aria-label="Sort agents">
        <For each={CARD_SORTS}>
          {(s) => (
            <button
              type="button"
              class="sort-chip"
              aria-pressed={props.sort === s.key}
              onClick={() => props.onSort(s.key)}
            >
              {s.label}
              <span class="sort-mark" aria-hidden="true">
                {props.sort === s.key ? (props.desc ? '▼' : '▲') : ''}
              </span>
            </button>
          )}
        </For>
      </div>
      <ul class="agent-cards" aria-label="Agents">
        <For
          each={props.rows}
          keyed={(r) => r.agent.id}
          fallback={<li class="agent-cards-empty">No agents match these filters.</li>}
        >
          {(row) => {
            const a = () => row().agent
            return (
              <li>
                <div
                  class="agent-card"
                  data-selected={props.selectedId === a().id ? '' : undefined}
                  data-kind={a().kind}
                  role="button"
                  tabindex="0"
                  aria-pressed={props.selectedId === a().id}
                  onClick={() => props.onOpen(a().id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      props.onOpen(a().id)
                    }
                  }}
                >
                  <div class="ac-head">
                    <StatusDot status={a().status} />
                    <span class="ac-label">{a().label}</span>
                  </div>
                  <Show when={a().currentActivity}>
                    <p class="ac-activity mono">{a().currentActivity}</p>
                  </Show>
                  <dl class="ac-stats">
                    <div class="ac-stat">
                      <dt>Model</dt>
                      <dd class="mono">
                        <Icon name={modelFamily(a().model)} />
                        {shortModel(a().model)}
                      </dd>
                    </div>
                    <div class="ac-stat">
                      <dt>Time</dt>
                      <dd>{formatDuration(agentDuration(a(), props.now))}</dd>
                    </div>
                    <div class="ac-stat">
                      <dt>Out</dt>
                      <dd>{formatTokens(a().usage.output)}</dd>
                    </div>
                    <div class="ac-stat">
                      <dt>Est. cost</dt>
                      <dd class="cost">{formatCost(a().costUsd)}</dd>
                    </div>
                  </dl>
                </div>
              </li>
            )
          }}
        </For>
      </ul>
    </div>
  )
}
