import { For, Show } from 'solid-js'
import { formatCost, formatDuration, formatRelative, formatTokens, shortModel } from './format'
import { agentDuration, type Row, type SortKey } from './rows'
import { StatusDot } from './StatusDot'
import { AgentPlanCell } from '../plan/AgentPlanCell'

interface Col {
  key: SortKey | null
  label: string
  num?: boolean
  hideSm?: boolean
}

const COLS: Col[] = [
  { key: 'status', label: 'Status' },
  { key: 'label', label: 'Agent' },
  { key: 'kind', label: 'Kind', hideSm: true },
  { key: 'model', label: 'Model', hideSm: true },
  { key: 'round', label: 'Round', num: true },
  { key: 'started', label: 'Started', hideSm: true },
  { key: 'duration', label: 'Time', num: true },
  { key: 'turns', label: 'Turns', num: true },
  { key: 'input', label: 'In', num: true, hideSm: true },
  { key: 'output', label: 'Out', num: true },
  { key: 'cacheRead', label: 'Cache read', num: true, hideSm: true },
  { key: 'cost', label: 'Est. cost', num: true },
  { key: null, label: 'Plan 5h / 7d', hideSm: true },
  { key: null, label: 'Activity' },
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
    <div class="table-wrap" tabindex="0" role="region" aria-label="Agents table">
      <table class="agents">
        <thead>
          <tr>
            <For each={COLS}>
              {(c) => (
                <th
                  scope="col"
                  class={`${c.num ? 'num' : ''} ${c.hideSm ? 'hide-sm' : ''}`}
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
                  <td class="hide-sm">{a().kind}</td>
                  <td class="hide-sm mono">{shortModel(a().model)}</td>
                  <td class="num">{row().round ?? '–'}</td>
                  <td class="hide-sm">{formatRelative(a().startedAt, props.now)}</td>
                  <td class="num">{formatDuration(agentDuration(a(), props.now))}</td>
                  <td class="num">{a().turns}</td>
                  <td class="num hide-sm">{formatTokens(a().usage.input)}</td>
                  <td class="num">{formatTokens(a().usage.output)}</td>
                  <td class="num hide-sm">{formatTokens(a().usage.cacheRead)}</td>
                  <td class="num">{formatCost(a().costUsd)}</td>
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
  )
}
