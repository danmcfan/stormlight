import { For, Show, createSignal, onSettled } from 'solid-js'
import type { QueueJob, SwarmSnapshot } from '../../lib/types'
import { Gem } from '../frame/Gem'
import { formatDuration, shortModel } from '../fleet/format'
import { queueCounts } from './format'
import './queue.css'

function JobRow(props: { job: QueueJob; now: number }) {
  const j = () => props.job
  const since = () => (j().state === 'running' ? j().startedAt : j().queuedAt)
  return (
    <li class="queue-job" data-state={j().state}>
      <span class="queue-pos mono">
        <Show when={j().state === 'running'} fallback={`#${j().position}`}>
          <span class="st" data-status="running" aria-hidden="true">
            <Gem />
          </span>
        </Show>
      </span>
      <span class="queue-label">
        {j().label}
        <Show when={j().note}>
          <span class="queue-note"> · {j().note}</span>
        </Show>
      </span>
      <Show when={j().model}>
        <span class="queue-model mono">{shortModel(j().model!)}</span>
      </Show>
      <span class="queue-time">
        <Show when={since() !== undefined}>
          {j().state === 'running' ? 'running ' : 'waiting '}
          {formatDuration(Math.max(0, props.now - since()!))}
        </Show>
      </span>
    </li>
  )
}

export function QueuePanel(props: { snapshot: SwarmSnapshot }) {
  const [tick, setTick] = createSignal(0)
  onSettled(() => {
    setTick(Date.now())
    const t = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(t)
  })
  const now = () => tick() || props.snapshot.generatedAt
  const active = () => props.snapshot.queue?.jobs.filter((j) => j.state === 'queued' || j.state === 'running') ?? []

  return (
    <section class="queue-panel" aria-labelledby="queue-title">
      <header class="queue-head">
        <h2 class="ptitle" id="queue-title">Queue</h2>
        <Show when={props.snapshot.queue}>
          {(q) => (
            <span class="queue-summary">
              {queueCounts(q()).running} / {queueCounts(q()).max} running · {queueCounts(q()).queued} queued
            </span>
          )}
        </Show>
      </header>
      <Show when={active().length > 0} fallback={<p class="queue-empty">Queue empty</p>}>
        <ul class="queue-list">
          <For each={active()} keyed={(j) => j.jobId}>
            {(job) => <JobRow job={job()} now={now()} />}
          </For>
        </ul>
      </Show>
    </section>
  )
}
