/**
 * A small, hand-written Markdown parser for the Lead chat.
 *
 * This module is pure: no DOM, no globals. It turns Markdown text into a
 * block/inline AST that `Markdown.tsx` renders into real DOM nodes (never
 * through innerHTML, so the output is escaped by construction).
 *
 * The parser never throws. Replies stream in and are often mid-token: an
 * unterminated fence, a stray `*`, or a half-built table must all render as
 * *something* sensible rather than crash the chat.
 */

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Align = 'left' | 'center' | 'right' | null

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'strike'; children: Inline[] }
  | { type: 'link'; href: string; external: boolean; children: Inline[] }
  | { type: 'image'; alt: string; src: string }
  | { type: 'break' }

export type ListItem = {
  children: Block[]
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'code'; lang: string | null; code: string }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'blockquote'; children: Block[] }
  | { type: 'hr' }
  | { type: 'table'; align: Align[]; header: Inline[][]; rows: Inline[][][] }

const MAX_INLINE_DEPTH = 24

/** Parse Markdown text into a sequence of block nodes. Never throws. */
export function parseMarkdown(text: string): Block[] {
  try {
    const lines = normalizeLines(text)
    return parseBlocks(lines)
  } catch {
    // Should be unreachable (every helper below is defensive), but a reply
    // rendering as a plain paragraph beats a crashed chat.
    return [{ type: 'paragraph', children: [{ type: 'text', value: text }] }]
  }
}

function normalizeLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

function isBlank(line: string): boolean {
  return line.trim() === ''
}

/** True if `line` starts a block type that may interrupt a paragraph. */
function startsBlock(line: string): boolean {
  return (
    matchFence(line) !== null ||
    matchHeading(line) !== null ||
    matchHr(line) ||
    matchBlockquote(line) !== null ||
    matchListMarker(line) !== null
  )
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  let guard = 0
  while (i < lines.length) {
    // Defend against any accidental non-progress in a helper below.
    guard++
    if (guard > lines.length * 4 + 100) break

    if (isBlank(lines[i])) {
      i++
      continue
    }

    const fence = tryFence(lines, i)
    if (fence) {
      blocks.push(fence.block)
      i = fence.next
      continue
    }

    const heading = matchHeading(lines[i])
    if (heading) {
      blocks.push(heading)
      i++
      continue
    }

    if (matchHr(lines[i])) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    const bq = tryBlockquote(lines, i)
    if (bq) {
      blocks.push(bq.block)
      i = bq.next
      continue
    }

    const list = tryList(lines, i)
    if (list) {
      blocks.push(list.block)
      i = list.next
      continue
    }

    const table = tryTable(lines, i)
    if (table) {
      blocks.push(table.block)
      i = table.next
      continue
    }

    const para = readParagraph(lines, i)
    blocks.push(para.block)
    i = para.next
  }
  return blocks
}

// ---- fenced code blocks ----------------------------------------------------

function matchFence(line: string): { indent: number; char: string; len: number; lang: string | null } | null {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)[ \t]*$/.exec(line)
  if (!m) return null
  // Backtick fences may not carry a backtick in the info string.
  if (m[1][0] === '`' && m[2].includes('`')) return null
  return { indent: 0, char: m[1][0], len: m[1].length, lang: m[2] ? m[2] : null }
}

function tryFence(lines: string[], i: number): { block: Block; next: number } | null {
  const open = matchFence(lines[i])
  if (!open) return null
  const code: string[] = []
  let j = i + 1
  for (; j < lines.length; j++) {
    const closeRe = new RegExp(`^ {0,3}\\${open.char}{${open.len},}[ \\t]*$`)
    if (closeRe.test(lines[j])) {
      j++
      break
    }
    code.push(lines[j])
  }
  // If no closing fence was found, `j` reached lines.length: the rest of the
  // stream renders as code, which is the right degrade for a reply still
  // streaming inside a fence.
  return { block: { type: 'code', lang: open.lang, code: code.join('\n') }, next: j }
}

// ---- headings ---------------------------------------------------------------

