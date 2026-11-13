// Browser client for the live channel: one shared WebSocket to /api/live
// that fans out swarm snapshots and lead state to any number of
// subscribers (Header, Fleet, Graph, the Lead chat, ...). Falls back to the
// existing SSE stream (snapshots) and a slow poll of /api/lead (lead state)
// if the socket cannot be opened at all.
//
// Protocol: see src/server/live.ts. Messages are JSON, one per frame:
//   server -> client: {type:'snapshot', data: SwarmSnapshot}
//                      {type:'lead', data: LeadState}
//                      {type:'pong', t}
//   client -> server: {type:'ping', t}   sent every ~10s as a heartbeat
//                      {type:'hello'}    ask for a full state push
//
// SSR safety: nothing here touches `window`/`WebSocket`/`EventSource` at
// module scope; connecting only happens inside `ensureStarted()`, which
// bails out on the server via `isServer`.
import { isServer } from '@solidjs/web'
import type { SwarmSnapshot } from './types'
import type { LeadState } from '../server/lead'

export interface LiveHandlers {
  onSnapshot?: (s: SwarmSnapshot) => void
  onLead?: (s: LeadState) => void
  onStatus?: (connected: boolean) => void
}

const WS_PATH = '/api/live'
const SSE_PATH = '/api/swarm/stream'
const LEAD_POLL_URL = '/api/lead'

const BACKOFF_MIN_MS = 500
const BACKOFF_MAX_MS = 15_000
/** No traffic (message or our own ping) for this long: treat the socket as dead. */
const IDLE_TIMEOUT_MS = 30_000
const CLIENT_PING_MS = 10_000
/** Consecutive failed socket attempts, with the socket never having opened, before falling back. */
const FALLBACK_AFTER_FAILURES = 3
const LEAD_FALLBACK_POLL_MS = 5_000

// --- pure helpers (unit tested without any socket) -------------------------

/** Doubles the previous delay, capped at the maximum. Monotonic and idempotent at the cap. */
export function nextBackoff(prev: number): number {
  return Math.min(Math.max(prev, BACKOFF_MIN_MS) * 2, BACKOFF_MAX_MS)
}

/** +/-20% jitter around `ms`, never below the minimum. `rand` (0..1) is injectable for tests. */
export function jitterBackoff(ms: number, rand: number = Math.random()): number {
  const span = ms * 0.2
  return Math.max(BACKOFF_MIN_MS, Math.round(ms - span / 2 + rand * span))
}

type ServerMessage =
  | { type: 'snapshot'; data: SwarmSnapshot }
  | { type: 'lead'; data: LeadState }
  | { type: 'pong'; t?: number }

/** Parses a server -> client message; undefined for malformed JSON or an unrecognized type. */
export function parseServerMessage(raw: string): ServerMessage | undefined {
  let j: unknown
  try {
    j = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return undefined
  const rec = j as Record<string, unknown>
  if (rec.type === 'snapshot') return { type: 'snapshot', data: rec.data as SwarmSnapshot }
  if (rec.type === 'lead') return { type: 'lead', data: rec.data as LeadState }
  if (rec.type === 'pong') return { type: 'pong', t: typeof rec.t === 'number' ? rec.t : undefined }
  return undefined
}

// --- shared hub state (module-level singleton; one socket for the page) ----

const handlers = new Set<LiveHandlers>()
let started = false
let connected = false
let lastSnapshot: SwarmSnapshot | undefined
let lastLead: LeadState | undefined

let ws: WebSocket | undefined
let wsBackoff = BACKOFF_MIN_MS
let wsReconnectTimer: ReturnType<typeof setTimeout> | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined
let clientPingTimer: ReturnType<typeof setInterval> | undefined
let connecting = false
let wsEverConnected = false
let consecutiveFailures = 0
let wsConnected = false

let fallbackActive = false
let fallbackConnected = false
let sse: EventSource | undefined
let sseBackoff = BACKOFF_MIN_MS
let sseReconnectTimer: ReturnType<typeof setTimeout> | undefined
let leadPollTimer: ReturnType<typeof setInterval> | undefined

function setConnected(v: boolean) {
  if (connected === v) return
  connected = v
  for (const h of handlers) h.onStatus?.(v)
}

function updateConnected() {
  setConnected(wsConnected || fallbackConnected)
}

function emitSnapshot(s: SwarmSnapshot) {
  lastSnapshot = s
  for (const h of handlers) h.onSnapshot?.(s)
}

function emitLead(s: LeadState) {
  lastLead = s
  for (const h of handlers) h.onLead?.(s)
}

/** True while the socket (or the fallback) is delivering updates. */
export function liveConnected(): boolean {
  return connected
}

/**
 * Subscribe to the live channel. Returns an unsubscribe. Safe to call many
 * times; one shared socket underneath. A late subscriber immediately gets
 * the most recent snapshot/lead/status known so far, so switching views
 * does not blank the UI while waiting for the next push.
 */
export function subscribeLive(h: LiveHandlers): () => void {
  handlers.add(h)
  if (lastSnapshot) h.onSnapshot?.(lastSnapshot)
  if (lastLead) h.onLead?.(lastLead)
  h.onStatus?.(connected)
  ensureStarted()
  return () => {
    handlers.delete(h)
  }
}

function ensureStarted() {
  if (started || isServer) return
  started = true
  connectSocket()
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kickReconnect()
  })
  window.addEventListener('online', kickReconnect)
}

