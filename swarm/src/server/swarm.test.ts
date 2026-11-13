import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { costOf, emptyUsage, lookupPrice } from '../lib/pricing'
import { componentForPath, relativeToCwd, scanComponents } from './components'
import { AgentAcc, buildSnapshot, splitLines, type SessionInput } from './parse'
import { SwarmStore } from './store'

const T0 = Date.parse('2026-01-01T00:00:00Z')
const iso = (s: number) => new Date(T0 + s * 1000).toISOString()

function asst(opts: {
  msgId: string
  at: number
  model?: string
  usage?: any
  tools?: { id: string; name: string; input: any }[]
  stop?: string
}) {
  return JSON.stringify({
    type: 'assistant',
    uuid: `u-${opts.msgId}-${opts.tools?.[0]?.id ?? 'x'}`,
    timestamp: iso(opts.at),
    cwd: '/repo',
    message: {
      id: opts.msgId,
      model: opts.model ?? 'claude-sonnet-5-5',
      stop_reason: opts.stop ?? (opts.tools?.length ? 'tool_use' : 'end_turn'),
      usage: opts.usage ?? { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 40, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 10 } },
      content: (opts.tools ?? []).map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input })),
    },
  })
}
const spawn = (id: string, desc: string) => ({ id, name: 'Agent', input: { description: desc, prompt: 'x', model: 'sonnet' } })

describe('pricing', () => {
  it('prices each token class and falls back by family', () => {
    const u = { ...emptyUsage(), input: 1_000_000, output: 1_000_000 }
    expect(costOf('claude-sonnet-5-5', u)).toBeCloseTo(12, 5)
    expect(lookupPrice('claude-sonnet-9-9').price).not.toBeNull()
    expect(lookupPrice('claude-sonnet-9-9').approximate).toBe(true)
    expect(costOf('mystery-model', u)).toBe(0)
    expect(lookupPrice('mystery-model').approximate).toBe(true)
  })
  it('bills cache writes above input and reads below it', () => {
    const p = lookupPrice('claude-opus-5-5').price!
    expect(p.cacheWrite5m).toBeGreaterThan(p.input)
    expect(p.cacheWrite1h).toBeGreaterThan(p.cacheWrite5m)
    expect(p.cacheRead).toBeLessThan(p.input)
  })
})

describe('line splitting', () => {
  it('holds back an unterminated last line until it completes', () => {
    const a = splitLines(Buffer.alloc(0), Buffer.from('{"a":1}\n{"b"'))
    expect(a.lines).toEqual(['{"a":1}'])
    const b = splitLines(a.rest, Buffer.from(':2}\n'))
    expect(b.lines).toEqual(['{"b":2}'])
    expect(b.rest.length).toBe(0)
  })
  it('does not break multibyte characters across chunks', () => {
    const bytes = Buffer.from('{"t":"é"}\n')
    const a = splitLines(Buffer.alloc(0), bytes.subarray(0, 7))
    const b = splitLines(a.rest, bytes.subarray(7))
    expect(b.lines).toEqual(['{"t":"é"}'])
  })
})

describe('AgentAcc', () => {
  it('counts usage once per message id even when split across records', () => {
    const a = new AgentAcc('s', null)
    a.ingestLine(asst({ msgId: 'm1', at: 1, tools: [{ id: 't1', name: 'Read', input: { file_path: '/repo/src/a.ts' } }] }))
    a.ingestLine(asst({ msgId: 'm1', at: 1, tools: [{ id: 't2', name: 'Read', input: { file_path: '/repo/src/b.ts' } }] }))
    a.ingestLine(asst({ msgId: 'm2', at: 2 }))
    expect(a.turns).toBe(2)
    const u = a.totalUsage()
    expect(u.input).toBe(20)
    expect(u.output).toBe(10)
    expect(u.cacheWrite5m).toBe(60)
    expect(u.cacheWrite1h).toBe(20)
    expect(a.toolCalls).toHaveLength(2)
  })
  it('ignores malformed and unknown lines', () => {
    const a = new AgentAcc('s', null)
    for (const l of ['', 'not json', '{"type":"mystery"}', '[]', 'null', '{"type":"assistant"}']) a.ingestLine(l)
    expect(a.turns).toBe(0)
  })
  it('caps tool calls at 200 but keeps counting touches', () => {
    const a = new AgentAcc('s', null)
    a.rootCwd = '/repo'
    for (let i = 0; i < 230; i++) {
      a.ingestLine(asst({ msgId: `m${i}`, at: i, tools: [{ id: `t${i}`, name: 'Edit', input: { file_path: '/repo/src/x.ts' } }] }))
    }
    expect(a.toolCalls).toHaveLength(200)
    expect(a.pathCounts.get('src/x.ts')).toBe(230)
  })
})

