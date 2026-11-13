// Pure transcript logic: line splitting, per-agent accumulation, snapshot building.
// No file system access here, so it can be unit-tested with fixture lines.
//
// Transcript format (Claude Code, observed):
//   <project>/<sessionId>.jsonl                      main agent
//   <project>/<sessionId>/subagents/agent-<id>.jsonl subagent records (isSidechain, agentId)
//   <project>/<sessionId>/subagents/agent-<id>.meta.json
//        { description, agentType, model, toolUseId, ... }
// The meta file's toolUseId is the id of the "Agent" tool_use block in the
// spawning agent's transcript. The parent's tool_result for that block carries
// toolUseResult.agentId (async launches report status "async_launched"; the
// real completion arrives later as a <task-notification> user message).
import { addUsage, costOf, emptyUsage, pricingNote } from '../lib/pricing'
import type {
  Agent,
  AgentStatus,
  Component,
  ModelTotals,
  Round,
  Session,
  SwarmSnapshot,
  TokenUsage,
  ToolCall,
} from '../lib/types'
import { componentForPath, relativeToCwd } from './components'

export const RUNNING_WINDOW_MS = 45_000
export const DONE_QUIET_MS = 10 * 60_000
/** Records this much newer than a completion mean the agent was resumed (e.g. via SendMessage). */
export const RESUME_SLACK_MS = 2_000
export const MAX_TOOL_CALLS = 200

/** Split appended bytes into complete lines; the unterminated tail is returned as `rest`. */
export function splitLines(prev: Buffer, chunk: Buffer): { lines: string[]; rest: Buffer } {
  const buf = prev.length ? Buffer.concat([prev, chunk]) : chunk
  const cut = buf.lastIndexOf(0x0a)
  if (cut < 0) return { lines: [], rest: Buffer.from(buf) }
  const lines = buf
    .subarray(0, cut)
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
  return { lines, rest: Buffer.from(buf.subarray(cut + 1)) }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function usageFromApi(u: any): TokenUsage {
  const cc = u?.cache_creation
  const total = num(u?.cache_creation_input_tokens)
  let w5 = num(cc?.ephemeral_5m_input_tokens)
  const w1 = num(cc?.ephemeral_1h_input_tokens)
  // Without the breakdown (or when it undercounts), the remainder bills as 5m.
  if (w5 + w1 < total) w5 = total - w1
  return {
    input: num(u?.input_tokens),
    output: num(u?.output_tokens),
    cacheWrite5m: w5,
    cacheWrite1h: w1,
    cacheRead: num(u?.cache_read_input_tokens),
  }
}

export interface AgentMeta {
  description?: string
  agentType?: string
  model?: string
  toolUseId?: string
}

interface MessageAcc {
  model: string
  usage: TokenUsage
}

interface SpawnInfo {
  toolUseId: string
  messageKey: string
  at: number
  description?: string
  subagentType?: string
}

interface Completion {
  at: number
  status: 'done' | 'error'
}

const SPAWN_TOOLS = new Set(['Agent', 'Task'])

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function oneLine(s: string, max = 80): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/** Extract a repo-relative path and a one-line summary from a tool_use block. */
export function describeToolUse(
  name: string,
  input: any,
  cwd: string | undefined,
): { path?: string; summary: string } {
  const inp = input && typeof input === 'object' ? input : {}
  let raw: string | undefined
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      raw = str(inp.file_path)
      break
    case 'NotebookEdit':
      raw = str(inp.notebook_path) ?? str(inp.file_path)
      break
    case 'Glob':
    case 'Grep':
      raw = str(inp.path)
      break
    case 'Bash': {
      // Only obvious: a leading `cd <dir>` inside the repo.
      const m = /^\s*cd\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))/.exec(str(inp.command) ?? '')
      raw = m ? (m[2] ?? m[3] ?? m[4]) : undefined
      break
    }
  }
  const path = raw && cwd ? relativeToCwd(raw, cwd) : undefined
  let summary: string
  switch (name) {
    case 'Bash':
      summary = `Bash ${oneLine(str(inp.command) ?? '', 70)}`
      break
    case 'Glob':
      summary = `Glob ${oneLine(str(inp.pattern) ?? path ?? '', 70)}`
      break
    case 'Grep':
      summary = `Grep ${oneLine(str(inp.pattern) ?? '', 50)}${path ? ` in ${path}` : ''}`
      break
    case 'Agent':
    case 'Task':
      summary = `Agent ${oneLine(str(inp.description) ?? '', 70)}`
      break
    default: {
      const target = raw && cwd ? (relativeToCwd(raw, cwd) ?? raw) : raw
      summary = target ? `${name} ${target}` : name
    }
  }
  return { path, summary }
}