/** Cancel any pending backoff wait and try to connect right now, if not already connected/connecting. */
function kickReconnect() {
  if (isServer) return
  if (!wsConnected) {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer)
      wsReconnectTimer = undefined
    }
    if (!connecting) connectSocket()
  }
  if (fallbackActive && !fallbackConnected) {
    if (sseReconnectTimer) {
      clearTimeout(sseReconnectTimer)
      sseReconnectTimer = undefined
    }
    startSSE()
  }
}

// --- the socket --------------------------------------------------------

function wsUrl(): string {
  const url = new URL(WS_PATH, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = undefined
}

function armIdleTimer() {
  clearIdleTimer()
  idleTimer = setTimeout(() => {
    // No traffic for a while; force a reconnect rather than trusting a
    // socket that might be silently dead (e.g. the phone slept).
    ws?.close()
  }, IDLE_TIMEOUT_MS)
}

function scheduleWsReconnect() {
  if (wsReconnectTimer) return
  const delay = jitterBackoff(wsBackoff)
  wsBackoff = nextBackoff(wsBackoff)
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = undefined
    connectSocket()
  }, delay)
}

function connectSocket() {
  if (isServer || connecting) return
  connecting = true
  let socket: WebSocket
  try {
    socket = new WebSocket(wsUrl())
  } catch {
    connecting = false
    onSocketDown()
    return
  }
  ws = socket

  socket.onopen = () => {
    connecting = false
    consecutiveFailures = 0
    wsEverConnected = true
    wsBackoff = BACKOFF_MIN_MS
    wsConnected = true
    disableFallback()
    updateConnected()
    armIdleTimer()
    clientPingTimer = setInterval(() => {
      try {
        socket.send(JSON.stringify({ type: 'ping', t: Date.now() }))
      } catch {
        /* a send failure means the socket is already on its way down */
      }
    }, CLIENT_PING_MS)
  }
  socket.onmessage = (ev) => {
    armIdleTimer()
    const msg = parseServerMessage(String(ev.data))
    if (!msg) return
    if (msg.type === 'snapshot') emitSnapshot(msg.data)
    else if (msg.type === 'lead') emitLead(msg.data)
    // 'pong' needs no handling beyond the idle-timer reset above.
  }
  socket.onclose = () => {
    connecting = false
    clearIdleTimer()
    if (clientPingTimer) clearInterval(clientPingTimer)
    clientPingTimer = undefined
    ws = undefined
    wsConnected = false
    updateConnected()
    onSocketDown()
  }
  socket.onerror = () => {
    // A close event always follows; the retry/fallback logic lives there.
  }
}

function onSocketDown() {
  consecutiveFailures += 1
  if (!wsEverConnected && consecutiveFailures >= FALLBACK_AFTER_FAILURES) enableFallback()
  scheduleWsReconnect()
}

// --- the fallback: SSE for snapshots, a slow poll for lead state --------

function enableFallback() {
  if (fallbackActive) return
  fallbackActive = true
  startSSE()
  startLeadPoll()
}

function disableFallback() {
  if (!fallbackActive) return
  fallbackActive = false
  if (sseReconnectTimer) {
    clearTimeout(sseReconnectTimer)
    sseReconnectTimer = undefined
  }
  sse?.close()
  sse = undefined
  fallbackConnected = false
  if (leadPollTimer) clearInterval(leadPollTimer)
  leadPollTimer = undefined
}

function scheduleSseReconnect() {
  if (sseReconnectTimer || !fallbackActive) return
  const delay = jitterBackoff(sseBackoff)
  sseBackoff = nextBackoff(sseBackoff)
  sseReconnectTimer = setTimeout(() => {
    sseReconnectTimer = undefined
    startSSE()
  }, delay)
}

function startSSE() {
  if (sse || isServer) return
  let es: EventSource
  try {
    es = new EventSource(SSE_PATH)
  } catch {
    scheduleSseReconnect()
    return
  }
  sse = es
  es.onopen = () => {
    sseBackoff = BACKOFF_MIN_MS
    fallbackConnected = true
    updateConnected()
  }
  es.addEventListener('snapshot', (ev) => {
    try {
      emitSnapshot(JSON.parse((ev as MessageEvent).data) as SwarmSnapshot)
      fallbackConnected = true
      updateConnected()
    } catch {
      /* ignore a malformed event */
    }
  })
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      es.close()
      if (sse === es) sse = undefined
      fallbackConnected = false
      updateConnected()
      scheduleSseReconnect()
    }
  }
}

function startLeadPoll() {
  if (leadPollTimer) return
  const poll = async () => {
    try {
      const res = await fetch(LEAD_POLL_URL, { cache: 'no-store' })
      if (res.ok) emitLead((await res.json()) as LeadState)
    } catch {
      /* offline; connection status is tracked by the socket/SSE side */
    }
  }
  poll()
  leadPollTimer = setInterval(poll, LEAD_FALLBACK_POLL_MS)
}
