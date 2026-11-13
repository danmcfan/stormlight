import { For, Show, createSignal, onCleanup, onSettled } from 'solid-js'
import { isServer } from '@solidjs/web'
import type { LeadImage, LeadRun } from '../../server/lead'
import { Gem } from '../frame/Gem'
import { Markdown } from '../md/Markdown'
import { Composer } from './Composer'
import { Activity } from './Activity'
import { useLead, type Lead } from './useLead'
import { formatDuration, shortModel } from '../fleet/format'
import { chatHref } from '../chat/AgentChat'
import './lead.css'

const EXAMPLE_PROMPTS = [
  'What changed on main in the last day?',
  'Check whether npm test and npm run build pass',
  'Summarize the open issues under the plan',
]

function reducedMotion(): boolean {
  return !isServer && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function Meta(props: { lead: Lead }) {
  return (
    <Show when={props.lead.state()}>
      {(s) => (
        <span class="lead-meta">
          {shortModel(s().model)} → {shortModel(s().subagentModel)} agents
          <Show when={s().waiting.length > 0}> · {s().waiting.length} waiting</Show>
        </span>
      )}
    </Show>
  )
}

/** Ticks on its own 1s timer so only this text updates — never the turn around it. */
function ElapsedTime(props: { startedAt: number }) {
  const [elapsed, setElapsed] = createSignal(Math.max(0, Date.now() - props.startedAt))

  onSettled(() => {
    if (isServer) return
    const id = setInterval(() => setElapsed(Math.max(0, Date.now() - props.startedAt)), 1000)
    return () => clearInterval(id)
  })

  return <span class="lead-elapsed">{formatDuration(elapsed())}</span>
}

function Working(props: { startedAt: number }) {
  return (
    <span class="lead-working" role="status">
      <span class="st" data-status="running" aria-hidden="true">
        <Gem />
      </span>
      Working · <ElapsedTime startedAt={props.startedAt} />
    </span>
  )
}

/** Thumbnails for a prompt's attached images; tap one to see it full size. */
function ImageThumbs(props: { images?: LeadImage[] }) {
  const [openIndex, setOpenIndex] = createSignal<number | null>(null)
  const images = () => props.images ?? []
  return (
    <Show when={images().length > 0}>
      <div class="lead-images">
        <For each={images()}>
          {(img, i) => (
            <button type="button" class="lead-image-thumb" onClick={() => setOpenIndex(i())}>
              <img src={img.url} alt={img.name} loading="lazy" />
            </button>
          )}
        </For>
      </div>
      <Show when={openIndex() !== null && images()[openIndex()!]}>
        {(img) => (
          <div class="lead-lightbox" onClick={() => setOpenIndex(null)}>
            <img src={img().url} alt={img().name} />
            <button type="button" class="lead-lightbox-close" aria-label="Close image" onClick={() => setOpenIndex(null)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}
      </Show>
    </Show>
  )
}

function PromptBubble(props: { prompt: string; images?: LeadImage[]; pending?: boolean }) {
  return (
    <div class="lead-turn-you">
      <p class="bubble you" data-state={props.pending ? 'waiting' : undefined}>
        {props.prompt}
      </p>
      <ImageThumbs images={props.images} />
    </div>
  )
}

/** Model, duration and a copy button under a finished reply. */
function ReplyMeta(props: { run: LeadRun }) {
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const duration = () => formatDuration((props.run.endedAt ?? props.run.startedAt) - props.run.startedAt)
  const copy = async () => {
    try {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
      if (!clipboard || !props.run.reply) return
      await clipboard.writeText(props.run.reply)
      setCopied(true)
      clearTimeout(timer)
      timer = setTimeout(() => setCopied(false), 1500)
    } catch {
      /* no Clipboard API; degrade silently */
    }
  }

  return (
    <div class="lead-reply-meta">
      <Show when={props.run.model}>
        <span>{shortModel(props.run.model!)}</span>
      </Show>
      <span aria-hidden="true">·</span>
      <span>{duration()}</span>
      <button type="button" class="lead-copy" onClick={copy}>
        {copied() ? 'Copied' : 'Copy reply'}
      </button>
    </div>
  )
}

/** A finished run's reply: Markdown when it succeeded, a scrollable error dump when it didn't. */
function ReplyBody(props: { run: LeadRun }) {
  return (
    <Show
      when={props.run.ok}
      fallback={
        <div class="bubble lead" data-state="failed">
          <p class="lead-error-label">Failed</p>
          <pre class="lead-error-text">{props.run.reply}</pre>
        </div>
      }
    >
      <div class="bubble lead" data-state="done">
        <Markdown text={props.run.reply ?? ''} />
      </div>
    </Show>
  )
}

/** Compact Lead for the right sidebar: composer, then the latest exchange. */
export function LeadPanel() {
  const lead = useLead()
  const running = () => lead.state()?.running
  const last = () => lead.state()?.history[0]
  const sessionId = () => lead.state()?.sessionId
  return (
    <section class="lead-panel" aria-labelledby="lead-side-title">
      <header class="lead-head">
        <h2 class="ptitle" id="lead-side-title">
          Lead
        </h2>
        <Meta lead={lead} />
      </header>
      <Composer lead={lead} variant="panel" placeholder="Ask the lead… it splits the work across Sonnet agents" />
      <Show when={running()}>
        {(r) => (
          <div class="lead-run">
            <PromptBubble prompt={r().prompt} images={r().images} />
            <div class="bubble lead" data-state="running">
              <Working startedAt={r().startedAt} />
            </div>
            <Activity sessionId={sessionId} from={() => r().startedAt} to={() => undefined} live={() => true} />
          </div>
        )}
      </Show>
      <Show when={!running() && last()}>
        {(r) => (
          <div class="lead-run">
            <PromptBubble prompt={r().prompt} images={r().images} />
            <ReplyBody run={r()} />
            <ReplyMeta run={r()} />
            <Activity sessionId={sessionId} from={() => r().startedAt} to={() => r().endedAt} live={() => false} />
          </div>
        )}
      </Show>
    </section>
  )
}

const NEAR_BOTTOM_PX = 80

/** Sticks to the bottom of the *log container* (never `window`) while a
 * sentinel at its end is within ~80px of view, and stops the moment the
 * person scrolls away from it. */
function useStickToBottom() {
  const [atBottom, setAtBottom] = createSignal(true)
  let logEl: HTMLElement | undefined
  let endEl: HTMLElement | undefined

  onSettled(() => {
    if (isServer || !logEl || !endEl) return
    const io = new IntersectionObserver(([entry]) => setAtBottom(entry.isIntersecting), {
      root: logEl,
      rootMargin: `0px 0px ${NEAR_BOTTOM_PX}px 0px`,
      threshold: 0,
    })
    io.observe(endEl)
    return () => io.disconnect()
  })

  const scrollToEnd = (smooth = true) => {
    logEl?.scrollTo({ top: logEl.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
  }

  return {
    atBottom,
    setLogRef: (el: HTMLElement) => {
      logEl = el
    },
    setEndRef: (el: HTMLElement) => {
      endEl = el
    },
    scrollToEnd,
  }
}

/** Full-screen Lead chat: conversation oldest-first, composer pinned above the home bar. */
export function LeadChat() {
  const stick = useStickToBottom()
  const lead = useLead(() => {
    if (stick.atBottom()) requestAnimationFrame(() => stick.scrollToEnd())
  })
  const runs = () => [...(lead.state()?.history ?? [])].reverse()
  const sessionId = () => lead.state()?.sessionId
  let fillComposer: (text: string) => void = () => {}

  return (
    <div class="lead-chat">
      <header class="lead-head shell">
        <h1 class="ptitle">Lead</h1>
        <Meta lead={lead} />
        <Show when={lead.state()?.sessionId}>
          {(id) => (
            <a class="lead-full" href={chatHref(id())}>
              See everything the lead did: thinking, tool calls, subagents →
            </a>
          )}
        </Show>
      </header>

      <ol class="lead-log shell" aria-label="Conversation with the lead" ref={stick.setLogRef}>
        <Show when={lead.state() && runs().length === 0 && !lead.state()!.running}>
          <li class="lead-empty">
            <p>
              Ask for anything in the repo. The lead plans it and runs Sonnet agents in parallel; watch them in Fleet
              and Graph.
            </p>
            <div class="lead-examples">
              <For each={EXAMPLE_PROMPTS}>
                {(ex) => (
                  <button type="button" class="chip lead-example" onClick={() => fillComposer(ex)}>
                    {ex}
                  </button>
                )}
              </For>
            </div>
          </li>
        </Show>

        <For each={runs()} keyed={(r) => r.startedAt}>
          {(item) => {
            const r = item()
            return (
              <li class="lead-turn" data-state={r.ok ? 'done' : 'failed'}>
                <PromptBubble prompt={r.prompt} images={r.images} />
                <ReplyBody run={r} />
                <ReplyMeta run={r} />
                <Activity sessionId={sessionId} from={() => r.startedAt} to={() => r.endedAt} live={() => false} />
              </li>
            )
          }}
        </For>

        <Show when={lead.state()?.running}>
          {(r) => (
            <li class="lead-turn">
              <PromptBubble prompt={r().prompt} images={r().images} />
              <div class="bubble lead" data-state="running">
                <Working startedAt={r().startedAt} />
              </div>
              <Activity sessionId={sessionId} from={() => r().startedAt} to={() => undefined} live={() => true} />
            </li>
          )}
        </Show>

        <For each={lead.state()?.waiting ?? []} keyed={(w) => w.prompt}>
          {(item) => {
            const w = item()
            return (
              <li class="lead-turn">
                <PromptBubble prompt={w.prompt} images={w.images} pending />
              </li>
            )
          }}
        </For>

        <li class="lead-log-end" aria-hidden="true" ref={stick.setEndRef} />
      </ol>

      <div class="lead-dock">
        <Show when={!stick.atBottom()}>
          <div class="lead-jump-wrap shell">
            <button type="button" class="lead-jump" onClick={() => stick.scrollToEnd(true)}>
              ↓ Jump to latest
            </button>
          </div>
        </Show>
        <div class="shell">
          <Composer
            lead={lead}
            variant="chat"
            placeholder="Message the lead"
            onFillRequest={(fill) => (fillComposer = fill)}
            onSent={() => stick.scrollToEnd(false)}
          />
        </div>
      </div>
    </div>
  )
}