function flattenText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (b && typeof b === 'object' && typeof (b as any).text === 'string' ? (b as any).text : ''))
    .join('\n')
}

/** Accumulated state of one transcript file (one agent). */
export class AgentAcc {
  sessionId: string
  /** null for the session's main agent. */
  agentId: string | null
  meta: AgentMeta = {}
  cwd?: string
  title?: string
  /** First real prompt, the label fallback for sessions without a title. */
  firstPrompt?: string
  model = ''
  startedAt = 0
  lastActivityAt = 0
  turns = 0
  lastStopReason: string | null | undefined
  /** Last assistant record ended its turn without a tool call. */
  finishedTurn = false
  messages = new Map<string, MessageAcc>()
  toolCalls: ToolCall[] = []
  /** Repo-relative path -> tool calls that targeted it (all calls, not capped). */
  pathCounts = new Map<string, number>()
  /** Session root, used to make paths repo-relative (the main agent's cwd). */
  rootCwd?: string
  /** Agent tool_use blocks this agent issued, by tool_use id. */
  spawns = new Map<string, SpawnInfo>()
  /** First timestamp per spawning assistant message. */
  messageAt = new Map<string, number>()
  /** tool_use id -> agentId reported by the tool_result of an Agent call. */
  spawnResultAgent = new Map<string, string>()
  /** tool_use id / agentId -> completion, learned from this agent's user records. */
  completions = new Map<string, Completion>()
  version = 0

  constructor(sessionId: string, agentId: string | null) {
    this.sessionId = sessionId
    this.agentId = agentId
  }

  /** Feed one raw JSONL line. Never throws. */
  ingestLine(line: string) {
    let rec: any
    try {
      rec = JSON.parse(line)
    } catch {
      return
    }
    try {
      this.ingest(rec)
    } catch {
      // ignore records we cannot understand
    }
  }

  ingest(rec: any) {
    if (!rec || typeof rec !== 'object') return
    this.version++
    if (rec.type === 'ai-title' && typeof rec.aiTitle === 'string') this.title = rec.aiTitle
    if (rec.type === 'agent-name' && typeof rec.agentName === 'string' && rec.agentName.trim()) this.title = rec.agentName
    if (rec.type === 'custom-title' && typeof rec.customTitle === 'string' && rec.customTitle.trim()) this.title = rec.customTitle
    if (typeof rec.cwd === 'string' && !this.cwd) this.cwd = rec.cwd
    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN
    if (Number.isFinite(ts)) {
      if (!this.startedAt || ts < this.startedAt) this.startedAt = ts
      if (rec.type === 'assistant' || rec.type === 'user') {
        if (ts > this.lastActivityAt) this.lastActivityAt = ts
      }
    }
    if (rec.type === 'queue-operation') {
      if (rec.operation === 'enqueue' && typeof rec.content === 'string') {
        this.ingestNotifications(rec.content, Number.isFinite(ts) ? ts : this.lastActivityAt)
      }
    } else if (rec.type === 'attachment' && rec.attachment?.type === 'queued_command') {
      const prompt = rec.attachment.prompt
      if (typeof prompt === 'string') this.ingestNotifications(prompt, Number.isFinite(ts) ? ts : this.lastActivityAt)
    }
    if (rec.type === 'assistant') this.ingestAssistant(rec, Number.isFinite(ts) ? ts : this.lastActivityAt)
    else if (rec.type === 'user') this.ingestUser(rec, Number.isFinite(ts) ? ts : this.lastActivityAt)
  }

