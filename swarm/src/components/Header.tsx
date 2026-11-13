import { Link } from '@tanstack/solid-router'
import { useSwarm } from '../lib/useSwarm'
import { Gem, Socket } from './frame/Gem'
import { SphereFrame } from './frame/SphereFrame'
import { QueueBadge } from './queue/QueueBadge'

export default function Header() {
  const swarm = useSwarm()
  return (
    <header class="site-header">
      <div class="shell">
        <SphereFrame class="bar" glow={swarm.connected() ? 1 : 0.35} live={swarm.connected()}>
          <Link to="/" class="brand">
            <span class="mark" aria-hidden="true">
              <svg viewBox="0 0 48 48">
                <use href="#orb" />
              </svg>
            </span>
            <span class="brand-name">Swarm</span>
          </Link>
          <nav class="nav-links" aria-label="Main">
            <Link to="/" class="gem-btn nav" activeOptions={{ exact: true }}>
              <Socket />
              Fleet
            </Link>
            <Link to="/graph" class="gem-btn nav">
              <Socket />
              Graph
            </Link>
          </nav>
          <div class="bar-end">
            <QueueBadge snapshot={swarm.snapshot()} />
            <div class="live" data-connected={swarm.connected() ? '' : undefined} role="status">
              <span class="st" data-status={swarm.connected() ? 'running' : 'idle'} aria-hidden="true">
                <Gem kind={swarm.connected() ? 'live' : 'dead'} />
              </span>
              {swarm.connected() ? 'Live' : 'Disconnected'}
            </div>
          </div>
        </SphereFrame>
      </div>
    </header>
  )
}
