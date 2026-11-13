import type { JSX } from '@solidjs/web'

interface Palette {
  id: string
  faces: [string, string, string, string, string, string]
  table: [string, string, string]
}

const PALETTES: Palette[] = [
  { id: '', faces: ['#d6f1ff', '#4f8dff', '#2a52d0', '#1d3aa6', '#62adff', '#a4d9ff'], table: ['#fff', '#bfe8ff', '#7fb8ff'] },
  { id: '-opus', faces: ['#e6e0ff', '#7a6dff', '#4a34c8', '#33218f', '#9a8cff', '#c4b9ff'], table: ['#fff', '#ddd6ff', '#9a8cff'] },
  { id: '-sonnet', faces: ['#e2f6ff', '#4fb4ff', '#1f7fd6', '#1664a8', '#6cc4ff', '#b3e4ff'], table: ['#fff', '#cdeeff', '#6cc4ff'] },
  { id: '-haiku', faces: ['#d9fffb', '#38d6e8', '#1597b0', '#0f7389', '#5be3f0', '#a8f5f6'], table: ['#fff', '#c4fbf8', '#5be3f0'] },
]

const FACE_PATHS = [
  'M10 1 L18 6 L14 8 L10 6Z',
  'M18 6 L18 14 L14 12 L14 8Z',
  'M18 14 L10 19 L10 14 L14 12Z',
  'M10 19 L2 14 L6 12 L10 14Z',
  'M2 14 L2 6 L6 8 L6 12Z',
  'M2 6 L10 1 L10 6 L6 8Z',
]

function GemSymbol(props: { p: Palette }) {
  const p = props.p
  return (
    <>
      <radialGradient id={`tbl${p.id}`} cx=".5" cy=".4" r=".6">
        <stop offset="0" stop-color={p.table[0]} />
        <stop offset=".55" stop-color={p.table[1]} />
        <stop offset="1" stop-color={p.table[2]} />
      </radialGradient>
      <symbol id={`gem${p.id}`} viewBox="0 0 20 20">
        <g stroke="rgba(255,255,255,.55)" stroke-width=".35" stroke-linejoin="round">
          {FACE_PATHS.map((d, i) => (
            <path d={d} fill={p.faces[i]} />
          ))}
          <path d="M10 6 L14 8 L14 12 L10 14 L6 12 L6 8Z" fill={`url(#tbl${p.id})`} />
        </g>
        <path d="M10 6 L14 8 L10 10Z" fill="#fff" opacity=".7" />
        <path d="M10 .2v2.4M8.8 1.4h2.4" stroke="#fff" stroke-width=".6" opacity=".9" />
      </symbol>
      <symbol id={`orb${p.id}`} viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="23.2" fill="#02030a" />
        <circle cx="24" cy="24" r="21" fill="url(#glass)" />
        <circle cx="24" cy="24" r="20.2" fill="url(#inner)" />
        <use href={`#gem${p.id}`} x="11.5" y="11.5" width="25" height="25" />
        <circle cx="24" cy="24" r="6" fill="url(#spec)" opacity=".85" />
        <ellipse cx="16.5" cy="12.5" rx="8" ry="4.2" transform="rotate(-32 16.5 12.5)" fill="url(#spec)" />
        <path d="M36.5 31 A14.5 14.5 0 0 1 20 38.2" fill="none" stroke="#bfe0ff" stroke-width="3" stroke-linecap="round" opacity=".14" />
        <path d="M36.5 31 A14.5 14.5 0 0 1 20 38.2" fill="none" stroke="#e4f2ff" stroke-width="1.1" stroke-linecap="round" opacity=".5" />
        <circle cx="24" cy="24" r="22.2" fill="none" stroke="url(#silver)" stroke-width="3" />
        <circle cx="24" cy="24" r="20.5" fill="none" stroke="rgba(0,0,0,.55)" stroke-width=".8" />
        <g fill="url(#silver)" stroke="#2a3040" stroke-width=".5">
          <circle cx="8.3" cy="8.3" r="2.3" />
          <circle cx="39.7" cy="8.3" r="2.3" />
          <circle cx="8.3" cy="39.7" r="2.3" />
          <circle cx="39.7" cy="39.7" r="2.3" />
        </g>
      </symbol>
    </>
  )
}

