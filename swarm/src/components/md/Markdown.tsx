import { For, createMemo, createSignal, onCleanup } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { isSafeHref, isSafeImageSrc, parseMarkdown } from './parse'
import type { Align, Block, Inline, ListItem } from './parse'
import './md.css'

/**
 * Renders a Markdown reply as real DOM nodes, built from the pure AST in
 * `markdown.ts` — never through `innerHTML`, so model output is escaped by
 * construction. Self-contained: `<Markdown text={reply} />` is the whole API.
 */
export function Markdown(props: { text: string }) {
  const blocks = createMemo(() => parseMarkdown(props.text ?? ''))
  return (
    <div class="md">
      <For each={blocks()}>{(b) => renderBlock(b)}</For>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function renderBlock(block: Block): JSX.Element {
  switch (block.type) {
    case 'heading':
      return renderHeading(block.level, block.children)
    case 'paragraph':
      return <p>{renderInline(block.children)}</p>
    case 'code':
      return <CodeBlock lang={block.lang} code={block.code} />
    case 'hr':
      return <hr />
    case 'blockquote':
      return (
        <blockquote>
          <For each={block.children}>{(b) => renderBlock(b)}</For>
        </blockquote>
      )
    case 'list':
      return renderList(block.ordered, block.start, block.items)
    case 'table':
      return renderTable(block.align, block.header, block.rows)
  }
}

function renderHeading(level: 1 | 2 | 3 | 4 | 5 | 6, children: Inline[]): JSX.Element {
  const inline = renderInline(children)
  switch (level) {
    case 1:
      return <h1>{inline}</h1>
    case 2:
      return <h2>{inline}</h2>
    case 3:
      return <h3>{inline}</h3>
    case 4:
      return <h4>{inline}</h4>
    case 5:
      return <h5>{inline}</h5>
    case 6:
      return <h6>{inline}</h6>
  }
}

function renderListItem(item: ListItem): JSX.Element {
  const [first, ...rest] = item.children
  return (
    <li>
      {first ? (first.type === 'paragraph' ? renderInline(first.children) : renderBlock(first)) : null}
      <For each={rest}>{(b) => renderBlock(b)}</For>
    </li>
  )
}

function renderList(ordered: boolean, start: number, items: ListItem[]): JSX.Element {
  if (ordered) {
    return (
      <ol start={start !== 1 ? start : undefined}>
        <For each={items}>{(item) => renderListItem(item)}</For>
      </ol>
    )
  }
  return (
    <ul>
      <For each={items}>{(item) => renderListItem(item)}</For>
    </ul>
  )
}

function alignStyle(a: Align): JSX.CSSProperties | undefined {
  return a ? { 'text-align': a } : undefined
}

function renderTable(align: Align[], header: Inline[][], rows: Inline[][][]): JSX.Element {
  return (
    <div class="md-table-wrap">
      <table>
        <thead>
          <tr>
            <For each={header}>{(cell, i) => <th style={alignStyle(align[i()])}>{renderInline(cell)}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={rows}>
            {(row) => (
              <tr>
                <For each={row}>{(cell, i) => <td style={alignStyle(align[i()])}>{renderInline(cell)}</td>}</For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}

/** A fenced code block: a small header bar with the language and a Copy button. */
function CodeBlock(props: { lang: string | null; code: string }) {
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  const copy = async () => {
    try {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
      if (!clipboard) return // No Clipboard API (insecure context, old browser): degrade silently.
      await clipboard.writeText(props.code)
      setCopied(true)
      clearTimeout(timer)
      timer = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Permission denied or the call otherwise failed: degrade silently.
    }
  }
  onCleanup(() => clearTimeout(timer))

  return (
    <div class="md-code">
      <div class="md-code-head">
        <span class="md-code-lang">{props.lang ?? 'text'}</span>
        <button type="button" class="md-copy" onClick={copy}>
          {copied() ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre class="md-pre">
        <code>{props.code}</code>
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

function renderInline(nodes: Inline[]): JSX.Element {
  return <For each={nodes}>{(n) => renderInlineNode(n)}</For>
}

function renderInlineNode(node: Inline): JSX.Element {
  switch (node.type) {
    case 'text':
      return node.value
    case 'break':
      return <br />
    case 'code':
      return <code class="md-code-inline">{node.value}</code>
    case 'strong':
      return <strong>{renderInline(node.children)}</strong>
    case 'em':
      return <em>{renderInline(node.children)}</em>
    case 'strike':
      return <del>{renderInline(node.children)}</del>
    case 'link':
      return renderLink(node.href, node.external, node.children)
    case 'image':
      return renderImage(node.alt, node.src)
  }
}

function renderLink(href: string, external: boolean, children: Inline[]): JSX.Element {
  // Defense in depth: the parser already refuses to build a link/image node
  // for an unsafe URL, but a renderer for model output should never trust a
  // single layer of validation.
  if (!isSafeHref(href)) return renderInline(children)
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" class="md-link">
      {renderInline(children)}
    </a>
  ) : (
    <a href={href} class="md-link">
      {renderInline(children)}
    </a>
  )
}

function renderImage(alt: string, src: string): JSX.Element {
  if (!isSafeImageSrc(src)) return alt
  return <img src={src} alt={alt} loading="lazy" class="md-img" />
}
