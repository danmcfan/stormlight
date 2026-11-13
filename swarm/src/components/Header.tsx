import { Link } from '@tanstack/solid-router'
import { useSwarm } from '../lib/useSwarm'
import { QueueBadge } from './queue/QueueBadge'

export default function Header() {
  const swarm = useSwarm()
  return (
    <header class="site-header">
      <nav class="site-nav" aria-label="Main">
        <Link to="/" class="brand">
          <span class="brand-mark" aria-hidden="true" />
          Swarm
        </Link>
        <div class="nav-links">
          <Link to="/" class="nav-link" activeOptions={{ exact: true }} activeProps={{ class: 'nav-link is-active' }}>
            Fleet
          </Link>
          <Link to="/graph" class="nav-link" activeProps={{ class: 'nav-link is-active' }}>
            Graph
          </Link>
        </div>
        <QueueBadge snapshot={swarm.snapshot()} />
        <div class="live" data-connected={swarm.connected() ? '' : undefined} role="status">
          <span class="dot" data-status={swarm.connected() ? 'running' : 'error'} aria-hidden="true" />
          {swarm.connected() ? 'Live' : 'Disconnected'}
        </div>
      </nav>
    </header>
  )
}
