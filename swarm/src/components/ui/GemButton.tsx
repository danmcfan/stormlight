import type { JSX } from '@solidjs/web'
import { Button } from '@ui-sdk/solid/button'
import { Icon, Socket, type IconName } from '../frame/Gem'

/**
 * A ui-sdk Button dressed as a glass capsule with a gem set inside. With `icon`
 * it is the round control: name it with aria-label, since it has no text.
 */
export function GemButton(props: {
  icon?: IconName
  class?: string
  disabled?: boolean
  'aria-label'?: string
  onClick?: () => void
  children?: JSX.Element
}) {
  return (
    <Button
      class={`gem-btn ${props.icon ? 'icon' : ''} ${props.class ?? ''}`}
      disabled={props.disabled}
      aria-label={props['aria-label']}
      onClick={props.onClick}
    >
      <Socket />
      {props.icon ? <Icon name={props.icon} /> : props.children}
    </Button>
  )
}