function matchHeading(line: string): Block | null {
  const m = /^ {0,3}(#{1,6})(?:\s+(.*))?\s*$/.exec(line)
  if (!m) return null
  const level = m[1].length as 1 | 2 | 3 | 4 | 5 | 6
  let content = m[2] ?? ''
  content = content.replace(/\s+#+\s*$/, '')
  return { type: 'heading', level, children: parseInline(content) }
}

// ---- horizontal rules ---------------------------------------------------

function matchHr(line: string): boolean {
  const t = line.trim()
  if (t.length < 3) return false
  const stripped = t.replace(/ /g, '')
  return /^-{3,}$/.test(stripped) || /^\*{3,}$/.test(stripped) || /^_{3,}$/.test(stripped)
}

// ---- blockquotes ----------------------------------------------------------

function matchBlockquote(line: string): string | null {
  const m = /^ {0,3}>(?: (.*))?$/.exec(line)
  if (!m) return null
  return m[1] ?? ''
}

function tryBlockquote(lines: string[], i: number): { block: Block; next: number } | null {
  if (matchBlockquote(lines[i]) === null) return null
  const inner: string[] = []
  let j = i
  while (j < lines.length) {
    const content = matchBlockquote(lines[j])
    if (content === null) break
    inner.push(content)
    j++
  }
  return { block: { type: 'blockquote', children: parseBlocks(inner) }, next: j }
}

// ---- lists ------------------------------------------------------------------

function matchListMarker(
  line: string,
): { indent: number; ordered: boolean; start: number; contentCol: number; content: string } | null {
  const m = /^( {0,3})(?:([-*+])|(\d{1,9})([.)]))(?:( +)(.*))?$/.exec(line)
  if (!m) return null
  const indent = m[1].length
  const ordered = m[3] !== undefined
  const markerLen = (ordered ? m[3].length + m[4].length : m[2].length) + indent
  const hasSpace = m[5] !== undefined
  const contentCol = hasSpace ? markerLen + m[5].length : markerLen + 1
  const content = hasSpace ? m[6] : ''
  const start = ordered ? parseInt(m[3], 10) : 1
  return { indent, ordered, start, contentCol, content }
}

function tryList(lines: string[], i: number): { block: Block; next: number } | null {
  const first = matchListMarker(lines[i])
  if (!first || first.indent > 3) return null
  const items: ListItem[] = []
  const ordered = first.ordered
  const start = first.start
  let j = i

  while (j < lines.length) {
    const m = matchListMarker(lines[j])
    if (!m || m.ordered !== ordered || m.indent > 3) break

    const itemLines: string[] = [m.content]
    const contentCol = m.contentCol
    j++
    while (j < lines.length) {
      const line = lines[j]
      if (isBlank(line)) {
        let k = j
        while (k < lines.length && isBlank(lines[k])) k++
        if (k < lines.length && leadingSpaces(lines[k]) >= contentCol) {
          itemLines.push('')
          j++
          continue
        }
        break
      }
      if (leadingSpaces(line) >= contentCol) {
        itemLines.push(line.slice(contentCol))
        j++
        continue
      }
      break
    }
    items.push({ children: parseBlocks(itemLines) })

    // Skip blank separator lines between items.
    while (j < lines.length && isBlank(lines[j])) {
      const k = j
      let k2 = k
      while (k2 < lines.length && isBlank(lines[k2])) k2++
      if (k2 < lines.length && matchListMarker(lines[k2])) {
        j = k2
        break
      }
      // Blank line(s) not followed by another list item: list ends here.
      break
    }
  }

  return { block: { type: 'list', ordered, start, items }, next: j }
}

function leadingSpaces(line: string): number {
  const m = /^ */.exec(line)
  return m ? m[0].length : 0
}

// ---- tables -----------------------------------------------------------------

function splitRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '\\' && line[i + 1] === '|') {
      cur += '|'
      i++
      continue
    }
    if (c === '|') {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  cells.push(cur)
  // Drop a single leading/trailing empty cell produced by edge pipes.
  if (cells.length > 1 && cells[0].trim() === '') cells.shift()
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.map((c) => c.trim())
}