  private ingestAssistant(rec: any, ts: number) {
    const msg = rec.message
    if (!msg || typeof msg !== 'object') return
    const msgKey: string = str(msg.id) ?? str(rec.requestId) ?? str(rec.uuid) ?? `t${ts}`
    const model = str(msg.model)
    const real = model && model !== '<synthetic>' ? model : undefined
    if (real) this.model = real
    // One API response may span several records with the same message id and usage:
    // keep one entry per id so tokens count once.
    if (msg.usage && typeof msg.usage === 'object' && real) {
      this.messages.set(msgKey, { model: real, usage: usageFromApi(msg.usage) })
    }
    const seenBefore = this.messageAt.has(msgKey)
    if (!seenBefore) {
      this.messageAt.set(msgKey, ts)
      this.turns++
    }
    const content = Array.isArray(msg.content) ? msg.content : []
    let hasTool = false
    for (const b of content) {
      if (!b || typeof b !== 'object' || b.type !== 'tool_use') continue
      hasTool = true
      const name = str(b.name) ?? 'tool'
      const id = str(b.id) ?? `${msgKey}:${this.toolCalls.length}`
      const { path, summary } = describeToolUse(name, b.input, this.rootCwd ?? this.cwd)
      if (path !== undefined) this.pathCounts.set(path, (this.pathCounts.get(path) ?? 0) + 1)
      const call: ToolCall = { id, name, at: ts, summary }
      if (path !== undefined) call.path = path
      this.toolCalls.push(call)
      if (this.toolCalls.length > MAX_TOOL_CALLS) this.toolCalls.splice(0, this.toolCalls.length - MAX_TOOL_CALLS)
      if (SPAWN_TOOLS.has(name)) {
        this.spawns.set(id, {
          toolUseId: id,
          messageKey: msgKey,
          at: this.messageAt.get(msgKey) ?? ts,
          description: str(b.input?.description),
          subagentType: str(b.input?.subagent_type),
        })
      }
    }
    this.lastStopReason = msg.stop_reason ?? this.lastStopReason
    // A record with a tool call, or a tool_use stop, means the agent is still working.
    this.finishedTurn = !hasTool && msg.stop_reason === 'end_turn'
  }

  private ingestUser(rec: any, ts: number) {
    const content = rec.message?.content
    if (this.firstPrompt === undefined && !rec.isMeta) {
      const text = flattenText(content).trim()
      if (text && !text.startsWith('<')) this.firstPrompt = oneLine(text, 60)
    }
    // A new user message after an end_turn means the agent resumed.
    this.finishedTurn = false
    if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== 'object' || b.type !== 'tool_result') continue
        const id = str(b.tool_use_id)
        if (!id) continue
        const r = rec.toolUseResult
        const launchedAsync = r && typeof r === 'object' && (r.isAsync === true || r.status === 'async_launched')
        const agentId = r && typeof r === 'object' ? str(r.agentId) : undefined
        if (agentId) this.spawnResultAgent.set(id, agentId)
        if (launchedAsync) continue
        // Final result for a spawn call (synchronous Agent).
        if (this.spawns.has(id) || agentId) {
          this.completions.set(id, { at: ts, status: b.is_error === true ? 'error' : 'done' })
        }
      }
    }
    this.ingestNotifications(flattenText(content), ts)
  }

  /**
   * Async completion: <task-notification><task-id>..</task-id><status>completed</status>...
   * Real transcripts carry these in queue-operation (enqueue) and attachment
   * (queued_command) records; user records are also accepted. Dedupe by task id:
   * the same text arrives several times, and an agent resumed later notifies again.
   */
  private ingestNotifications(text: string, ts: number) {
    if (!text.includes('<task-notification>')) return
    for (const m of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
      const body = m[1]
      const taskId = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(body)?.[1]
      const toolId = /<tool-use-id>\s*([^<\s]+)\s*<\/tool-use-id>/.exec(body)?.[1]
      const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(body)?.[1]?.toLowerCase()
      if (!status || status === 'running' || status === 'started') continue
      const c: Completion = {
        at: ts,
        status: status === 'completed' || status === 'done' || status === 'success' ? 'done' : 'error',
      }
      for (const key of [taskId, toolId]) {
        if (!key) continue
        const prev = this.completions.get(key)
        // Same notification logged twice (queue + attachment): keep the first time. A later one is a new completion.
        if (prev && prev.status === c.status && ts >= prev.at && ts - prev.at < 30_000) continue
        this.completions.set(key, c)
      }
    }
  }

  totalUsage(): TokenUsage {
    const u = emptyUsage()
    for (const m of this.messages.values()) addUsage(u, m.usage)
    return u
  }

  totalCost(): number {
    let c = 0
    for (const m of this.messages.values()) c += costOf(m.model, m.usage)
    return c
  }
}

