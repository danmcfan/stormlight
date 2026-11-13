import { Show } from 'solid-js'
import type { SwarmSnapshot } from '../../lib/types'
import { queueCounts } from './format'
import './queue.css'

export function QueueBadge(props: { snapshot: SwarmSnapshot | undefined }) {
  return (
    <Show when={props.snapshot?.queue}>
      {(q) => {
        const c = () => queueCounts(q())
        return (
          <span class="queue-badge" data-full={c().running >= c().max ? '' : undefined} title="Running agents / limit · queued">
            {c().running} / {c().max} running
            <Show when={c().queued > 0}> · {c().queued} queued</Show>
          </span>
        )
      }}
    </Show>
  )
}
