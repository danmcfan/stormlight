// Pure selection/grouping for the Lead "what is it doing right now" feed.
// The lead agent runs as a normal Claude Code session: find the main agent for
// that session, read its tool calls and the subagents it launched, and shape
// them for display. No DOM, no signals — Activity.tsx just renders this.
import type { Agent, AgentStatus, SwarmSnapshot, ToolCall } from '../../lib/types'

/** Consecutive calls of the same tool, collapsed to one row ("Read ×4"). */
export interface ToolCallGroup {
  name: string
  /** How many consecutive calls this row stands for. */
  count: number
  /** The most recent call's summary in the group. */
  summary: string
  /** The most recent call's id in the group (React/Solid key). */
  id: string
  /** The most recent call's time, epoch ms. */
  at: number
}

export interface ActivitySubagent {
  id: string
  label: string
  description?: string
  model: string
  status: AgentStatus
  currentActivity?: string
}

export interface ActivitySelection {
  /** The lead's own agent record, or null when none matches. */
  lead: Agent | null
  /** Grouped tool calls in the window, oldest first, capped to the most recent MAX_CALLS. */
  calls: ToolCallGroup[]
  /** Count of calls in the window older than the cap, omitted from `calls`. */
  earlierCount: number
  /** Subagents the lead launched in the window, oldest first. */
  subagents: ActivitySubagent[]
}

/** Individual tool calls kept in the window before grouping. */
export const MAX_CALLS = 40

const EMPTY: ActivitySelection = { lead: null, calls: [], earlierCount: 0, subagents: [] }

function inWindow(at: number, from: number, to: number | undefined): boolean {
  return at >= from && (to === undefined || at <= to)
}

function groupConsecutive(calls: ToolCall[]): ToolCallGroup[] {
  const out: ToolCallGroup[] = []
  for (const c of calls) {
    const last = out[out.length - 1]
    if (last && last.name === c.name) {
      last.count += 1
      last.summary = c.summary
      last.id = c.id
      last.at = c.at
    } else {
      out.push({ name: c.name, count: 1, summary: c.summary, id: c.id, at: c.at })
    }
  }
  return out
}

/** Total individual tool calls a selection stands for, including the capped-off "earlier" ones. */
export function totalCalls(sel: ActivitySelection): number {
  return sel.earlierCount + sel.calls.reduce((n, g) => n + g.count, 0)
}

/**
 * Selects the lead's activity in [from, to] (to undefined means "still open").
 * Returns the empty selection when there is no snapshot, no sessionId, or no
 * main agent for that session.
 */
export function selectActivity(
  snapshot: SwarmSnapshot | undefined,
  sessionId: string | null | undefined,
  from: number,
  to: number | undefined,
): ActivitySelection {
  if (!snapshot || !sessionId) return EMPTY
  const lead = snapshot.agents.find((a) => a.kind === 'main' && a.sessionId === sessionId)
  if (!lead) return EMPTY

  const callsInWindow = lead.toolCalls
    .filter((c) => inWindow(c.at, from, to))
    .sort((a, b) => a.at - b.at)
  const earlierCount = Math.max(0, callsInWindow.length - MAX_CALLS)
  const kept = callsInWindow.slice(Math.max(0, callsInWindow.length - MAX_CALLS))
  const calls = groupConsecutive(kept)

  const subagents = snapshot.agents
    .filter((a) => a.parentId === lead.id && inWindow(a.startedAt, from, to))
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description,
      model: a.model,
      status: a.status,
      currentActivity: a.currentActivity,
    }))

  return { lead, calls, earlierCount, subagents }
}
