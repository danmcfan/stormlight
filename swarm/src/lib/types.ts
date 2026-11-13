// The data contract between the transcript reader (server) and the views.
// The server builds a SwarmSnapshot from Claude Code transcripts and streams it
// over Server-Sent Events; the views only ever read snapshots.
//
// Endpoints:
//   GET /api/swarm         -> SwarmSnapshot as JSON
//   GET /api/swarm/stream  -> text/event-stream; each `snapshot` event's data is
//                             a SwarmSnapshot (sent on connect, then on change,
//                             and at least every 5 s as a heartbeat)
//
// Client: `useSwarm()` from `src/lib/useSwarm.ts` returns
//   { snapshot: () => SwarmSnapshot | undefined, connected: () => boolean }

export type AgentStatus = 'running' | 'idle' | 'done' | 'error'

/** Token counts as billed by the API. */
export interface TokenUsage {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

export interface ToolCall {
  id: string
  /** Tool name, e.g. Read, Edit, Bash, Agent. */
  name: string
  /** Epoch ms. */
  at: number
  /** Repo-relative file or directory path the call targeted, when it has one. */
  path?: string
  /** Id of the Component the path falls in. */
  componentId?: string
  /** One short line for display, e.g. "Edit src/combat/moves.ts". */
  summary: string
}

export interface Agent {
  /** Unique across all sessions. */
  id: string
  sessionId: string
  /** Agent that spawned this one; null for a session's main agent. */
  parentId: string | null
  kind: 'main' | 'subagent'
  /** Short display name. */
  label: string
  /** The task description it was given, when known. */
  description?: string
  /** Model id from the transcript, e.g. claude-sonnet-5-5. */
  model: string
  status: AgentStatus
  /** Round this subagent was launched in; null for main agents. */
  roundId: string | null
  /** Epoch ms. */
  startedAt: number
  lastActivityAt: number
  endedAt?: number
  /** Assistant API responses so far. */
  turns: number
  usage: TokenUsage
  costUsd: number
  /** Most recent tool calls, oldest first, capped at 200. */
  toolCalls: ToolCall[]
  /** componentId -> number of tool calls that touched it. */
  touched: Record<string, number>
  /** What it is doing now, e.g. the last tool call summary. */
  currentActivity?: string
}

/** A batch of subagents launched by one assistant message of a parent agent. */
export interface Round {
  id: string
  sessionId: string
  /** 1-based, in launch order within the session. */
  index: number
  startedAt: number
  endedAt?: number
  agentIds: string[]
  usage: TokenUsage
  costUsd: number
}

/** A directory of the repository the session works in. */
export interface Component {
  /** Repo-relative directory path, e.g. "src/combat"; "." is the repo root. */
  id: string
  label: string
  parentId: string | null
  fileCount: number
}

export interface Session {
  id: string
  /** Working directory of the session (the repository root). */
  cwd: string
  title?: string
  startedAt: number
  lastActivityAt: number
  agentIds: string[]
}

export interface ModelTotals {
  usage: TokenUsage
  costUsd: number
}

export interface SwarmSnapshot {
  /** Epoch ms. */
  generatedAt: number
  sessions: Session[]
  agents: Agent[]
  rounds: Round[]
  components: Component[]
  totals: {
    usage: TokenUsage
    costUsd: number
    byModel: Record<string, ModelTotals>
  }
  /** Shown next to costs: they are estimates from list prices. */
  pricingNote: string
}
