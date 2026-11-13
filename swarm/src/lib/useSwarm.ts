import { createSignal, onSettled } from 'solid-js'
import { isServer } from '@solidjs/web'
import type { SwarmSnapshot } from './types'
import { subscribeLive } from './live'

/**
 * Live swarm data: subscribes to the shared live channel (`src/lib/live.ts`,
 * a WebSocket at /api/live with an SSE/poll fallback). Safe to call during
 * SSR (returns an empty, disconnected state there).
 */
export function useSwarm(): {
  snapshot: () => SwarmSnapshot | undefined
  connected: () => boolean
} {
  const [snapshot, setSnapshot] = createSignal<SwarmSnapshot | undefined>(undefined)
  const [connected, setConnected] = createSignal(false)

  // Registered unconditionally: onSettled creates an owner, and owners take hydration
  // ids, so server and client must both create it. The callback never runs on the server.
  {
    onSettled(() => {
      if (isServer) return
      return subscribeLive({
        onSnapshot: setSnapshot,
        onStatus: setConnected,
      })
    })
  }

  return { snapshot, connected }
}
