import { describe, expect, it } from 'vitest'
import { isSafeHref, isSafeImageSrc, parseMarkdown } from './parse'
import type { Block, Inline } from './parse'

function text(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return n.value
      if (n.type === 'code') return n.value
      if (n.type === 'break') return '\n'
      if (n.type === 'image') return `![${n.alt}]`
      if ('children' in n) return text(n.children)
      return ''
    })
    .join('')
}

describe('headings', () => {
  it('parses ATX headings 1 through 6', () => {
    for (let level = 1; level <= 6; level++) {
      const blocks = parseMarkdown(`${'#'.repeat(level)} Title`)
      expect(blocks).toHaveLength(1)
      const b = blocks[0]
      expect(b.type).toBe('heading')
      if (b.type === 'heading') {
        expect(b.level).toBe(level)
        expect(text(b.children)).toBe('Title')
      }
    }
  })

  it('strips an optional closing run of hashes', () => {
    const [b] = parseMarkdown('## Title ##')
    expect(b.type).toBe('heading')
    if (b.type === 'heading') expect(text(b.children)).toBe('Title')
  })

  it('requires a space after the hashes, else it is a paragraph', () => {
    const [b] = parseMarkdown('#nospace')
    expect(b.type).toBe('paragraph')
  })
})

describe('paragraphs', () => {
  it('splits on a blank line', () => {
    const blocks = parseMarkdown('one\n\ntwo')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('paragraph')
    expect(blocks[1].type).toBe('paragraph')
  })

  it('joins a soft-wrapped line with a space', () => {
    const [b] = parseMarkdown('line one\nline two') as [Block]
    expect(b.type).toBe('paragraph')
    if (b.type === 'paragraph') expect(text(b.children)).toBe('line one line two')
  })

  it('treats two trailing spaces as a hard break', () => {
    const [b] = parseMarkdown('line one  \nline two')
    expect(b.type).toBe('paragraph')
    if (b.type === 'paragraph') {
      expect(b.children.some((c) => c.type === 'break')).toBe(true)
    }
  })

  it('treats a trailing backslash as a hard break', () => {
    const [b] = parseMarkdown('line one\\\nline two')
    expect(b.type).toBe('paragraph')
    if (b.type === 'paragraph') {
      expect(b.children.some((c) => c.type === 'break')).toBe(true)
    }
  })
})

describe('fenced code blocks', () => {
  it('captures a language label and the body', () => {
    const [b] = parseMarkdown('```ts\nconst x = 1\n```')
    expect(b.type).toBe('code')
    if (b.type === 'code') {
      expect(b.lang).toBe('ts')
      expect(b.code).toBe('const x = 1')
    }
  })

  it('supports tilde fences', () => {
    const [b] = parseMarkdown('~~~\nhello\n~~~')
    expect(b.type).toBe('code')
    if (b.type === 'code') expect(b.code).toBe('hello')
  })

  it('degrades an unterminated fence to a code block through EOF', () => {
    const blocks = parseMarkdown('```js\nconst x = 1\nstill going')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('code')
    if (blocks[0].type === 'code') {
      expect(blocks[0].code).toBe('const x = 1\nstill going')
      expect(blocks[0].lang).toBe('js')
    }
  })

  it('does not run inline parsing inside code', () => {
    const [b] = parseMarkdown('```\n**not bold**\n```')
    expect(b.type).toBe('code')
    if (b.type === 'code') expect(b.code).toBe('**not bold**')
  })
})

describe('inline emphasis mixed with code', () => {
  it('parses bold, italic, strike and inline code in one paragraph', () => {
    const [b] = parseMarkdown('**bold** and *italic* and ~~gone~~ and `code()`')
    expect(b.type).toBe('paragraph')
    if (b.type !== 'paragraph') return
    const kinds = b.children.map((c) => c.type)
    expect(kinds).toContain('strong')
    expect(kinds).toContain('em')
    expect(kinds).toContain('strike')
    expect(kinds).toContain('code')
    const strong = b.children.find((c) => c.type === 'strong')
    expect(strong && text([strong])).toBe('bold')
    const code = b.children.find((c) => c.type === 'code')
    expect(code && (code as { value: string }).value).toBe('code()')
  })

  it('does not treat an unmatched star as emphasis', () => {
    const [b] = parseMarkdown('a * b')
    expect(b.type).toBe('paragraph')
    if (b.type === 'paragraph') expect(text(b.children)).toBe('a * b')
  })

  it('links keep inline emphasis in their text', () => {
    const [b] = parseMarkdown('[**bold link**](https://example.com)')
    expect(b.type).toBe('paragraph')
    if (b.type !== 'paragraph') return
    const link = b.children[0]
    expect(link.type).toBe('link')
    if (link.type === 'link') {
      expect(link.href).toBe('https://example.com')
      expect(link.external).toBe(true)
      expect(link.children[0].type).toBe('strong')
    }
  })
})