describe('paths and components', () => {
  it('makes paths repo-relative and rejects outside paths', () => {
    expect(relativeToCwd('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
    expect(relativeToCwd('src/a.ts', '/repo')).toBe('src/a.ts')
    expect(relativeToCwd('/elsewhere/a.ts', '/repo')).toBeUndefined()
    expect(relativeToCwd('../a.ts', '/repo')).toBeUndefined()
  })
  it('maps a path to the deepest containing component', () => {
    const ids = new Set(['.', 'src', 'src/combat', 'docs'])
    expect(componentForPath('src/combat/moves.ts', ids)).toBe('src/combat')
    expect(componentForPath('src/combat/deep/er/x.ts', ids)).toBe('src/combat')
    expect(componentForPath('src/other.ts', ids)).toBe('src')
    expect(componentForPath('README.md', ids)).toBe('.')
    expect(componentForPath('docs', ids)).toBe('docs')
  })
  it('scans directories to depth 3 and skips noise', () => {
    const d = mkdtempSync(join(tmpdir(), 'swarm-comp-'))
    for (const p of ['a/b/c/d', 'node_modules/x', '.git/y', 'dist/z']) mkdirSync(join(d, p), { recursive: true })
    writeFileSync(join(d, 'a/b/c/d/f.ts'), '')
    writeFileSync(join(d, 'a/one.ts'), '')
    writeFileSync(join(d, 'top.ts'), '')
    const ids = scanComponents(d).map((c) => c.id).sort()
    expect(ids).toEqual(['.', 'a', 'a/b', 'a/b/c'])
    const a = scanComponents(d).find((c) => c.id === 'a')!
    expect(a.fileCount).toBe(2)
    expect(a.parentId).toBe('.')
  })
})

describe('snapshot building', () => {
  const comps = [
    { id: '.', label: 'repo', parentId: null, fileCount: 3 },
    { id: 'src', label: 'src', parentId: '.', fileCount: 2 },
  ]
  function fixture() {
    const main = new AgentAcc('s1', null)
    main.ingestLine(asst({ msgId: 'p1', at: 0, model: 'claude-opus-5-5', tools: [spawn('tu1', 'first'), spawn('tu2', 'second')] }))
    main.ingestLine(asst({ msgId: 'p1', at: 0, model: 'claude-opus-5-5', tools: [spawn('tu2', 'second')] }))
    main.ingestLine(asst({ msgId: 'p2', at: 100, model: 'claude-opus-5-5', tools: [spawn('tu3', 'third')] }))
    const mk = (id: string, toolUseId: string, desc: string) => {
      const a = new AgentAcc('s1', id)
      a.meta = { description: desc, toolUseId }
      a.ingestLine(asst({ msgId: `${id}-1`, at: 5, tools: [{ id: `r-${id}`, name: 'Edit', input: { file_path: '/repo/src/x.ts' } }] }))
      a.ingestLine(asst({ msgId: `${id}-2`, at: 50 }))
      return a
    }
    return { main, subs: [mk('aaa', 'tu1', 'first'), mk('bbb', 'tu2', 'second'), mk('ccc', 'tu3', 'third')] }
  }
  const input = (f: ReturnType<typeof fixture>): SessionInput[] => [{ id: 's1', main: f.main, subs: f.subs, components: comps }]

  it('groups spawning messages into rounds and links subagents via the meta tool_use id', () => {
    const f = fixture()
    const snap = buildSnapshot(input(f), T0 + 120_000)
    expect(snap.rounds.map((r) => r.index)).toEqual([1, 2])
    expect(snap.rounds[0].agentIds.sort()).toEqual(['aaa', 'bbb'])
    expect(snap.rounds[1].agentIds).toEqual(['ccc'])
    const a = snap.agents.find((x) => x.id === 'aaa')!
    expect(a.parentId).toBe('s1')
    expect(a.roundId).toBe(snap.rounds[0].id)
    expect(a.label).toBe('first')
    expect(snap.agents.find((x) => x.id === 's1')!.kind).toBe('main')
  })
  it('falls back to the tool_result agentId when there is no meta file', () => {
    const f = fixture()
    f.subs[0].meta = {}
    f.main.ingest({
      type: 'user',
      timestamp: iso(1),
      toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'aaa' },
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
    })
    const snap = buildSnapshot(input(f), T0 + 120_000)
    expect(snap.agents.find((x) => x.id === 'aaa')!.roundId).toBe(snap.rounds[0].id)
  })
  it('maps tool calls to components and sums totals by model', () => {
    const f = fixture()
    const snap = buildSnapshot(input(f), T0 + 120_000)
    const a = snap.agents.find((x) => x.id === 'aaa')!
    expect(a.toolCalls[0].componentId).toBe('src')
    expect(a.touched).toEqual({ src: 1 })
    expect(Object.keys(snap.totals.byModel).sort()).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
    const sum = snap.agents.reduce((n, x) => n + x.costUsd, 0)
    expect(snap.totals.costUsd).toBeCloseTo(sum, 10)
  })
  it('derives status from activity and completion', () => {
    const f = fixture()
    // Recent record, work not finished -> running.
    f.subs[0].ingestLine(asst({ msgId: 'aaa-3', at: 118, tools: [{ id: 'z', name: 'Bash', input: { command: 'ls' } }] }))
    // bbb told its parent it finished (async notification).
    f.main.ingest({
      type: 'user',
      timestamp: iso(119),
      message: { content: '<task-notification><task-id>bbb</task-id><status>completed</status></task-notification>' },
    })
    // ccc failed.
    f.main.ingest({
      type: 'user',
      timestamp: iso(119),
      message: { content: '<task-notification><task-id>ccc</task-id><status>failed</status></task-notification>' },
    })
    const snap = buildSnapshot(input(f), T0 + 120_000)
    const by = (id: string) => snap.agents.find((x) => x.id === id)!
    expect(by('aaa').status).toBe('running')
    expect(by('bbb').endedAt).toBe(T0 + 119_000)
    expect(by('bbb').status).toBe('done')
    expect(by('ccc').status).toBe('error')
    expect(by('s1').status).toBe('running')
    expect(buildSnapshot(input(f), T0 + 120_000 + 60_000).agents.find((x) => x.id === 's1')!.status).toBe('idle')
    expect(buildSnapshot(input(f), T0 + 120_000 + 20 * 60_000).agents.find((x) => x.id === 'aaa')!.status).toBe('done')
  })
})

describe('task-notification completions (real record shapes)', () => {
  const note = (id: string, tool: string, status: string) =>
    `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>${tool}</tool-use-id>\n<status>${status}</status>\n<summary>x</summary>\n</task-notification>`
  it('marks a subagent done from queue-operation and queued_command records, deduped', () => {
    const main = new AgentAcc('s1', null)
    main.ingestLine(asst({ msgId: 'p1', at: 0, tools: [spawn('tu1', 'one'), spawn('tu2', 'two')] }))
    main.ingestLine(JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(60), sessionId: 's1', content: note('aaa', 'tu1', 'completed') }))
    main.ingestLine(JSON.stringify({ type: 'attachment', timestamp: iso(60), attachment: { type: 'queued_command', prompt: note('aaa', 'tu1', 'completed') } }))
    main.ingestLine(JSON.stringify({ type: 'queue-operation', operation: 'remove', timestamp: iso(80), sessionId: 's1', content: note('aaa', 'tu1', 'completed') }))
    main.ingestLine(JSON.stringify({ type: 'attachment', timestamp: iso(70), attachment: { type: 'queued_command', prompt: note('bbb', 'tu2', 'failed') } }))
    const mk = (id: string, tu: string) => {
      const a = new AgentAcc('s1', id)
      a.meta = { toolUseId: tu }
      a.ingestLine(asst({ msgId: `${id}1`, at: 59, tools: [{ id: `x${id}`, name: 'Bash', input: { command: 'ls' } }] }))
      return a
    }
    const snap = buildSnapshot([{ id: 's1', main, subs: [mk('aaa', 'tu1'), mk('bbb', 'tu2')], components: [] }], T0 + 61_000)
    const a = snap.agents.find((x) => x.id === 'aaa')!
    expect(a.status).toBe('done')
    expect(a.endedAt).toBe(T0 + 60_000)
    expect(snap.agents.find((x) => x.id === 'bbb')!.status).toBe('error')
  })
})

