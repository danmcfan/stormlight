import { For, Show, createMemo, createSignal, onSettled } from 'solid-js'
import { isServer } from '@solidjs/web'
import { Link } from '@tanstack/solid-router'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@ui-sdk/solid/collapsible'
import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogTitle } from '@ui-sdk/solid/dialog'
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from '@ui-sdk/solid/segmented-control'
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui-sdk/solid/tooltip'
import type { Agent } from '../../lib/types'
import type { ImageRef, TranscriptEvent } from '../../server/transcript'
import { Icon, toolIcon } from '../frame/Gem'
import { formatClock, formatCost, formatDuration, formatTokens, shortModel, totalTokens } from '../fleet/format'
import { agentDuration } from '../fleet/rows'
import { StatusDot } from '../fleet/StatusDot'
import { Markdown } from '../md/Markdown'
import './chat.css'

interface TranscriptResponse {
  agent: Agent | null
  events: TranscriptEvent[]
  model?: string
  lines: number
  error?: string
}

type Filter = 'all' | 'messages' | 'tools'
type ToolEvent = Extract<TranscriptEvent, { kind: 'tool' }>

export function chatHref(sessionId: string, agentId?: string | null) {
  const q = new URLSearchParams({ session: sessionId })
  if (agentId && agentId !== sessionId) q.set('agent', agentId)
  return `/chat?${q}`
}

function imageUrl(session: string, agent: string | undefined, img: ImageRef) {
  const q = new URLSearchParams({ session, uuid: img.uuid, i: String(img.index) })
  if (agent) q.set('agent', agent)
  return `/api/transcript/image?${q}`
}

