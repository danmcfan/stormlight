import { For, Show } from 'solid-js'
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@ui-sdk/solid/drawer'
import {
  Timeline,
  TimelineConnector,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from '@ui-sdk/solid/timeline'
import type { Agent, SwarmSnapshot } from '../../lib/types'
import {
  cacheWrite,
  formatClock,
  formatCost,
  formatDuration,
  formatRelative,
  formatTokens,
  shortModel,
  totalTokens,
} from './format'
import { splitCost } from './pricing'
import { agentDuration } from './rows'
import { StatusDot } from './StatusDot'

export function AgentDetail(props: {
  snapshot: SwarmSnapshot
  agentId: string | null
  now: number
  onClose: () => void
}) {
  const agent = () => props.snapshot.agents.find((a) => a.id === props.agentId)
  return (
    <Drawer
      side="right"
      open={props.agentId !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DrawerBackdrop />
      <DrawerContent class="detail" initialFocus="content">
        <Show when={agent()} fallback={<DrawerTitle>Agent not found</DrawerTitle>}>
          {(a) => <Body agent={a()} snapshot={props.snapshot} now={props.now} />}
        </Show>
      </DrawerContent>
    </Drawer>
  )
}

function Body(props: { agent: Agent; snapshot: SwarmSnapshot; now: number }) {
  const a = () => props.agent
  const round = () => props.snapshot.rounds.find((r) => r.id === a().roundId)
  const split = () => splitCost(a().model, a().usage, a().costUsd)
  const usageRows = () => [
    { label: 'Input', tokens: a().usage.input, cost: split().input },
    { label: 'Output', tokens: a().usage.output, cost: split().output },
    { label: 'Cache write', tokens: cacheWrite(a().usage), cost: split().cacheWrite },
    { label: 'Cache read', tokens: a().usage.cacheRead, cost: split().cacheRead },
  ]
  const touched = () => {
    const labels = new Map(props.snapshot.components.map((c) => [c.id, c.id]))
    return Object.entries(a().touched)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 8)
      .map(([id, n]) => ({ id, label: labels.get(id) ?? id, n }))
  }
  const maxTouched = () => touched()[0]?.n ?? 1
  const calls = () => [...a().toolCalls].reverse()

  return (
    <>
      <div class="detail-head">
        <DrawerTitle>{a().label}</DrawerTitle>
        <DrawerClose>Close</DrawerClose>
      </div>
      <DrawerDescription>
        {a().kind === 'main' ? 'Main agent' : `Subagent${round() ? `, round ${round()!.index}` : ''}`} ·{' '}
        <span class="mono">{shortModel(a().model)}</span>
      </DrawerDescription>

      <div class="detail-body">
        <div class="detail-status">
          <StatusDot status={a().status} />
          <span>
            started {formatRelative(a().startedAt, props.now)} · ran {formatDuration(agentDuration(a(), props.now))} ·{' '}
            {a().turns} turns
          </span>
        </div>

        <Show when={a().description}>
          <section>
            <h3>Task</h3>
            <p class="desc">{a().description}</p>
          </section>
        </Show>

        <Show when={a().currentActivity}>
          <section>
            <h3>Now</h3>
            <p class="mono">{a().currentActivity}</p>
          </section>
        </Show>

        <section>
          <h3>Usage (est.)</h3>
          <table class="mini usage">
            <thead>
              <tr>
                <th scope="col">Class</th>
                <th scope="col" class="num">Tokens</th>
                <th scope="col" class="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              <For each={usageRows()} keyed={(r) => r.label}>
                {(r) => (
                  <tr>
                    <th scope="row">{r().label}</th>
                    <td class="num">{formatTokens(r().tokens)}</td>
                    <td class="num">{formatCost(r().cost)}</td>
                  </tr>
                )}
              </For>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td class="num">{formatTokens(totalTokens(a().usage))}</td>
                <td class="num">{formatCost(a().costUsd)}</td>
              </tr>
            </tfoot>
          </table>
          <p class="note">Cost per class is the total split by list-price weight. {props.snapshot.pricingNote}</p>
        </section>

        <section>
          <h3>Components touched</h3>
          <Show when={touched().length > 0} fallback={<p class="note">None yet.</p>}>
            <ul class="touched">
              <For each={touched()} keyed={(t) => t.id}>
                {(t) => (
                  <li style={{ '--pct': `${(t().n / maxTouched()) * 100}%` }}>
                    <span class="mono touched-name">{t().label}</span>
                    <span class="touched-bar" aria-hidden="true" />
                    <span class="num">{t().n}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <section>
          <h3>
            Tool calls <span class="note">newest first · last {a().toolCalls.length}</span>
          </h3>
          <Show when={calls().length > 0} fallback={<p class="note">No tool calls yet.</p>}>
            <Timeline aria-label="Tool calls" class="calls">
              <For each={calls()} keyed={(c) => c.id}>
                {(c) => (
                  <TimelineItem>
                    <TimelineMarker />
                    <TimelineConnector />
                    <TimelineTitle>{c().name}</TimelineTitle>
                    <TimelineTime datetime={new Date(c().at).toISOString()}>{formatClock(c().at)}</TimelineTime>
                    <TimelineDescription>{c().summary}</TimelineDescription>
                  </TimelineItem>
                )}
              </For>
            </Timeline>
          </Show>
        </section>
      </div>
    </>
  )
}
