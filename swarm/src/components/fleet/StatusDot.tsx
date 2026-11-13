import type { AgentStatus } from '../../lib/types'

export function StatusDot(props: { status: AgentStatus }) {
  return (
    <span class="status">
      <span class="dot" data-status={props.status} aria-hidden="true" />
      <span class="status-text">{props.status}</span>
    </span>
  )
}
