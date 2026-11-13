import { createSignal, onSettled } from 'solid-js'
import { isServer } from '@solidjs/web'
import type { SwarmSnapshot } from './types'

/**
 * Live swarm data: subscribes to /api/swarm/stream with auto-reconnect.
 * Safe to call during SSR (returns an empty, disconnected state there).
 */
export function useSwarm(): {
  snapshot: () => SwarmSnapshot | undefined
  connected: () => boolean
} {
  const [snapshot, setSnapshot] = createSignal<SwarmSnapshot | undefined>(undefined)
  const [connected, setConnected] = createSignal(false)

  if (!isServer) {
    onSettled(() => {
      let es: EventSource | undefined
      let retry: ReturnType<typeof setTimeout> | undefined
      let delay = 500
      let disposed = false

      const open = () => {
        if (disposed) return
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
          // EventSource retries on its own for transient errors; if it gave up, reopen.
          if (es && es.readyState === EventSource.CLOSED) {
            es.close()
            es = undefined
            retry = setTimeout(open, delay)
            delay = Math.min(delay * 2, 10_000)
          }
        }
      }
      open()

      return () => {
        disposed = true
        if (retry) clearTimeout(retry)
        es?.close()
      }
    })
  }

  return { snapshot, connected }
}
