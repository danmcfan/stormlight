import { describe, expect, it } from 'vitest'
import { imagesOf, parseTranscript } from './transcript'

const line = (o: object) => JSON.stringify(o)
const at = '2026-11-13T07:00:00.000Z'
const png = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }

describe('parseTranscript', () => {
  it('turns a brief, a reply, a tool call and its result into events in order', () => {
    const t = parseTranscript([
      line({ type: 'user', uuid: 'u1', timestamp: at, message: { content: 'Fix the header' } }),
      line({
        type: 'assistant',
        uuid: 'a1',
        timestamp: at,
        message: { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'On it.' }] },
      }),
      line({
        type: 'assistant',
        uuid: 'a2',
        timestamp: at,
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }] },
      }),
      line({
        type: 'user',
        uuid: 'u2',
        timestamp: '2026-11-13T07:00:02.000Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }] },
      }),
    ])
    expect(t.model).toBe('claude-sonnet-5-5')
    expect(t.events.map((e) => e.kind)).toEqual(['user', 'text', 'tool'])
    const tool = t.events[2]
    expect(tool.kind === 'tool' && tool.summary).toBe('Run tests')
    expect(tool.kind === 'tool' && tool.result).toMatchObject({ text: 'ok', isError: false })
    expect(tool.kind === 'tool' && tool.result!.at - tool.at).toBe(2000)
  })

  it('links an Agent call to the subagent it spawned', () => {
    const t = parseTranscript([
      line({ type: 'assistant', uuid: 'a1', timestamp: at, message: { content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { description: 'Audit' } }] } }),
      line({
        type: 'user',
        uuid: 'u1',
        timestamp: at,
        toolUseResult: { agentId: 'abc123' },
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'done' }] }] },
      }),
    ])
    const tool = t.events[0]
    expect(tool.kind === 'tool' && tool.agentId).toBe('abc123')
  })

  it('references images in prompts and tool results by record and index, never inlining the data', () => {
    const t = parseTranscript([
      line({ type: 'user', uuid: 'u1', timestamp: at, message: { content: [png, { type: 'text', text: 'Look' }] } }),
      line({ type: 'assistant', uuid: 'a1', timestamp: at, message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x.png' } }] } }),
      line({ type: 'user', uuid: 'u2', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [png, png] }] } }),
    ])
    const prompt = t.events[0]
    expect(prompt.kind === 'user' && prompt.images).toEqual([{ uuid: 'u1', index: 0, mediaType: 'image/png' }])
    const tool = t.events[1]
    expect(tool.kind === 'tool' && tool.result!.images.map((i) => i.index)).toEqual([0, 1])
    expect(JSON.stringify(t)).not.toContain('AAAA')
  })

  it('drops empty thinking, meta records and other record types', () => {
    const t = parseTranscript([
      line({ type: 'assistant', uuid: 'a1', timestamp: at, message: { content: [{ type: 'thinking', thinking: '' }] } }),
      line({ type: 'assistant', uuid: 'a2', timestamp: at, message: { content: [{ type: 'thinking', thinking: 'Plan: read first' }] } }),
      line({ type: 'user', uuid: 'u1', isMeta: true, timestamp: at, message: { content: 'hidden' } }),
      line({ type: 'system', uuid: 's1', timestamp: at }),
      'not json',
    ])
    expect(t.events).toEqual([{ kind: 'thinking', id: 'a2:0', at: Date.parse(at), text: 'Plan: read first' }])
  })

  it('labels task notifications and commands apart from real prompts', () => {
    const t = parseTranscript([
      line({ type: 'user', uuid: 'u1', timestamp: at, message: { content: '<task-notification>\n<task-id>x</task-id>' } }),
      line({ type: 'user', uuid: 'u2', timestamp: at, message: { content: '<command-name>/clear</command-name>' } }),
    ])
    expect(t.events.map((e) => e.kind === 'user' && e.origin)).toEqual(['notification', 'command'])
  })
})

describe('imagesOf', () => {
  it('finds images in message content and inside tool results, in document order', () => {
    const rec = { message: { content: [png, { type: 'tool_result', content: [{ ...png, source: { ...png.source, data: 'BBBB' } }] }] } }
    expect(imagesOf(rec).map((i) => i.data)).toEqual(['AAAA', 'BBBB'])
  })
})
