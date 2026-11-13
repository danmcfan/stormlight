// Polls `/api/lead` and exposes the lead's state plus the actions a chat UI
// needs (send, stop, reset, model). Shared by the compact sidebar panel and
// the full-screen chat so both stay in sync with one source of truth.
//
// All fetching lives behind `LeadTransport` below: a future session swapping
// the poll for a WebSocket only needs to replace `restTransport`, not touch
// any component.
import { createSignal, onSettled } from 'solid-js'
import { isServer } from '@solidjs/web'
import type { LeadState } from '../../server/lead'

const POLL_MS = 2000

interface LeadTransport {
  fetchState(): Promise<LeadState>
  postAction(body: object): Promise<LeadState>
}

async function parseResponse(res: Response): Promise<LeadState> {
  const j = await res.json()
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
  return j
}

const restTransport: LeadTransport = {
  fetchState: () => fetch('/api/lead', { cache: 'no-store' }).then(parseResponse),
  postAction: (body) =>
    fetch('/api/lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(parseResponse),
}

/** Cheap structural equality for the small, plain-JSON `LeadState`: good enough
 * to skip a no-op poll's `setState` so nothing downstream re-renders. */
function sameState(a: LeadState | undefined, b: LeadState): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b)
}

/** Lead state, polled, plus the actions. `onChange` fires when a run starts, ends, or the queue changes. */
export function useLead(onChange?: () => void, transport: LeadTransport = restTransport) {
  const [state, setState] = createSignal<LeadState | undefined>(undefined)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  let sig = ''

  const apply = (s: LeadState) => {
    if (!sameState(state(), s)) setState(s)
    const next = `${s.history.length}|${s.running?.startedAt ?? ''}|${s.waiting.length}|${s.history[0]?.endedAt ?? ''}`
    if (next !== sig) {
      sig = next
      onChange?.()
    }
  }

  onSettled(() => {
    if (isServer) return
    let alive = true
    const load = async () => {
      try {
        const s = await transport.fetchState()
        if (alive) apply(s)
      } catch {
        /* offline; the nav shows Offline */
      }
    }
    load()
    const poll = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(poll)
    }
  })

  const act = async (body: object) => {
    setBusy(true)
    setError('')
    try {
      apply(await transport.postAction(body))
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return { state, busy, error, act }
}

export type Lead = ReturnType<typeof useLead>
