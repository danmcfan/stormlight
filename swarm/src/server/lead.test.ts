import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  allowedModels,
  augmentPrompt,
  extensionForType,
  isAllowedModel,
  isValidUploadId,
  Lead,
  loadUpload,
  parseResult,
  saveUpload,
  type LeadImage,
} from './lead'

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) prev[k] = process.env[k]
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    fn()
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('allowedModels / isAllowedModel', () => {
  it('defaults to opus, sonnet, haiku', () => {
    withEnv({ SWARM_LEAD_MODELS: undefined }, () => {
      expect(allowedModels()).toEqual(['opus', 'sonnet', 'haiku'])
    })
  })

  it('reads a comma-separated override, trimming entries', () => {
    withEnv({ SWARM_LEAD_MODELS: 'opus, sonnet , custom-model' }, () => {
      expect(allowedModels()).toEqual(['opus', 'sonnet', 'custom-model'])
    })
  })

  it('accepts models in the allowed list and rejects everything else', () => {
    const allowed = ['opus', 'sonnet', 'haiku']
    expect(isAllowedModel('sonnet', allowed)).toBe(true)
    expect(isAllowedModel('opus', allowed)).toBe(true)
    expect(isAllowedModel('gpt-5', allowed)).toBe(false)
    expect(isAllowedModel('', allowed)).toBe(false)
    expect(isAllowedModel(undefined, allowed)).toBe(false)
    expect(isAllowedModel(42, allowed)).toBe(false)
  })
})

describe('isValidUploadId', () => {
  it('accepts the id/extension shape saveUpload generates', () => {
    for (const id of ['abcd1234.png', '0123456789abcdef.jpeg', 'aaaaaaaa.gif', 'ffffffffffffffff.webp'])
      expect(isValidUploadId(id)).toBe(true)
  })

  it('rejects short ids, bad extensions, non-strings, and path traversal', () => {
    for (const id of [
      'short.png',
      'abcd123.png', // 7 chars, one short of the minimum
      'ABCD1234.png', // uppercase
      'abcd1234.exe', // disallowed extension
      'abcd1234', // no extension at all
      '../abcd1234.png',
      '../../etc/passwd',
      'abcd1234.png/../../etc/passwd',
      'abcd1234.png/../secret',
      '',
      undefined,
      42,
    ])
      expect(isValidUploadId(id)).toBe(false)
  })
})

describe('extensionForType', () => {
  it('maps the allowed image types', () => {
    expect(extensionForType('image/png')).toBe('png')
    expect(extensionForType('image/jpeg')).toBe('jpg')
    expect(extensionForType('image/webp')).toBe('webp')
    expect(extensionForType('image/gif')).toBe('gif')
  })

  it('rejects anything else', () => {
    expect(extensionForType('image/svg+xml')).toBeUndefined()
    expect(extensionForType('text/html')).toBeUndefined()
    expect(extensionForType(undefined)).toBeUndefined()
  })
})

describe('saveUpload / loadUpload', () => {
  beforeEach(() => {
    process.env.SWARM_LEAD_UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'lead-uploads-'))
  })
  afterEach(() => {
    delete process.env.SWARM_LEAD_UPLOAD_DIR
  })

  it('writes an upload and reads it back with its name and content type', () => {
    const saved = saveUpload('screenshot.png', 'image/png', Buffer.from('hello'))
    expect(saved.id).toMatch(/^[a-z0-9]{8,}\.png$/)
    expect(saved.url).toBe(`/api/lead/upload?id=${saved.id}`)
    expect(saved.name).toBe('screenshot.png')

    const loaded = loadUpload(saved.id)
    expect(loaded?.name).toBe('screenshot.png')
    expect(loaded?.type).toBe('image/png')
  })

  it('rejects an unsupported type, empty data, and oversized data', () => {
    expect(() => saveUpload('x', 'text/html', Buffer.from('a'))).toThrow()
    expect(() => saveUpload('x', 'image/png', Buffer.alloc(0))).toThrow()
    expect(() => saveUpload('x', 'image/png', Buffer.alloc(10 * 1024 * 1024 + 1))).toThrow()
  })

  it('never joins an invalid id into a path: traversal and unknown ids both come back undefined', () => {
    expect(loadUpload('../etc/passwd')).toBeUndefined()
    expect(loadUpload('not-an-id')).toBeUndefined()
    expect(loadUpload('deadbeef.png')).toBeUndefined() // well-shaped, but never saved
  })
})

describe('augmentPrompt', () => {
  it('returns the prompt unchanged without images', () => {
    expect(augmentPrompt('fix the bug', undefined, '/uploads')).toBe('fix the bug')
    expect(augmentPrompt('fix the bug', [], '/uploads')).toBe('fix the bug')
  })

  it('prepends one line per image with its absolute path and name, then a blank line, then the prompt', () => {
    const images: LeadImage[] = [
      { id: 'abc12345.png', url: '/api/lead/upload?id=abc12345.png', name: 'screenshot.png' },
      { id: 'def67890.jpg', url: '/api/lead/upload?id=def67890.jpg', name: 'photo.jpg' },
    ]
    const out = augmentPrompt('what is wrong here?', images, '/home/agent/.claude/swarm/uploads')
    expect(out).toBe(
      '[Attached image: /home/agent/.claude/swarm/uploads/abc12345.png (screenshot.png)]\n' +
        '[Attached image: /home/agent/.claude/swarm/uploads/def67890.jpg (photo.jpg)]\n\n' +
        'what is wrong here?',
    )
  })
})

describe('Lead model changes', () => {
  beforeEach(() => {
    process.env.SWARM_LEAD_STATE_FILE = join(mkdtempSync(join(tmpdir(), 'lead-state-')), 'lead.json')
  })
  afterEach(() => {
    delete process.env.SWARM_LEAD_STATE_FILE
  })

  it('rejects a model outside the allowed list', () => {
    const lead = new Lead()
    expect(() => lead.setModel('not-a-model')).toThrow()
    expect(() => lead.setModel(undefined, 'not-a-model')).toThrow()
  })

  it('keeps the session id across a model change, and persists the new choice', () => {
    const lead = new Lead()
    ;(lead as unknown as { sessionId: string | null }).sessionId = 'session-123'
    expect(lead.getState().sessionId).toBe('session-123')

    const after = lead.setModel('haiku', 'opus')
    expect(after.sessionId).toBe('session-123')
    expect(after.model).toBe('haiku')
    expect(after.subagentModel).toBe('opus')

    // Reloading from the persisted state file (a restart) keeps the choice.
    const reloaded = new Lead()
    expect(reloaded.getState().model).toBe('haiku')
    expect(reloaded.getState().subagentModel).toBe('opus')
  })
})

describe('parseResult', () => {
  it('takes the result text from claude JSON output', () => {
    expect(parseResult('{"result":"done","is_error":false}', '', true)).toEqual({ ok: true, reply: 'done' })
  })
  it('marks is_error runs as failed but keeps their text', () => {
    expect(parseResult('{"result":"boom","is_error":true}', '', true)).toEqual({ ok: false, reply: 'boom' })
  })
  it('trusts a JSON result even when the unit reports failure', () => {
    expect(parseResult('{"result":"fine"}', '', false)).toEqual({ ok: true, reply: 'fine' })
  })
  it('falls back to stderr when there is no output', () => {
    expect(parseResult('', 'Not logged in', true)).toEqual({ ok: false, reply: 'Not logged in' })
  })
  it('passes through non-JSON output as the reply', () => {
    expect(parseResult('plain text', '', true)).toEqual({ ok: true, reply: 'plain text' })
  })
})