describe('store (incremental reading)', () => {
  it('reads appended bytes only and handles a partial last line', () => {
    const root = mkdtempSync(join(tmpdir(), 'swarm-root-'))
    const proj = join(root, 'proj')
    mkdirSync(join(proj, 'sess1', 'subagents'), { recursive: true })
    const file = join(proj, 'sess1.jsonl')
    const line1 = asst({ msgId: 'm1', at: 1 })
    const line2 = asst({ msgId: 'm2', at: 2 })
    writeFileSync(file, line1 + '\n' + line2.slice(0, 40))
    const store = new SwarmStore(root)
    store.refresh(true)
    expect(store.getSnapshot().agents[0].turns).toBe(1)
    appendFileSync(file, line2.slice(40) + '\n')
    store.refresh(true)
    expect(store.getSnapshot().agents[0].turns).toBe(2)
    expect(store.getSnapshot().agents[0].usage.input).toBe(20)
    store.refresh(true)
    expect(store.getSnapshot().agents[0].usage.input).toBe(20)
    store.stop()
  })
  it('links a subagent file to its spawning tool_use through the meta file', () => {
    const root = mkdtempSync(join(tmpdir(), 'swarm-root-'))
    const proj = join(root, 'proj')
    const sdir = join(proj, 'sess1', 'subagents')
    mkdirSync(sdir, { recursive: true })
    writeFileSync(join(proj, 'sess1.jsonl'), asst({ msgId: 'p', at: 1, tools: [spawn('toolu_X', 'do it')] }) + '\n')
    writeFileSync(join(sdir, 'agent-abc123.jsonl'), asst({ msgId: 's', at: 2 }) + '\n')
    writeFileSync(join(sdir, 'agent-abc123.meta.json'), JSON.stringify({ description: 'do it', toolUseId: 'toolu_X' }))
    const store = new SwarmStore(root)
    store.refresh(true)
    const snap = store.getSnapshot()
    const sub = snap.agents.find((a) => a.kind === 'subagent')!
    expect(sub.parentId).toBe('sess1')
    expect(sub.roundId).toBe('sess1:r1')
    store.stop()
  })
})
