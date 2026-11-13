// The live hub: one WebSocket endpoint (/api/live) that pushes both the swarm
// snapshot and the lead state to every connected dashboard. Server only.
//
// Attached to the underlying Node HTTP server by both vite.config.ts (dev)
// and server.mjs (prod) via attachLive(), so there is exactly one
// implementation of the wiring; `npm run dev` and `node server.mjs` behave
// the same way over the socket.
//
// Protocol (JSON per message, one message per frame):
//   server -> client: {type:'snapshot', data: SwarmSnapshot}
//                      {type:'lead', data: LeadState}
//                      {type:'pong', t}
//   client -> server: {type:'ping', t}   heartbeat; answered with 'pong'
//                      {type:'hello'}    ask for a full state push
//
// On connect the server immediately sends the current snapshot and lead
// state, then pushes each again only when it actually changes. The snapshot
// side reuses the store's existing subscribe(); the lead side has no change
// event, so the hub polls `getLead().getState()` on a short interval and
// compares serialized forms (see `leadDiff`) before broadcasting.
//
// The server also pings every socket on an interval and drops any that
// missed the last pong, so a phone that silently dropped its connection
// (sleep, flaky wifi) does not linger as a dead listener.
import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { getStore } from './store'
import { getLead, type LeadState } from './lead'
import type { SwarmSnapshot } from '../lib/types'

export const LIVE_PATH = '/api/live'

const PING_INTERVAL_MS = 15_000
const LEAD_POLL_MS = 350

export type ServerMessage =
  | { type: 'snapshot'; data: SwarmSnapshot }
  | { type: 'lead'; data: LeadState }
  | { type: 'pong'; t: number }

export type ClientMessage = { type: 'ping'; t?: number } | { type: 'hello' }

/** JSON-encodes a server -> client message. */
export function encodeMessage(msg: ServerMessage): string {
  return JSON.stringify(msg)
}

/** Parses a client -> server message; undefined for malformed JSON or an unrecognized type. */
export function parseClientMessage(raw: unknown): ClientMessage | undefined {
  if (typeof raw !== 'string') return undefined
  let j: unknown
  try {
    j = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return undefined
  const rec = j as Record<string, unknown>
  if (rec.type === 'ping') return { type: 'ping', t: typeof rec.t === 'number' ? rec.t : undefined }
  if (rec.type === 'hello') return { type: 'hello' }
  return undefined
}

/**
 * Compares a freshly-read LeadState against the last one broadcast
 * (by its serialized form) so the hub can skip a redundant push. Pure: no
 * sockets, no timers, so the "only broadcast on real change" rule is
 * unit-testable on its own.
 */
export function leadDiff(prevSerialized: string, next: LeadState): { changed: boolean; serialized: string } {
  const serialized = JSON.stringify(next)
  return { changed: serialized !== prevSerialized, serialized }
}

interface LiveSocket extends WebSocket {
  alive?: boolean
}

export interface LiveHub {
  /** Number of sockets currently connected; for tests/diagnostics. */
  clientCount(): number
  /** Detaches from the HTTP server and stops all timers/subscriptions. */
  close(): void
}

const ATTACHED = Symbol.for('swarm.live.attached')

/** Attaches the live hub to a Node HTTP server. Idempotent per server instance. */
export function attachLive(server: HttpServer): LiveHub {
  const tagged = server as HttpServer & { [ATTACHED]?: LiveHub }
  const existing = tagged[ATTACHED]
  if (existing) return existing

  const wss = new WebSocketServer({ noServer: true })
  const clients = new Set<LiveSocket>()

  const sendTo = (ws: LiveSocket, msg: ServerMessage) => {
    if (ws.readyState !== ws.OPEN) return
    try {
      ws.send(encodeMessage(msg))
    } catch {
      // socket is on its way out; the close/error handler will drop it
    }
  }

  const broadcast = (msg: ServerMessage) => {
    for (const ws of clients) sendTo(ws, msg)
  }

  const unsubscribeSnapshot = getStore().subscribe((snapshot) => broadcast({ type: 'snapshot', data: snapshot }))

  let lastLead = ''
  const pushLeadIfChanged = () => {
    const state = getLead().getState()
    const { changed, serialized } = leadDiff(lastLead, state)
    if (!changed) return
    lastLead = serialized
    broadcast({ type: 'lead', data: state })
  }
  const leadTimer = setInterval(pushLeadIfChanged, LEAD_POLL_MS)
  leadTimer.unref?.()

  const pingTimer = setInterval(() => {
    for (const ws of clients) {
      if (ws.alive === false) {
        ws.terminate()
        clients.delete(ws)
        continue
      }
      ws.alive = false
      try {
        ws.ping()
      } catch {
        // ignore; close/error will clean it up
      }
    }
  }, PING_INTERVAL_MS)
  pingTimer.unref?.()

  wss.on('connection', (ws: LiveSocket) => {
    clients.add(ws)
    ws.alive = true
    ws.on('pong', () => {
      ws.alive = true
    })
    ws.on('message', (raw) => {
      const msg = parseClientMessage(typeof raw === 'string' ? raw : raw.toString())
      if (!msg) return
      if (msg.type === 'ping') sendTo(ws, { type: 'pong', t: msg.t ?? Date.now() })
      else if (msg.type === 'hello') {
        sendTo(ws, { type: 'snapshot', data: getStore().getSnapshot() })
        sendTo(ws, { type: 'lead', data: getLead().getState() })
      }
    })
    ws.on('close', () => clients.delete(ws))
    ws.on('error', () => clients.delete(ws))

    // Full push on connect, independent of the change-detection used for
    // later broadcasts.
    sendTo(ws, { type: 'snapshot', data: getStore().getSnapshot() })
    const state = getLead().getState()
    lastLead = JSON.stringify(state)
    sendTo(ws, { type: 'lead', data: state })
  })

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname: string
    try {
      pathname = new URL(req.url ?? '', 'http://live.internal').pathname
    } catch {
      return
    }
    if (pathname !== LIVE_PATH) return
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  }
  server.on('upgrade', onUpgrade)

  const hub: LiveHub = {
    clientCount: () => clients.size,
    close() {
      server.off('upgrade', onUpgrade)
      clearInterval(leadTimer)
      clearInterval(pingTimer)
      unsubscribeSnapshot()
      for (const ws of clients) ws.terminate()
      clients.clear()
      wss.close()
      delete tagged[ATTACHED]
    },
  }
  tagged[ATTACHED] = hub
  return hub
}
