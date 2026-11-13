import type { AgentStatus } from '../../lib/types'
import { Gem } from '../frame/Gem'

/** Status as a gem (running pulses, idle dims, done sits in a closed setting) plus its text label. */
export function StatusDot(props: { status: AgentStatus }) {
  return (
    <span class="status">
      <span class="st" data-status={props.status} aria-hidden="true">
        <Gem kind={props.status === 'done' ? 'set' : props.status === 'error' ? 'dead' : 'live'} />
      </span>
      <span class="status-text">{props.status}</span>
    </span>
  )
}
