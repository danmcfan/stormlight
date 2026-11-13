// Temporary development data; the pages read useSwarm().
import type { Agent, SwarmSnapshot, TokenUsage, ToolCall } from '../../lib/types'

const now = Date.now()
const min = 60_000
const zero: TokenUsage = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }
const comps = ['src/combat', 'src/render', 'src/world', 'docs', 'swarm/src/lib']
const tools = ['Read', 'Edit', 'Grep', 'Bash', 'Glob']

function calls(seed: number, n: number, end: number): ToolCall[] {
  return Array.from({ length: n }, (_, i) => {
    const comp = comps[(seed + i) % comps.length]
    const name = tools[(seed * 3 + i) % tools.length]
    const path = `${comp}/file${(seed + i) % 7}.ts`
    return {
      id: `c${seed}-${i}`,
      name,
      at: end - (n - i) * 9000,
      path,
      componentId: comp,
      summary: name === 'Bash' ? 'Bash npm test' : `${name} ${path}`,
    }
  })
}

function sub(i: number, round: number, status: Agent['status'], model: string): Agent {
  const started = now - (round === 1 ? 14 : 6) * min + i * 4000
  const ended = status === 'done' ? started + (3 + i) * min : undefined
  const last = ended ?? now - (status === 'running' ? 3000 : 120000)
  const tc = calls(i + round * 5, 24 + i * 6, last)
  const touched: Record<string, number> = {}
  for (const c of tc) if (c.componentId) touched[c.componentId] = (touched[c.componentId] ?? 0) + 1
  const usage: TokenUsage = {
    input: 1200 + i * 300,
    output: 18_000 + i * 4200 + round * 3000,
    cacheWrite5m: 40_000 + i * 9000,
    cacheWrite1h: 0,
    cacheRead: 900_000 + i * 210_000,
  }
  return {
    id: `s1-r${round}-${i}`,
    sessionId: 's1',
    parentId: 'main',
    kind: 'subagent',
    label: `${round === 1 ? 'explore' : 'build'}-${['combat', 'render', 'world'][i]}`,
    description: `${round === 1 ? 'Survey' : 'Implement changes in'} the ${['combat', 'render', 'world'][i]} module and report back.`,
    model,
    status,
    roundId: `r${round}`,
    startedAt: started,
    lastActivityAt: last,
    endedAt: ended,
    turns: 12 + i * 5,
    usage,
    costUsd: 0.18 + i * 0.07 + round * 0.1,
    toolCalls: tc,
    touched,
    currentActivity: status === 'running' ? tc[tc.length - 1].summary : undefined,
  }
}

const statuses: Agent['status'][][] = [
  ['done', 'done', 'error'],
  ['running', 'running', 'idle'],
]
const subs = [1, 2].flatMap((r) =>
  [0, 1, 2].map((i) => sub(i, r, statuses[r - 1][i], r === 1 ? 'claude-sonnet-5-5' : 'claude-sonnet-5-5')),
)

const mainCalls = calls(2, 60, now - 2000)
const main: Agent = {
  id: 'main',
  sessionId: 's1',
  parentId: null,
  kind: 'main',
  label: 'main',
  description: 'Coordinates the swarm: plans work and launches subagents.',
  model: 'claude-opus-5',
  status: 'running',
  roundId: null,
  startedAt: now - 20 * min,
  lastActivityAt: now - 2000,
  turns: 64,
  usage: { input: 8000, output: 92_000, cacheWrite5m: 310_000, cacheWrite1h: 60_000, cacheRead: 6_400_000 },
  costUsd: 7.42,
  toolCalls: mainCalls,
  touched: { 'src/combat': 12, 'src/render': 7, docs: 21, 'swarm/src/lib': 9 },
  currentActivity: mainCalls[mainCalls.length - 1].summary,
}

const agents = [main, ...subs]
const sum = (list: Agent[]): TokenUsage =>
  list.reduce(
    (a, x) => ({
      input: a.input + x.usage.input,
      output: a.output + x.usage.output,
      cacheWrite5m: a.cacheWrite5m + x.usage.cacheWrite5m,
      cacheWrite1h: a.cacheWrite1h + x.usage.cacheWrite1h,
      cacheRead: a.cacheRead + x.usage.cacheRead,
    }),
    { ...zero },
  )
const cost = (list: Agent[]) => list.reduce((a, x) => a + x.costUsd, 0)
const r1 = subs.filter((a) => a.roundId === 'r1')
const r2 = subs.filter((a) => a.roundId === 'r2')

export const fixture: SwarmSnapshot = {
  generatedAt: now,
  sessions: [
    { id: 's1', cwd: '/home/user/stormlight', title: 'Add swarm dashboard', startedAt: main.startedAt, lastActivityAt: now, agentIds: agents.map((a) => a.id) },
  ],
  agents,
  rounds: [
    { id: 'r1', sessionId: 's1', index: 1, startedAt: r1[0].startedAt, endedAt: now - 6 * min, agentIds: r1.map((a) => a.id), usage: sum(r1), costUsd: cost(r1) },
    { id: 'r2', sessionId: 's1', index: 2, startedAt: r2[0].startedAt, agentIds: r2.map((a) => a.id), usage: sum(r2), costUsd: cost(r2) },
  ],
  components: comps.map((c) => ({ id: c, label: c.split('/').pop()!, parentId: null, fileCount: 10 })),
  totals: {
    usage: sum(agents),
    costUsd: cost(agents),
    byModel: {
      'claude-opus-5': { usage: sum([main]), costUsd: main.costUsd },
      'claude-sonnet-5-5': { usage: sum(subs), costUsd: cost(subs) },
    },
  },
  pricingNote: 'Estimated from Anthropic list prices; subscription plans are not billed per token.',
}