/** One agent's whole conversation: brief, replies, thinking, tool calls with results, images. */
export function AgentChat(props: { session: string; agent?: string }) {
  const [data, setData] = createSignal<TranscriptResponse | undefined>(undefined)
  const [error, setError] = createSignal('')
  const [filter, setFilter] = createSignal<Filter>('all')
  const [now, setNow] = createSignal(0)
  const [zoom, setZoom] = createSignal<string | null>(null)
  let end: HTMLDivElement | undefined
  let lines = -1

  onSettled(() => {
    if (isServer) return
    let alive = true
    let first = true
    const load = async () => {
      try {
        const q = new URLSearchParams({ session: props.session })
        if (props.agent) q.set('agent', props.agent)
        const res = await fetch(`/api/transcript?${q}`, { cache: 'no-store' })
        const j: TranscriptResponse = await res.json()
        if (!alive) return
        if (!res.ok) {
          setError(j.error ?? `HTTP ${res.status}`)
          return
        }
        setError('')
        if (j.lines === lines) return
        const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160
        lines = j.lines
        setData(j)
        if (first || nearBottom) requestAnimationFrame(() => end?.scrollIntoView({ block: 'end' }))
        first = false
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    load()
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 3000)
    setNow(Date.now())
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive = false
      clearInterval(poll)
      clearInterval(clock)
    }
  })

  const shown = createMemo(() => {
    const ev = data()?.events ?? []
    const f = filter()
    if (f === 'messages') return ev.filter((e) => e.kind === 'user' || e.kind === 'text')
    if (f === 'tools') return ev.filter((e) => e.kind === 'tool')
    return ev
  })
  const counts = createMemo(() => {
    const ev = data()?.events ?? []
    return {
      messages: ev.filter((e) => e.kind === 'user' || e.kind === 'text').length,
      tools: ev.filter((e) => e.kind === 'tool').length,
      errors: ev.filter((e) => e.kind === 'tool' && e.result?.isError).length,
    }
  })
  const img = (r: ImageRef) => imageUrl(props.session, props.agent, r)

  return (
    <main class="chat-page shell">
      <Show when={data()?.agent}>{(a) => <ChatHeader agent={a()} now={now()} model={data()?.model} counts={counts()} />}</Show>
      <Show when={!data()?.agent && data()}>
        <header class="chat-head">
          <h1 class="chat-title">Session {props.session.slice(0, 8)}</h1>
        </header>
      </Show>

      <Show when={error()}>
        <p class="chat-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={!data() && !error()}>
        <p class="chat-muted" role="status">
          Loading the transcript…
        </p>
      </Show>

      <Show when={data()}>
        <div class="chat-tools">
          <SegmentedControl class="seg" aria-label="Show" value={filter()} onValueChange={(v) => v && setFilter(v as Filter)}>
            <SegmentedControlIndicator />
            <SegmentedControlItem value="all">Everything</SegmentedControlItem>
            <SegmentedControlItem value="messages">Messages · {counts().messages}</SegmentedControlItem>
            <SegmentedControlItem value="tools">
              Tools · {counts().tools}
              <Show when={counts().errors}> · {counts().errors} failed</Show>
            </SegmentedControlItem>
          </SegmentedControl>
        </div>

        <ol class="chat-log" aria-label="Transcript">
          <For each={shown()} fallback={<li class="chat-muted">Nothing here yet.</li>}>
            {(ev) => (
              <li class="ev" data-kind={ev.kind}>
                <Event ev={ev} session={props.session} img={img} onZoom={setZoom} isFirst={ev === data()!.events[0]} subagent={!!props.agent} />
              </li>
            )}
          </For>
        </ol>
        <div ref={end} class="chat-end" />
      </Show>

      <Dialog open={zoom() !== null} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogBackdrop />
        <DialogContent class="chat-zoom">
          <DialogTitle class="sr-only">Image</DialogTitle>
          <Show when={zoom()}>{(src) => <img src={src()} alt="" />}</Show>
          <DialogClose class="gem-btn chat-zoom-close">Close</DialogClose>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function ChatHeader(props: {
  agent: Agent
  now: number
  model?: string
  counts: { messages: number; tools: number; errors: number }
}) {
  const a = () => props.agent
  return (
    <header class="chat-head">
      <div class="chat-crumbs">
        <Link to="/" class="chat-back">
          ← Fleet
        </Link>
        <Show when={a().parentId}>
          {(pid) => (
            <a class="chat-back" href={chatHref(a().sessionId, pid())}>
              ↑ Parent agent
            </a>
          )}
        </Show>
      </div>
      <h1 class="chat-title">{a().label}</h1>
      <div class="chat-meta">
        <StatusDot status={a().status} />
        <span class="status-word">{a().status}</span>
        <span class="chip mono">{shortModel(props.model ?? a().model)}</span>
        <span>{a().kind === 'main' ? 'Main agent' : 'Subagent'}</span>
        <span>{formatDuration(agentDuration(a(), props.now || a().lastActivityAt))}</span>
        <span>{a().turns} turns</span>
        <span>{formatTokens(totalTokens(a().usage))} tokens</span>
        <Tooltip>
          <TooltipTrigger class="chat-cost">{formatCost(a().costUsd)}</TooltipTrigger>
          <TooltipContent>API-price equivalent, not what your plan bills</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function Event(props: {
  ev: TranscriptEvent
  session: string
  img: (r: ImageRef) => string
  onZoom: (src: string) => void
  isFirst: boolean
  subagent: boolean
}) {
  const ev = props.ev
  if (ev.kind === 'user') {
    const label =
      ev.origin === 'notification'
        ? 'Background task finished'
        : ev.origin === 'command'
          ? 'Command'
          : props.isFirst && props.subagent
            ? 'Brief from the lead'
            : 'Prompt'
    if (ev.origin !== 'prompt') {
      return (
        <Collapsible class="ev-note">
          <CollapsibleTrigger class="ev-note-head">
            <span>{label}</span>
            <time>{formatClock(ev.at)}</time>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <pre class="ev-pre">{ev.text}</pre>
          </CollapsiblePanel>
        </Collapsible>
      )
    }
    return (
      <div class="msg msg-you">
        <div class="msg-label">
          {label} · <time>{formatClock(ev.at)}</time>
        </div>
        <Show when={ev.text}>
          <div class="msg-body">
            <Markdown text={ev.text} />
          </div>
        </Show>
        <Images images={ev.images} img={props.img} onZoom={props.onZoom} />
      </div>
    )
  }
  if (ev.kind === 'text') {
    return (
      <div class="msg msg-agent">
        <div class="msg-body">
          <Markdown text={ev.text} />
        </div>
      </div>
    )
  }
  if (ev.kind === 'thinking') {
    return (
      <Collapsible class="ev-note ev-thinking">
        <CollapsibleTrigger class="ev-note-head">
          <span>Thinking</span>
          <span class="ev-note-peek">{ev.text.slice(0, 90)}</span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div class="ev-thinking-body">{ev.text}</div>
        </CollapsiblePanel>
      </Collapsible>
    )
  }
  return <ToolCard ev={ev} session={props.session} img={props.img} onZoom={props.onZoom} />
}

function ToolCard(props: { ev: ToolEvent; session: string; img: (r: ImageRef) => string; onZoom: (src: string) => void }) {
  const t = props.ev
  const state = t.result ? (t.result.isError ? 'error' : 'done') : 'running'
  const took = t.result ? formatDuration(Math.max(0, t.result.at - t.at)) : 'running'
  return (
    <Collapsible class="tool" data-state={state}>
      <div class="tool-head">
        <CollapsibleTrigger class="tool-toggle" aria-label={`${t.name}: ${t.summary || 'details'}`}>
          <Icon name={toolIcon(t.name)} />
          <span class="tool-name">{t.name}</span>
          <span class="tool-summary">{t.summary}</span>
        </CollapsibleTrigger>
        <Tooltip>
          <TooltipTrigger class="tool-time" aria-label={`Started ${formatClock(t.at)}, ${took}`}>
            <span class="tool-state" data-state={state} aria-hidden="true" />
            {took}
          </TooltipTrigger>
          <TooltipContent>
            {state === 'error' ? 'Failed' : state === 'running' ? 'Still running' : 'Succeeded'} · started {formatClock(t.at)}
          </TooltipContent>
        </Tooltip>
      </div>
      <Show when={t.agentId}>
        {(id) => (
          <a class="tool-sub" href={chatHref(props.session, id())}>
            Open this subagent's chat →
          </a>
        )}
      </Show>
      <Images images={t.result?.images ?? []} img={props.img} onZoom={props.onZoom} />
      <CollapsiblePanel class="tool-panel">
        <div class="tool-section">Input</div>
        <pre class="ev-pre">{t.input}</pre>
        <Show when={t.result}>
          {(r) => (
            <>
              <div class="tool-section">
                {r().isError ? 'Error' : 'Result'}
                <Show when={r().truncated}> (trimmed)</Show>
              </div>
              <Show when={r().text} fallback={<p class="chat-muted">No text output.</p>}>
                <pre class="ev-pre" data-error={r().isError ? '' : undefined}>
                  {r().text}
                </pre>
              </Show>
            </>
          )}
        </Show>
      </CollapsiblePanel>
    </Collapsible>
  )
}

function Images(props: { images: ImageRef[]; img: (r: ImageRef) => string; onZoom: (src: string) => void }) {
  return (
    <Show when={props.images.length}>
      <div class="ev-images">
        <For each={props.images}>
          {(r) => (
            <button type="button" class="ev-thumb" aria-label="Open image" onClick={() => props.onZoom(props.img(r))}>
              <img src={props.img(r)} alt="" loading="lazy" />
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}