describe('lists', () => {
  it('parses a flat unordered list', () => {
    const [b] = parseMarkdown('- one\n- two\n- three')
    expect(b.type).toBe('list')
    if (b.type !== 'list') return
    expect(b.ordered).toBe(false)
    expect(b.items).toHaveLength(3)
    expect(text((b.items[1].children[0] as { children: Inline[] }).children)).toBe('two')
  })

  it('parses an ordered list and keeps the start number', () => {
    const [b] = parseMarkdown('3. three\n4. four')
    expect(b.type).toBe('list')
    if (b.type !== 'list') return
    expect(b.ordered).toBe(true)
    expect(b.start).toBe(3)
    expect(b.items).toHaveLength(2)
  })

  it('nests a list by indentation', () => {
    const [b] = parseMarkdown('- parent\n  - child one\n  - child two\n- sibling')
    expect(b.type).toBe('list')
    if (b.type !== 'list') return
    expect(b.items).toHaveLength(2)
    const nested = b.items[0].children.find((c) => c.type === 'list')
    expect(nested).toBeDefined()
    if (nested && nested.type === 'list') {
      expect(nested.items).toHaveLength(2)
    }
  })

  it('supports +, - and * markers', () => {
    for (const marker of ['-', '*', '+']) {
      const [b] = parseMarkdown(`${marker} item`)
      expect(b.type).toBe('list')
    }
  })
})

describe('blockquotes', () => {
  it('parses a simple quote', () => {
    const [b] = parseMarkdown('> quoted text')
    expect(b.type).toBe('blockquote')
    if (b.type !== 'blockquote') return
    expect(b.children).toHaveLength(1)
    expect(b.children[0].type).toBe('paragraph')
  })

  it('stops at the first non-quoted line', () => {
    const blocks = parseMarkdown('> quoted\nnot quoted')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('blockquote')
    expect(blocks[1].type).toBe('paragraph')
  })
})

describe('horizontal rules', () => {
  it('recognizes ---, ***, and ___', () => {
    for (const rule of ['---', '***', '___', '- - -']) {
      const [b] = parseMarkdown(rule)
      expect(b.type).toBe('hr')
    }
  })
})

describe('images', () => {
  it('renders an http(s) image', () => {
    const [b] = parseMarkdown('![a cat](https://example.com/cat.png)')
    expect(b.type).toBe('paragraph')
    if (b.type !== 'paragraph') return
    expect(b.children[0].type).toBe('image')
    if (b.children[0].type === 'image') expect(b.children[0].src).toBe('https://example.com/cat.png')
  })

  it('renders a same-origin /api/ image', () => {
    const [b] = parseMarkdown('![shot](/api/shots/1.png)')
    expect(b.type).toBe('paragraph')
    if (b.type !== 'paragraph') return
    expect(b.children[0].type).toBe('image')
  })

  it('falls back to alt text for an unsafe image src', () => {
    const [b] = parseMarkdown('![bad](javascript:alert(1))')
    expect(b.type).toBe('paragraph')
    if (b.type !== 'paragraph') return
    expect(b.children[0].type).toBe('text')
    if (b.children[0].type === 'text') expect(b.children[0].value).toBe('bad')
  })

  it('rejects a protocol-relative image src', () => {
    expect(isSafeImageSrc('//evil.example.com/x.png')).toBe(false)
  })
})

describe('links', () => {
  it('accepts http, https, mailto and same-origin paths', () => {
    expect(isSafeHref('https://example.com')).toBe(true)
    expect(isSafeHref('http://example.com')).toBe(true)
    expect(isSafeHref('mailto:a@b.com')).toBe(true)
    expect(isSafeHref('/lead')).toBe(true)
  })

  it('rejects javascript: and other unsafe schemes', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHref('data:text/html,hi')).toBe(false)
    expect(isSafeHref('//evil.example.com')).toBe(false)
    expect(isSafeHref('vbscript:x')).toBe(false)
  })

  it('renders a rejected link as plain text', () => {
    const [b] = parseMarkdown('[click me](javascript:alert(1))')
    expect(b.type).toBe('paragraph')
    if (b.type !== 'paragraph') return
    expect(b.children[0].type).toBe('text')
    if (b.children[0].type === 'text') expect(b.children[0].value).toBe('click me')
  })
})

describe('tables', () => {
  it('parses a GitHub-style table with alignment', () => {
    const md = ['| Name | Count |', '| :--- | ----: |', '| a | 1 |', '| b | 2 |'].join('\n')
    const [b] = parseMarkdown(md)
    expect(b.type).toBe('table')
    if (b.type !== 'table') return
    expect(b.header).toHaveLength(2)
    expect(text(b.header[0])).toBe('Name')
    expect(b.align).toEqual(['left', 'right'])
    expect(b.rows).toHaveLength(2)
    expect(text(b.rows[1][0])).toBe('b')
  })

  it('falls back to a plain paragraph when the separator row is malformed', () => {
    const md = ['| Name | Count |', '| not a separator |', '| a | 1 |'].join('\n')
    const blocks = parseMarkdown(md)
    expect(blocks.some((b) => b.type === 'table')).toBe(false)
  })
})

describe('malformed input never throws', () => {
  const inputs = [
    '',
    '`unterminated code span',
    '**unterminated bold',
    '[text](unterminated',
    '![alt](unterminated',
    '```\nunterminated fence',
    '| a | b |\n| --- |',
    '> '.repeat(50),
    '#'.repeat(500),
    '*'.repeat(500),
    '- '.repeat(500) + '\n',
    'a'.repeat(100_000),
    '[[[[[[[[nested brackets',
    '[text](()())',
    'normal **bold *and italic* still bold** text',
  ]

  for (const input of inputs) {
    it(`does not throw on ${JSON.stringify(input.slice(0, 30))}...`, () => {
      expect(() => parseMarkdown(input)).not.toThrow()
    })
  }
})
