import { createSignal, onSettled } from 'solid-js'
import { isServer } from '@solidjs/web'
import type { SwarmSnapshot } from './types'

// One EventSource for the whole page, shared by every useSwarm() caller.
// Browsers allow ~6 connections per host over HTTP/1.1; one stream per
// component used them all up and left later panels stuck on "Connecting".
const [snapshot, setSnapshot] = createSignal<SwarmSnapshot | undefined>(undefined)
const [connected, setConnected] = createSignal(false)
let users = 0
let es: EventSource | undefined
let retry: ReturnType<typeof setTimeout> | undefined
let delay = 500

function open() {
  if (users === 0 || es) return
  es = new EventSource('/api/swarm/stream')
  es.onopen = () => {
    delay = 500
    setConnected(true)
  }
  es.addEventListener('snapshot', (ev) => {
    try {
      setSnapshot(JSON.parse((ev as MessageEvent).data) as SwarmSnapshot)
      setConnected(true)
      delay = 500
    } catch {
      /* ignore a malformed event */
    }
  })
  es.onerror = () => {
    setConnected(false)
    // EventSource retries transient errors itself; reopen only if it gave up.
    if (es && es.readyState === EventSource.CLOSED) {
      es.close()
      es = undefined
      retry = setTimeout(open, delay)
      delay = Math.min(delay * 2, 10_000)
    }
  }
}

function close() {
  if (retry) clearTimeout(retry)
  retry = undefined
  es?.close()
  es = undefined
}

/**
 * Live swarm data from /api/swarm/stream, shared across the page.
 * Safe during SSR (empty and disconnected there).
 */
export function useSwarm(): {
  snapshot: () => SwarmSnapshot | undefined
  connected: () => boolean
} {
  // Registered unconditionally: onSettled creates an owner, and owners take hydration
  // ids, so server and client must both create it. The callback never runs on the server.
  onSettled(() => {
    if (isServer) return
    users++
    open()
    return () => {
      users--
      if (users === 0) close()
    }
  })
  return { snapshot, connected }
}
