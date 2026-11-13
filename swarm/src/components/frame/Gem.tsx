export type GemFamily = 'opus' | 'sonnet' | 'haiku' | 'other'
export type GemKind = 'live' | 'dead' | 'set' | 'socket'

/** A cut gemstone. Decorative: pair it with a text label wherever it carries meaning. */
export function Gem(props: { kind?: GemKind; family?: GemFamily; class?: string }) {
  const live = () => (props.family && props.family !== 'other' ? `#gem-${props.family}` : '#gem')
  return (
    <svg class={`gem ${props.class ?? ''}`} aria-hidden="true">
      {props.kind === 'dead' ? (
        <use href="#gem-dead" />
      ) : props.kind === 'set' ? (
        <use href="#gem-set" />
      ) : props.kind === 'socket' ? (
        <>
          <use class="g-live" href={live()} />
          <use class="g-dead" href="#gem-dead" />
        </>
      ) : (
        <use href={live()} />
      )}
    </svg>
  )
}

/** The round silver socket a gem sits in inside buttons and segmented items. */
export function Socket() {
  return (
    <span class="sock" aria-hidden="true">
      <Gem kind="socket" />
    </span>
  )
}

export type IconName =
  | 'opus'
  | 'sonnet'
  | 'haiku'
  | 'other'
  | 'read'
  | 'edit'
  | 'bash'
  | 'search'
  | 'agent'
  | 'hex'
  | 'plus'
  | 'minus'
  | 'fit'
  | 'close'

export function Icon(props: { name: IconName; class?: string }) {
  return (
    <svg class={`ico ${props.class ?? ''}`} aria-hidden="true">
      <use href={`#i-${props.name}`} />
    </svg>
  )
}

/** Picks a glyph for a tool call by its name. */
export function toolIcon(name: string): IconName {
  const n = name.toLowerCase()
  if (/^(read|view|notebookread|webfetch)/.test(n)) return 'read'
  if (/(edit|write|notebookedit|multiedit)/.test(n)) return 'edit'
  if (/(bash|shell|run|monitor)/.test(n)) return 'bash'
  if (/(grep|glob|search|find|list)/.test(n)) return 'search'
  if (/(agent|task|subagent|handback|message)/.test(n)) return 'agent'
  return 'hex'
}
