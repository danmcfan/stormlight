import { For, Show, createSignal, onSettled } from 'solid-js'
import { isServer } from '@solidjs/web'
import type { LeadRun, LeadState } from '../../server/lead'
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

/** Lead state, polled, plus the actions. */
function useLead(onChange?: () => void) {
  const [state, setState] = createSignal<LeadState | undefined>(undefined)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [now, setNow] = createSignal(0)
  let sig = ''

  const apply = (s: LeadState) => {
    setState(s)
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
        const res = await fetch('/api/lead', { cache: 'no-store' })
        if (alive && res.ok) apply(await res.json())
      } catch {
        /* offline; the nav shows Offline */
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
      apply(await post(body))
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return { state, busy, error, now, act }
}

type Lead = ReturnType<typeof useLead>

function Composer(props: { lead: Lead; rows: number; placeholder: string }) {
  const [text, setText] = createSignal('')
  const lead = props.lead
  const running = () => !!lead.state()?.running
  const send = async () => {
    const p = text().trim()
    if (!p || lead.busy()) return
    if (await lead.act({ action: 'send', prompt: p })) setText('')
  }
  return (
    <form
      class="lead-form"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <textarea
        class="lead-input"
        rows={props.rows}
        placeholder={props.placeholder}
        enterkeyhint="send"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Enter sends; Shift+Enter for a new line.
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault()
            send()
          }
        }}
        aria-label="Prompt for the lead agent"
      />
      <div class="lead-actions">
        <GemButton class="primary" disabled={lead.busy() || !text().trim()} onClick={send}>
          {running() ? 'Queue' : 'Send'}
        </GemButton>
        <Show when={running() || (lead.state()?.waiting.length ?? 0) > 0}>
          <GemButton disabled={lead.busy()} onClick={() => lead.act({ action: 'stop' })}>
            Stop
          </GemButton>
        </Show>
        <Show when={lead.state()?.sessionId && !running()}>
          <GemButton disabled={lead.busy()} onClick={() => lead.act({ action: 'reset' })}>
            New chat
          </GemButton>
        </Show>
      </div>
      <Show when={lead.error()}>
        <p class="lead-error" role="alert">
          {lead.error()}
        </p>
      </Show>
    </form>
  )
}

function Meta(props: { lead: Lead }) {
  return (
    <Show when={props.lead.state()}>
      {(s) => (
        <span class="lead-meta">
          {s().model} → {s().subagentModel} agents
          <Show when={s().waiting.length > 0}> · {s().waiting.length} waiting</Show>
        </span>
      )}
    </Show>
  )
}

function Working(props: { run: LeadRun; now: number }) {
  return (
    <span class="lead-working" role="status">
      <span class="st" data-status="running" aria-hidden="true">
        <Gem />
      </span>
      Working · {formatDuration(Math.max(0, (props.now || props.run.startedAt) - props.run.startedAt))}
    </span>
  )
}

/** Compact Lead for the right sidebar: composer, then the latest exchange. */
export function LeadPanel() {
  const lead = useLead()
  const running = () => lead.state()?.running
  const last = () => lead.state()?.history[0]
  return (
    <section class="lead-panel" aria-labelledby="lead-side-title">
      <header class="lead-head">
        <h2 class="ptitle" id="lead-side-title">
          Lead
        </h2>
        <Meta lead={lead} />
      </header>
      <Composer lead={lead} rows={3} placeholder="Ask the lead… it splits the work across Sonnet agents" />
      <Show when={running()}>
        {(r) => (
          <div class="lead-run">
            <span class="lead-prompt">{r().prompt}</span>
            <Working run={r()} now={lead.now()} />
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
    </section>
  )
}

/** Full-screen Lead chat: conversation oldest-first, composer pinned above the home bar. */
export function LeadChat() {
  const scrollDown = () =>
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }))
  const lead = useLead(scrollDown)
  const runs = () => [...(lead.state()?.history ?? [])].reverse()
  return (
    <div class="lead-chat">
      <header class="lead-head shell">
        <h1 class="ptitle">Lead</h1>
        <Meta lead={lead} />
      </header>

      <ol class="lead-log shell" aria-label="Conversation with the lead">
        <Show when={lead.state() && runs().length === 0 && !lead.state()!.running}>
          <li class="lead-empty">
            Ask for anything in the repo. The lead plans it and runs Sonnet agents in parallel; watch them in Fleet
            and Graph.
          </li>
        </Show>
        <For each={runs()}>
          {(r) => (
            <li class="lead-turn">
              <p class="bubble you">{r.prompt}</p>
              <p class="bubble lead" data-state={r.ok ? 'done' : 'failed'}>
                {r.reply}
              </p>
            </li>
          )}
        </For>
        <Show when={lead.state()?.running}>
          {(r) => (
            <li class="lead-turn">
              <p class="bubble you">{r().prompt}</p>
              <p class="bubble lead" data-state="running">
                <Working run={r()} now={lead.now()} />
              </p>
            </li>
          )}
        </Show>
        <For each={lead.state()?.waiting ?? []}>
          {(p) => (
            <li class="lead-turn">
              <p class="bubble you" data-state="waiting">
                {p}
              </p>
            </li>
          )}
        </For>
      </ol>

      <div class="lead-dock">
        <div class="shell">
          <Composer lead={lead} rows={2} placeholder="Message the lead" />
        </div>
      </div>
    </div>
  )
}
