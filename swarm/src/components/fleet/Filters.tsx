import { For } from 'solid-js'
import { Input, InputClear, InputGroup } from '@ui-sdk/solid/input'
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from '@ui-sdk/solid/segmented-control'
import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@ui-sdk/solid/select'
import type { SwarmSnapshot } from '../../lib/types'
import { formatCost, formatDuration, shortModel } from './format'
import { agentDuration, type Filters } from './rows'

export interface RoundSummary {
  index: number
  agents: number
  costUsd: number
  durationMs: number
}

export function summarizeRounds(snapshot: SwarmSnapshot, now: number): RoundSummary[] {
  const byIndex = new Map<number, { agents: number; costUsd: number; start: number; end: number }>()
  for (const r of snapshot.rounds) {
    const cur = byIndex.get(r.index) ?? { agents: 0, costUsd: 0, start: Infinity, end: 0 }
    cur.agents += r.agentIds.length
    cur.costUsd += r.costUsd
    cur.start = Math.min(cur.start, r.startedAt)
    cur.end = Math.max(cur.end, r.endedAt ?? now)
    byIndex.set(r.index, cur)
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, v]) => ({ index, agents: v.agents, costUsd: v.costUsd, durationMs: v.end - v.start }))
}

const STATUSES = ['running', 'idle', 'done', 'error'] as const

export function RoundSelector(props: {
  snapshot: SwarmSnapshot
  now: number
  value: string
  onChange: (v: string) => void
}) {
  const rounds = () => summarizeRounds(props.snapshot, props.now)
  const totalAgents = () => props.snapshot.agents.length
  const totalCost = () => props.snapshot.totals.costUsd
  const span = () =>
    props.snapshot.agents.reduce((acc, a) => Math.max(acc, agentDuration(a, props.now)), 0)

  return (
    <div class="rounds">
      <SegmentedControl
        aria-label="Round"
        value={props.value}
        onValueChange={(v) => v && props.onChange(v)}
      >
        <SegmentedControlIndicator />
        <SegmentedControlItem value="all">
          <span class="round-name">All</span>
          <span class="round-stats">
            {totalAgents()} agents · {formatCost(totalCost())} · {formatDuration(span())}
          </span>
        </SegmentedControlItem>
        <For each={rounds()} keyed={(r) => r.index}>
          {(r) => (
            <SegmentedControlItem value={String(r().index)}>
              <span class="round-name">Round {r().index}</span>
              <span class="round-stats">
                {r().agents} agents · {formatCost(r().costUsd)} · {formatDuration(r().durationMs)}
              </span>
            </SegmentedControlItem>
          )}
        </For>
      </SegmentedControl>
    </div>
  )
}

export function FilterBar(props: {
  snapshot: SwarmSnapshot
  filters: Filters
  onChange: (patch: Partial<Filters>) => void
}) {
  const models = () => [...new Set(props.snapshot.agents.map((a) => a.model))].sort()
  return (
    <div class="filterbar">
      <InputGroup class="search">
        <Input
          type="search"
          aria-label="Search agents"
          placeholder="Search label, task, model, activity"
          value={props.filters.query}
          onValueChange={(v) => props.onChange({ query: v })}
        />
        <InputClear aria-label="Clear search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </InputClear>
      </InputGroup>
      <Select
        value={props.filters.status}
        onValueChange={(v) => props.onChange({ status: (v ?? 'all') as Filters['status'] })}
      >
        <SelectLabel class="sr-only">Status</SelectLabel>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <For each={STATUSES}>{(s) => <SelectItem value={s}>{s}</SelectItem>}</For>
        </SelectContent>
      </Select>
      <Select value={props.filters.model} onValueChange={(v) => props.onChange({ model: v ?? 'all' })}>
        <SelectLabel class="sr-only">Model</SelectLabel>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All models</SelectItem>
          <For each={models()}>{(m) => <SelectItem value={m}>{shortModel(m)}</SelectItem>}</For>
        </SelectContent>
      </Select>
    </div>
  )
}
