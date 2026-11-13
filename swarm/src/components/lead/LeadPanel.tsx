import { For, Show, createSignal, onSettled } from 'solid-js'
import { isServer } from '@solidjs/web'
import type { LeadState } from '../../server/lead'
import { Gem } from '../frame/Gem'
import { GemButton } from '../ui/GemButton'
import { formatDuration } from '../fleet/format'
import './lead.css'

const POLL_MS = 2000

async function post(body: object): Promise<LeadState> {
  const res = await fetch('/api/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await res.json()
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
  return j
}

/** Prompt box for the lead agent, which delegates to Sonnet subagents. */
export function LeadPanel() {
  const [state, setState] = createSignal<LeadState | undefined>(undefined)
  const [text, setText] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [now, setNow] = createSignal(0)

  onSettled(() => {
    if (isServer) return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch('/api/lead', { cache: 'no-store' })
        if (alive && res.ok) setState(await res.json())
      } catch {
        /* offline; the header shows Disconnected */
      }
    }
    load()
    const poll = setInterval(load, POLL_MS)
    setNow(Date.now())
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive = false
      clearInterval(poll)
      clearInterval(clock)
    }
  })

  const act = async (body: object) => {
    setBusy(true)
    setError('')
    try {
      setState(await post(body))
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    const p = text().trim()
    if (!p || busy()) return
    if (await act({ action: 'send', prompt: p })) setText('')
  }

  const running = () => state()?.running
  const last = () => state()?.history[0]

  return (
    <section class="lead-panel" aria-labelledby="lead-title">
      <header class="lead-head">
        <h2 class="ptitle" id="lead-title">Lead</h2>
        <Show when={state()}>
          {(s) => (
            <span class="lead-meta">
              {s().model} → {s().subagentModel} agents
              <Show when={s().waiting.length > 0}> · {s().waiting.length} waiting</Show>
            </span>
          )}
        </Show>
      </header>

      <form
        class="lead-form"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <textarea
          class="lead-input"
          rows={3}
          placeholder="Ask the lead… it splits the work across Sonnet agents"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
          aria-label="Prompt for the lead agent"
        />
        <div class="lead-actions">
          <GemButton class="primary" disabled={busy() || !text().trim()} onClick={send}>
            {running() ? 'Queue' : 'Send'}
          </GemButton>
          <Show when={running() || (state()?.waiting.length ?? 0) > 0}>
            <GemButton disabled={busy()} onClick={() => act({ action: 'stop' })}>
              Stop
            </GemButton>
          </Show>
          <Show when={state()?.sessionId && !running()}>
            <GemButton disabled={busy()} onClick={() => act({ action: 'reset' })}>
              New chat
            </GemButton>
          </Show>
        </div>
      </form>

      <Show when={error()}>
        <p class="lead-error" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={running()}>
        {(r) => (
          <div class="lead-run" data-state="running" role="status">
            <span class="st" data-status="running" aria-hidden="true">
              <Gem />
            </span>
            <span class="lead-prompt">{r().prompt}</span>
            <span class="lead-time">{formatDuration(Math.max(0, (now() || r().startedAt) - r().startedAt))}</span>
          </div>
        )}
      </Show>

      <Show when={!running() && last()}>
        {(r) => (
          <div class="lead-run" data-state={r().ok ? 'done' : 'failed'}>
            <span class="lead-prompt">{r().prompt}</span>
            <p class="lead-reply">{r().reply}</p>
          </div>
        )}
      </Show>

      <Show when={(state()?.history.length ?? 0) > 1}>
        <details class="lead-history">
          <summary>Earlier</summary>
          <For each={state()!.history.slice(1)}>
            {(r) => (
              <div class="lead-run" data-state={r.ok ? 'done' : 'failed'}>
                <span class="lead-prompt">{r.prompt}</span>
                <p class="lead-reply">{r.reply}</p>
              </div>
            )}
          </For>
        </details>
      </Show>
    </section>
  )
}