function tryTable(lines: string[], i: number): { block: Block; next: number } | null {
  const headerLine = lines[i]
  if (!headerLine || !headerLine.includes('|')) return null
  const sepLine = lines[i + 1]
  if (!sepLine || !sepLine.includes('-')) return null

  const sepCells = splitRow(sepLine)
  if (sepCells.length === 0) return null
  const align: Align[] = []
  for (const cell of sepCells) {
    if (!/^:?-+:?$/.test(cell)) return null
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    align.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null)
  }

  const headerCells = splitRow(headerLine)
  if (headerCells.length !== sepCells.length) return null

  const header = headerCells.map((c) => parseInline(c))
  const rows: Inline[][][] = []
  let j = i + 2
  while (j < lines.length && !isBlank(lines[j]) && lines[j].includes('|')) {
    const cells = splitRow(lines[j])
    const row: Inline[][] = []
    for (let c = 0; c < header.length; c++) {
      row.push(parseInline(cells[c] ?? ''))
    }
    rows.push(row)
    j++
  }

  return { block: { type: 'table', align, header, rows }, next: j }
}

// ---- paragraphs ---------------------------------------------------------

function readParagraph(lines: string[], i: number): { block: Block; next: number } {
  const collected: string[] = [lines[i]]
  let j = i + 1
  while (j < lines.length && !isBlank(lines[j]) && !startsBlock(lines[j])) {
    collected.push(lines[j])
    j++
  }
  const raw = joinParagraphLines(collected)
  return { block: { type: 'paragraph', children: parseInline(raw) }, next: j }
}

const HARD_BREAK = ' '

function joinParagraphLines(lines: string[]): string {
  let out = ''
  for (let idx = 0; idx < lines.length; idx++) {
    const isLast = idx === lines.length - 1
    let line = lines[idx]
    if (isLast) {
      out += line.replace(/[ \t]+$/, '')
      break
    }
    const hardBreak = /( {2,}|\\)$/.test(line)
    line = line.replace(/\\$/, '').replace(/[ \t]+$/, '')
    out += line
    out += hardBreak ? HARD_BREAK : ' '
  }
  return out
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

export function parseInline(src: string): Inline[] {
  try {
    return parseInlineInner(src, 0)
  } catch {
    return [{ type: 'text', value: src }]
  }
}

function parseInlineInner(src: string, depth: number): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) {
      out.push({ type: 'text', value: buf })
      buf = ''
    }
  }

  if (depth > MAX_INLINE_DEPTH) {
    return [{ type: 'text', value: src }]
  }

  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]

    if (c === HARD_BREAK) {
      flush()
      out.push({ type: 'break' })
      i++
      continue
    }

    if (c === '`') {
      const span = readCodeSpan(src, i)
      if (span) {
        flush()
        out.push({ type: 'code', value: span.value })
        i = span.next
        continue
      }
      buf += c
      i++
      continue
    }

    if (c === '!' && src[i + 1] === '[') {
      const img = readImage(src, i)
      if (img) {
        flush()
        out.push(img.node)
        i = img.next
        continue
      }
      buf += c
      i++
      continue
    }

    if (c === '[') {
      const link = readLink(src, i, depth)
      if (link) {
        flush()
        out.push(link.node)
        i = link.next
        continue
      }
      buf += c
      i++
      continue
    }

    if (c === '~' && src[i + 1] === '~') {
      const em = readDelimited(src, i, '~~', depth)
      if (em) {
        flush()
        out.push({ type: 'strike', children: em.children })
        i = em.next
        continue
      }
      buf += c
      i++
      continue
    }

    if (c === '*' || c === '_') {
      const strong = readDelimited(src, i, c + c, depth)
      if (strong) {
        flush()
        out.push({ type: 'strong', children: strong.children })
        i = strong.next
        continue
      }
      const em = readDelimited(src, i, c, depth)
      if (em) {
        flush()
        out.push({ type: 'em', children: em.children })
        i = em.next
        continue
      }
      buf += c
      i++
      continue
    }

    buf += c
    i++
  }
  flush()
  return out
}

/** Read a backtick code span starting at `start`. */
function readCodeSpan(src: string, start: number): { value: string; next: number } | null {
  let runLen = 0
  let i = start
  while (src[i] === '`') {
    runLen++
    i++
  }
  const openEnd = i
  const closeRe = '`'.repeat(runLen)
  const closeIdx = src.indexOf(closeRe, openEnd)
  if (closeIdx === -1) return null
  // The closing run must not itself be part of a longer backtick run.
  let value = src.slice(openEnd, closeIdx)
  // Commonmark trims one leading/trailing space if the span is bracketed by
  // single spaces on both ends (so `` `code` `` renders without extra pad).
  if (value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '') {
    value = value.slice(1, -1)
  }
  value = value.replace(HARD_BREAK, ' ')
  return { value, next: closeIdx + runLen }
}

