import { createSignal } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import { Drawer, DrawerBackdrop, DrawerContent, DrawerTitle } from '@ui-sdk/solid/drawer'
import { useSwarm } from '../lib/useSwarm'
import { Gem, Socket } from './frame/Gem'
import { SphereFrame } from './frame/SphereFrame'
import { QueueBadge } from './queue/QueueBadge'
import './nav/nav.css'

type Swarm = ReturnType<typeof useSwarm>

function Brand() {
  return (
    <Link to="/" class="brand">
      <span class="mark" aria-hidden="true">
        <svg viewBox="0 0 48 48">
          <use href="#orb" />
        </svg>
      </span>
      <span class="brand-name">Swarm</span>
    </Link>
  )
}

function Live(props: { swarm: Swarm }) {
  return (
    <div class="live" data-connected={props.swarm.connected() ? '' : undefined} role="status">
      <span class="st" data-status={props.swarm.connected() ? 'running' : 'idle'} aria-hidden="true">
        <Gem kind={props.swarm.connected() ? 'live' : 'dead'} />
      </span>
      <span class="live-text">{props.swarm.connected() ? 'Live' : 'Offline'}</span>
    </div>
  )
}

/** Brand, sections, connection and queue: the sidebar on wide screens and the drawer on a phone. */
function NavContent(props: { swarm: Swarm; onNavigate?: () => void }) {
  const go = () => props.onNavigate?.()
  return (
    <div class="nav-content">
      <Brand />
      <nav class="side-links" aria-label="Main">
        <Link to="/" class="gem-btn nav" activeOptions={{ exact: true }} onClick={go}>
          <Socket />
          Fleet
        </Link>
        <Link to="/graph" class="gem-btn nav" onClick={go}>
          <Socket />
          Graph
        </Link>
        <Link to="/lead" class="gem-btn nav" onClick={go}>
          <Socket />
          Lead
        </Link>
        <a
          href="#rescue"
          class="gem-btn nav"
          onClick={(e) => {
            e.preventDefault()
            window.location.href = `${location.protocol}//${location.hostname}:5180/`
          }}
        >
          <Socket />
          Rescue
        </a>
      </nav>
      <div class="side-status">
        <Live swarm={props.swarm} />
        <QueueBadge snapshot={props.swarm.snapshot()} />
      </div>
    </div>
  )
}

/**
 * App navigation. At 64rem and up a fixed left sidebar; below that a slim top
 * bar (clear of the notch and status bar) whose menu button opens the same
 * content in a drawer from the left.
 */
export default function Header() {
  const swarm = useSwarm()
  const [open, setOpen] = createSignal(false)
  return (
    <>
      <aside class="side-nav" aria-label="Sidebar">
        <SphereFrame class="side-frame" glow={swarm.connected() ? 1 : 0.35} live={swarm.connected()}>
          <NavContent swarm={swarm} />
        </SphereFrame>
      </aside>

      <header class="topbar">
        <button type="button" class="menu-btn" aria-label="Open menu" aria-expanded={open() ? 'true' : 'false'} onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <Brand />
        <Live swarm={swarm} />
      </header>

      <Drawer side="left" open={open()} onOpenChange={setOpen}>
        <DrawerBackdrop />
        <DrawerContent class="nav-drawer" initialFocus="content">
          <DrawerTitle class="sr-only">Menu</DrawerTitle>
          <NavContent swarm={swarm} onNavigate={() => setOpen(false)} />
        </DrawerContent>
      </Drawer>
    </>
  )
}