export interface SessionInput {
  id: string
  main?: AgentAcc
  subs: AgentAcc[]
  /** Components for this session's cwd. */
  components: Component[]
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

/** Build the snapshot from accumulated state. `now` is injectable for tests. */
export function buildSnapshot(sessions: SessionInput[], now: number): SwarmSnapshot {
  const outSessions: Session[] = []
  const outAgents: Agent[] = []
  const outRounds: Round[] = []
  const componentMap = new Map<string, Component>()
  const totalsUsage = emptyUsage()
  let totalsCost = 0
  const byModel: Record<string, ModelTotals> = {}

  for (const s of sessions) {
    const main = s.main
    const all = [...(main ? [main] : []), ...s.subs]
    if (all.length === 0) continue
    const compIds = new Set(s.components.map((c) => c.id))
    const agentKey = (a: AgentAcc) => (a.agentId === null ? s.id : a.agentId)

    // Who spawned what: tool_use id -> spawner + info.
    const spawnIndex = new Map<string, { spawner: AgentAcc; info: SpawnInfo }>()
    for (const a of all) for (const [id, info] of a.spawns) spawnIndex.set(id, { spawner: a, info })
    // agentId -> tool_use id via tool_result fallback.
    const toolIdByAgent = new Map<string, string>()
    for (const a of all) for (const [toolId, agentId] of a.spawnResultAgent) toolIdByAgent.set(agentId, toolId)

    // Rounds: one per (spawner, assistant message) with at least one Agent tool_use.
    const roundDefs = new Map<string, { spawner: AgentAcc; messageKey: string; at: number; toolIds: string[] }>()
    for (const [toolId, { spawner, info }] of spawnIndex) {
      const key = `${agentKey(spawner)}|${info.messageKey}`
      let r = roundDefs.get(key)
      if (!r) roundDefs.set(key, (r = { spawner, messageKey: info.messageKey, at: info.at, toolIds: [] }))
      r.toolIds.push(toolId)
      if (info.at < r.at) r.at = info.at
    }
    const orderedRounds = [...roundDefs.values()].sort((a, b) => a.at - b.at)
    const roundByTool = new Map<string, string>()
    const roundObjs: Round[] = orderedRounds.map((r, i) => {
      const id = `${s.id}:r${i + 1}`
      for (const t of r.toolIds) roundByTool.set(t, id)
      return {
        id,
        sessionId: s.id,
        index: i + 1,
        startedAt: r.at,
        agentIds: [],
        usage: emptyUsage(),
        costUsd: 0,
      }
    })

    const sessionAgents: Agent[] = []
    for (const a of all) {
      const isMain = a.agentId === null
      const id = agentKey(a)
      let toolUseId = a.meta.toolUseId
      if (!isMain && (!toolUseId || !spawnIndex.has(toolUseId)) && a.agentId) {
        toolUseId = toolIdByAgent.get(a.agentId) ?? toolUseId
      }
      const link = toolUseId ? spawnIndex.get(toolUseId) : undefined
      const parentAcc = link?.spawner ?? (isMain ? undefined : main)
      const parentId = isMain ? null : parentAcc ? agentKey(parentAcc) : null

      let completion: Completion | undefined
      if (!isMain) {
        // Completion is reported to the spawner: by tool_use id, or by agent id.
        const sources = parentAcc ? [parentAcc] : all
        for (const p of sources) {
          // A resumed agent notifies again under the same task id but a different
          // tool-use id (the resuming call's), so take the newest of all matches.
          for (const key of [toolUseId, a.agentId]) {
            const c = key ? p.completions.get(key) : undefined
            if (c && (!completion || c.at > completion.at)) completion = c
          }
        }
      }
      const age = now - a.lastActivityAt
      let status: AgentStatus
      let endedAt: number | undefined
      if (isMain) {
        status = age < RUNNING_WINDOW_MS ? 'running' : 'idle'
      } else if (completion && a.lastActivityAt <= completion.at + RESUME_SLACK_MS) {
        status = completion.status
        endedAt = completion.at
      } else if (a.finishedTurn && age >= 3_000) {
        status = 'done'
        endedAt = a.lastActivityAt
      } else if (age >= DONE_QUIET_MS) {
        status = 'done'
        endedAt = a.lastActivityAt
      } else if (age < RUNNING_WINDOW_MS) {
        status = 'running'
      } else {
        status = 'idle'
      }

      const touched: Record<string, number> = {}
      for (const [p, n] of a.pathCounts) {
        const cid = componentForPath(p, compIds)
        if (cid) touched[cid] = (touched[cid] ?? 0) + n
      }
      const usage = a.totalUsage()
      const costUsd = a.totalCost()
      const description = a.meta.description ?? link?.info.description
      const last = a.toolCalls[a.toolCalls.length - 1]
      const agent: Agent = {
        id,
        sessionId: s.id,
        parentId,
        kind: isMain ? 'main' : 'subagent',
        label: isMain
          ? (a.title ?? a.firstPrompt ?? 'Main')
          : (description ?? link?.info.subagentType ?? a.meta.agentType ?? `agent-${shortId(a.agentId ?? '')}`),
        description,
        model: a.model || a.meta.model || 'unknown',
        status,
        roundId: !isMain && toolUseId ? (roundByTool.get(toolUseId) ?? null) : null,
        startedAt: a.startedAt,
        lastActivityAt: a.lastActivityAt,
        endedAt,
        turns: a.turns,
        usage,
        costUsd,
        toolCalls: a.toolCalls.map((c) => {
          const componentId = c.path !== undefined ? componentForPath(c.path, compIds) : undefined
          return componentId ? { ...c, componentId } : { ...c }
        }),
        touched,
        currentActivity: status === 'running' ? (last?.summary ?? (a.finishedTurn ? undefined : 'thinking')) : last?.summary,
      }
      sessionAgents.push(agent)

      addUsage(totalsUsage, usage)
      totalsCost += costUsd
      // Totals by the model each message was billed under.
      for (const m of a.messages.values()) {
        const t = (byModel[m.model] ??= { usage: emptyUsage(), costUsd: 0 })
        addUsage(t.usage, m.usage)
        t.costUsd += costOf(m.model, m.usage)
      }
    }

    // Fill rounds from agents.
    const roundById = new Map(roundObjs.map((r) => [r.id, r]))
    for (const ag of sessionAgents) {
      const r = ag.roundId ? roundById.get(ag.roundId) : undefined
      if (!r) continue
      r.agentIds.push(ag.id)
      addUsage(r.usage, ag.usage)
      r.costUsd += ag.costUsd
    }
    for (const r of roundObjs) {
      const members = sessionAgents.filter((a) => a.roundId === r.id)
      if (members.length && members.every((m) => m.status === 'done' || m.status === 'error')) {
        r.endedAt = Math.max(...members.map((m) => m.endedAt ?? m.lastActivityAt))
      }
    }

    for (const c of s.components) {
      const prev = componentMap.get(c.id)
      if (!prev || c.fileCount > prev.fileCount) componentMap.set(c.id, c)
    }

    outAgents.push(...sessionAgents)
    outRounds.push(...roundObjs)
    outSessions.push({
      id: s.id,
      cwd: main?.cwd ?? all.find((a) => a.cwd)?.cwd ?? '',
      title: main?.title,
      startedAt: Math.min(...all.map((a) => a.startedAt || Infinity)),
      lastActivityAt: Math.max(...all.map((a) => a.lastActivityAt)),
      agentIds: sessionAgents.map((a) => a.id),
    })
  }

  outSessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  return {
    generatedAt: now,
    sessions: outSessions,
    agents: outAgents,
    rounds: outRounds,
    components: [...componentMap.values()],
    totals: { usage: totalsUsage, costUsd: totalsCost, byModel },
    pricingNote,
  }
}
