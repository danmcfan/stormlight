// One agent's full transcript as a list of chat events, for the agent chat view.
// Pure parsing plus a file reader. Server only.
//
// Claude Code writes one JSONL record per content block. We keep what a person
// auditing the agent wants to see: the prompts and briefs it got, its replies,
// non-empty thinking, and each tool call joined with its result. Images stay in
// the file; events carry references (record uuid + index) that /api/transcript/image
// resolves, so a transcript full of screenshots still loads quickly.
import { readFileSync } from 'node:fs'

export interface ImageRef {
  /** uuid of the JSONL record holding the image. */
  uuid: string
  /** Index among that record's images, in document order. */
  index: number
  mediaType: string
}

export type TranscriptEvent =
  | { kind: 'user'; id: string; at: number; text: string; images: ImageRef[]; origin: 'prompt' | 'notification' | 'command' }
  | { kind: 'text'; id: string; at: number; text: string }
  | { kind: 'thinking'; id: string; at: number; text: string }
  | {
      kind: 'tool'
      id: string
      at: number
      name: string
      /** One-line description of the call. */
      summary: string
      /** Pretty-printed input, trimmed. */
      input: string
      /** Present once the result has arrived. */
      result?: { at: number; text: string; isError: boolean; images: ImageRef[]; truncated: boolean }
      /** For Agent calls: the spawned subagent's id, once known. */
      agentId?: string
    }

export interface Transcript {
  events: TranscriptEvent[]
  /** Model of the last assistant record. */
  model?: string
  /** Lines in the file when read; lets a client skip a no-op re-render. */
  lines: number
}

const MAX_TEXT = 20_000
const MAX_INPUT = 4_000
const MAX_RESULT = 8_000

function clip(s: string, n: number): { text: string; truncated: boolean } {
  return s.length > n ? { text: `${s.slice(0, n)}\n…`, truncated: true } : { text: s, truncated: false }
}

function ts(rec: any): number {
  const t = Date.parse(rec?.timestamp)
  return Number.isFinite(t) ? t : 0
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

/** All image blocks in a record, depth-first: message content, then tool_result content. */
export function imagesOf(rec: any): { mediaType: string; data: string }[] {
  const out: { mediaType: string; data: string }[] = []
  const walk = (blocks: unknown) => {
    if (!Array.isArray(blocks)) return
    for (const b of blocks as any[]) {
      if (!b || typeof b !== 'object') continue
      if (b.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string') {
        out.push({ mediaType: str(b.source.media_type) ?? 'image/png', data: b.source.data })
      } else if (b.type === 'tool_result') walk(b.content)
    }
  }
  walk(rec?.message?.content)
  return out
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n\n')
}

function summarize(input: any): string {
  const i = input && typeof input === 'object' ? input : {}
  const pick =
    str(i.description) ??
    str(i.command) ??
    str(i.file_path) ??
    str(i.notebook_path) ??
    str(i.pattern) ??
    str(i.url) ??
    str(i.query) ??
    str(i.prompt) ??
    ''
  const one = pick.replace(/\s+/g, ' ').trim()
  return one.length > 140 ? `${one.slice(0, 140)}…` : one
}

function userOrigin(text: string): 'prompt' | 'notification' | 'command' {
  const t = text.trimStart()
  if (t.startsWith('<task-notification>')) return 'notification'
  if (t.startsWith('<command-') || t.startsWith('<local-command')) return 'command'
  return 'prompt'
}

/** Parses transcript lines into events. Pure; unit tested with fixture lines. */
export function parseTranscript(lines: string[]): Transcript {
  const events: TranscriptEvent[] = []
  const tools = new Map<string, Extract<TranscriptEvent, { kind: 'tool' }>>()
  let model: string | undefined

  for (const line of lines) {
    let rec: any
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (!rec || (rec.type !== 'user' && rec.type !== 'assistant') || rec.isMeta) continue
    const at = ts(rec)
    const uuid = str(rec.uuid) ?? `${events.length}`
    const content = rec.message?.content

    if (rec.type === 'assistant') {
      model = str(rec.message?.model) ?? model
      if (!Array.isArray(content)) continue
      content.forEach((b: any, i: number) => {
        if (!b || typeof b !== 'object') return
        const id = `${uuid}:${i}`
        if (b.type === 'text' && str(b.text)?.trim()) {
          events.push({ kind: 'text', id, at, text: clip(b.text, MAX_TEXT).text })
        } else if (b.type === 'thinking' && str(b.thinking)?.trim()) {
          events.push({ kind: 'thinking', id, at, text: clip(b.thinking, MAX_TEXT).text })
        } else if (b.type === 'tool_use' && str(b.id)) {
          let input = ''
          try {
            input = JSON.stringify(b.input ?? {}, null, 2)
          } catch {
            /* leave empty */
          }
          const ev = {
            kind: 'tool' as const,
            id: b.id as string,
            at,
            name: str(b.name) ?? 'Tool',
            summary: summarize(b.input),
            input: clip(input, MAX_INPUT).text,
          }
          tools.set(ev.id, ev)
          events.push(ev)
        }
      })
      continue
    }

    // user record: a prompt/brief/notification, or tool results
    let imageIndex = 0
    const nextImages = (blocks: unknown): ImageRef[] => {
      const refs: ImageRef[] = []
      if (!Array.isArray(blocks)) return refs
      for (const b of blocks as any[]) {
        if (b?.type === 'image' && b.source?.type === 'base64') {
          refs.push({ uuid, index: imageIndex++, mediaType: str(b.source.media_type) ?? 'image/png' })
        }
      }
      return refs
    }

    if (typeof content === 'string') {
      if (content.trim()) events.push({ kind: 'user', id: uuid, at, text: clip(content, MAX_TEXT).text, images: [], origin: userOrigin(content) })
      continue
    }
    if (!Array.isArray(content)) continue
    const ownImages = nextImages(content)
    const ownText = textOf(content)
    for (const b of content) {
      if (b?.type !== 'tool_result') continue
      const tool = tools.get(str(b.tool_use_id) ?? '')
      const images = nextImages(b.content)
      if (!tool) continue
      const { text, truncated } = clip(textOf(b.content), MAX_RESULT)
      tool.result = { at, text, isError: b.is_error === true, images, truncated }
      const agentId = str(rec.toolUseResult?.agentId)
      if (agentId) tool.agentId = agentId
    }
    if (ownText.trim() || ownImages.length) {
      events.push({ kind: 'user', id: uuid, at, text: clip(ownText, MAX_TEXT).text, images: ownImages, origin: userOrigin(ownText) })
    }
  }
  return { events, model, lines: lines.length }
}

function fileLines(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
}

export function readTranscript(path: string): Transcript {
  return parseTranscript(fileLines(path))
}

/** The bytes of one image from a transcript record; undefined when not found. */
export function readTranscriptImage(path: string, uuid: string, index: number): { mediaType: string; data: Buffer } | undefined {
  for (const line of fileLines(path)) {
    if (!line.includes(uuid)) continue
    let rec: any
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (rec?.uuid !== uuid) continue
    const img = imagesOf(rec)[index]
    return img ? { mediaType: img.mediaType, data: Buffer.from(img.data, 'base64') } : undefined
  }
  return undefined
}