/**
 * Every gradient, gem and icon the theme draws, defined once for the whole page.
 * Components reference them with <use href="#..."> so nothing is repeated per node.
 */
export function GemDefs(): JSX.Element {
  return (
    <svg class="gfx" aria-hidden="true">
      <defs>
        <linearGradient id="silver" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#4a5367" />
          <stop offset=".22" stop-color="#f4f8ff" />
          <stop offset=".3" stop-color="#8692a8" />
          <stop offset=".55" stop-color="#c4cede" />
          <stop offset=".72" stop-color="#fff" />
          <stop offset=".85" stop-color="#7b879d" />
          <stop offset="1" stop-color="#434b5f" />
        </linearGradient>
        <radialGradient id="glass" cx=".38" cy=".3" r=".85">
          <stop offset="0" stop-color="#eaf6ff" stop-opacity=".5" />
          <stop offset=".35" stop-color="#6ea8ff" stop-opacity=".25" />
          <stop offset=".8" stop-color="#1a2a66" stop-opacity=".6" />
          <stop offset="1" stop-color="#050818" stop-opacity=".95" />
        </radialGradient>
        <radialGradient id="inner" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#fff" />
          <stop offset=".25" stop-color="#c8ecff" stop-opacity=".95" />
          <stop offset=".6" stop-color="#5aa0ff" stop-opacity=".5" />
          <stop offset="1" stop-color="#3a5cff" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="spec" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#fff" stop-opacity=".95" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="halo" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#cfeaff" stop-opacity=".8" />
          <stop offset=".45" stop-color="#6c9cff" stop-opacity=".3" />
          <stop offset="1" stop-color="#6c8cff" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="spark" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#fff" />
          <stop offset=".35" stop-color="#cfeaff" stop-opacity=".9" />
          <stop offset="1" stop-color="#6cb4ff" stop-opacity="0" />
        </radialGradient>

        {PALETTES.map((p) => (
          <GemSymbol p={p} />
        ))}

        <symbol id="gem-dead" viewBox="0 0 20 20">
          <g stroke="rgba(150,160,185,.4)" stroke-width=".35" stroke-linejoin="round">
            <path d="M10 1 L18 6 L14 8 L10 6Z" fill="#2a303c" />
            <path d="M18 6 L18 14 L14 12 L14 8Z" fill="#1a1e27" />
            <path d="M18 14 L10 19 L10 14 L14 12Z" fill="#12151c" />
            <path d="M10 19 L2 14 L6 12 L10 14Z" fill="#0e1117" />
            <path d="M2 14 L2 6 L6 8 L6 12Z" fill="#1c212b" />
            <path d="M2 6 L10 1 L10 6 L6 8Z" fill="#242a35" />
            <path d="M10 6 L14 8 L14 12 L10 14 L6 12 L6 8Z" fill="#171b23" />
          </g>
          <path d="M12 2.5 L10.5 7 L13 9.5 L10 12.5 L11.5 17" fill="none" stroke="#000" stroke-width="1" />
          <path d="M12 2.5 L10.5 7 L13 9.5 L10 12.5 L11.5 17" fill="none" stroke="rgba(170,180,205,.35)" stroke-width=".3" transform="translate(.5 0)" />
        </symbol>

        <symbol id="gem-set" viewBox="0 0 24 24">
          <path d="M12 1.5 L21.2 6.75 V17.25 L12 22.5 L2.8 17.25 V6.75Z" fill="#05081a" stroke="url(#silver)" stroke-width="2.2" stroke-linejoin="round" />
          <use href="#gem" x="5.2" y="5.2" width="13.6" height="13.6" opacity=".85" />
          <path d="M12 1.5 L21.2 6.75 V17.25 L12 22.5 L2.8 17.25 V6.75Z" fill="none" stroke="rgba(255,255,255,.7)" stroke-width=".5" stroke-linejoin="round" />
          <g fill="url(#silver)" stroke="#2a3040" stroke-width=".4">
            <circle cx="12" cy="3.3" r="1.5" />
            <circle cx="12" cy="20.7" r="1.5" />
            <circle cx="4.4" cy="7.7" r="1.4" />
            <circle cx="19.6" cy="7.7" r="1.4" />
            <circle cx="4.4" cy="16.3" r="1.4" />
            <circle cx="19.6" cy="16.3" r="1.4" />
          </g>
        </symbol>

        <symbol id="i-opus" viewBox="0 0 24 24">
          <path d="M12 2 L20 5 V12 C20 16.5 16.5 19.8 12 22 C7.5 19.8 4 16.5 4 12 V5Z" />
          <path d="M7.5 12.5 L8.5 8.5 L12 11 L15.5 8.5 L16.5 12.5Z" />
          <circle cx="12" cy="16" r="1" fill="currentColor" />
        </symbol>
        <symbol id="i-sonnet" viewBox="0 0 24 24">
          <path d="M12 2 L20 5 V12 C20 16.5 16.5 19.8 12 22 C7.5 19.8 4 16.5 4 12 V5Z" />
          <path d="M12 7 L16 12 L12 17 L8 12Z" />
          <path d="M12 9.5v5M9.5 12h5" opacity=".6" />
        </symbol>
        <symbol id="i-haiku" viewBox="0 0 24 24">
          <path d="M12 2 L20 5 V12 C20 16.5 16.5 19.8 12 22 C7.5 19.8 4 16.5 4 12 V5Z" />
          <path d="M8.5 12.5 L12 8.5 L15.5 12.5" />
        </symbol>
        <symbol id="i-other" viewBox="0 0 24 24">
          <path d="M12 2.5 L20.5 7.2 V16.8 L12 21.5 L3.5 16.8 V7.2Z" />
          <circle cx="12" cy="12" r="2" />
        </symbol>
        <symbol id="i-read" viewBox="0 0 24 24">
          <path d="M2.5 12 C6 6.5 18 6.5 21.5 12 C18 17.5 6 17.5 2.5 12Z" />
          <circle cx="12" cy="12" r="3" />
        </symbol>
        <symbol id="i-edit" viewBox="0 0 24 24">
          <path d="M4 20 L5 15 L16 4 L20 8 L9 19Z" />
          <path d="M13.5 6.5 L17.5 10.5" />
          <path d="M4 20h7" opacity=".6" />
        </symbol>
        <symbol id="i-bash" viewBox="0 0 24 24">
          <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
          <path d="M7 10 L10 12.5 L7 15" />
          <path d="M12.5 15.5h4.5" />
        </symbol>
        <symbol id="i-search" viewBox="0 0 24 24">
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="M15 15 L21 21" />
        </symbol>
        <symbol id="i-agent" viewBox="0 0 24 24">
          <path d="M12 2.5 L20.5 7.2 V16.8 L12 21.5 L3.5 16.8 V7.2Z" />
          <path d="M12 8 L16 12 L12 16 L8 12Z" />
        </symbol>
        <symbol id="i-hex" viewBox="0 0 24 24">
          <path d="M12 2.5 L20.5 7.2 V16.8 L12 21.5 L3.5 16.8 V7.2Z" />
        </symbol>
        <symbol id="i-plus" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" />
        </symbol>
        <symbol id="i-minus" viewBox="0 0 24 24">
          <path d="M5 12h14" />
        </symbol>
        <symbol id="i-fit" viewBox="0 0 24 24">
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </symbol>
        <symbol id="i-close" viewBox="0 0 24 24">
          <path d="M6 6 L18 18M18 6 L6 18" />
        </symbol>
      </defs>
    </svg>
  )
}
