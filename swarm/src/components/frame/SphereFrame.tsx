import type { JSX } from '@solidjs/web'
import './frame.css'

export type OrbCorner = 'tl' | 'tr' | 'bl' | 'br'
const ALL: OrbCorner[] = ['tl', 'tr', 'bl', 'br']

/** Glass spheres holding gems, set on the corners of whatever positioned element contains them. */
export function Orbs(props: { corners?: OrbCorner[] }) {
  return (
    <>
      {(props.corners ?? ALL).map((c) => (
        <span class={`orb k-${c}`} aria-hidden="true">
          <svg viewBox="0 0 48 48">
            <use href="#orb" />
          </svg>
        </span>
      ))}
    </>
  )
}

/**
 * Silver rails with a glass sphere on each corner.
 *
 * `glow` (0 to 1) sets how bright the rails and spheres burn; `live` makes the
 * spheres breathe. A frame that follows another one passes `joined`: it takes
 * the previous frame's bottom rail as its own top rail and drops its top
 * spheres, so a stack reads as one structure with a single row of spheres at
 * each joint.
 */
export function SphereFrame(props: {
  children?: JSX.Element
  glow?: number
  live?: boolean
  joined?: boolean
  flush?: boolean
  class?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}) {
  return (
    <div
      id={props.id}
      class={`frame ${props.class ?? ''}`}
      style={{ '--g': props.glow ?? 1 }}
      data-live={props.live ? '' : undefined}
      data-joined={props.joined ? '' : undefined}
      data-flush={props.flush ? '' : undefined}
      role={props['aria-label'] || props['aria-labelledby'] ? 'region' : undefined}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
    >
      <Orbs />
      {props.children}
    </div>
  )
}