/** Read a `*`/`**`/`_`/`__`/`~~`-delimited span starting at `start`. */
function readDelimited(
  src: string,
  start: number,
  delim: string,
  depth: number,
): { children: Inline[]; next: number } | null {
  if (src.slice(start, start + delim.length) !== delim) return null
  const contentStart = start + delim.length
  // Delimiter can't open on whitespace right after it.
  if (contentStart >= src.length || /\s/.test(src[contentStart])) return null

  let searchFrom = contentStart
  while (true) {
    const closeIdx = src.indexOf(delim, searchFrom)
    if (closeIdx === -1) return null
    // Delimiter can't close on whitespace right before it.
    if (/\s/.test(src[closeIdx - 1])) {
      searchFrom = closeIdx + delim.length
      continue
    }
    const inner = src.slice(contentStart, closeIdx)
    if (inner === '') return null
    return { children: parseInlineInner(inner, depth + 1), next: closeIdx + delim.length }
  }
}

/** Find the matching close for a `[` opened at `start`, respecting nesting. */
function findBracketEnd(src: string, start: number): number | null {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === HARD_BREAK) return null
    if (c === '\\' && i + 1 < src.length) {
      i++
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return null
}

function readParenUrl(src: string, start: number): { url: string; next: number } | null {
  if (src[start] !== '(') return null
  let depth = 0
  let i = start
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === HARD_BREAK) return null
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        return { url: src.slice(start + 1, i).trim(), next: i + 1 }
      }
    }
  }
  return null
}

function readImage(src: string, start: number): { node: Inline; next: number } | null {
  // src[start] === '!', src[start+1] === '['
  const bracketOpen = start + 1
  const bracketClose = findBracketEnd(src, bracketOpen)
  if (bracketClose === null) return null
  const alt = src.slice(bracketOpen + 1, bracketClose)
  const paren = readParenUrl(src, bracketClose + 1)
  if (!paren) return null
  const altText = plainText(parseInlineInner(alt, 0))
  const src2 = stripAngleBrackets(paren.url)
  if (!isSafeImageSrc(src2)) {
    return { node: { type: 'text', value: altText } as unknown as Inline, next: paren.next }
  }
  return { node: { type: 'image', alt: altText, src: src2 }, next: paren.next }
}

function readLink(src: string, start: number, depth: number): { node: Inline; next: number } | null {
  const bracketClose = findBracketEnd(src, start)
  if (bracketClose === null) return null
  const text = src.slice(start + 1, bracketClose)
  const paren = readParenUrl(src, bracketClose + 1)
  if (!paren) return null
  const children = parseInlineInner(text, depth + 1)
  const href = stripAngleBrackets(paren.url)
  if (!isSafeHref(href)) {
    return { node: { type: 'text', value: plainText(children) } as unknown as Inline, next: paren.next }
  }
  const external = /^https?:\/\//i.test(href)
  return { node: { type: 'link', href, external, children }, next: paren.next }
}

function stripAngleBrackets(url: string): string {
  const m = /^<(.*)>$/.exec(url.trim())
  return (m ? m[1] : url).trim()
}

function plainText(nodes: Inline[]): string {
  let s = ''
  for (const n of nodes) {
    if (n.type === 'text') s += n.value
    else if (n.type === 'code') s += n.value
    else if (n.type === 'break') s += ' '
    else if ('children' in n) s += plainText(n.children)
    else if (n.type === 'image') s += n.alt
  }
  return s
}

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

function isSameOriginPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//')
}

/** Links: http(s), mailto, or a same-origin path starting with `/`. */
export function isSafeHref(url: string): boolean {
  const u = url.trim()
  if (u === '') return false
  if (/^https?:\/\//i.test(u)) return true
  if (/^mailto:/i.test(u)) return true
  if (isSameOriginPath(u)) return true
  return false
}

/** Images: http(s) or a same-origin path starting with `/` (incl. `/api/`). */
export function isSafeImageSrc(url: string): boolean {
  const u = url.trim()
  if (u === '') return false
  if (/^https?:\/\//i.test(u)) return true
  if (isSameOriginPath(u)) return true
  return false
}
