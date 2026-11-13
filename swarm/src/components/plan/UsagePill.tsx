import { Show, createSignal, onSettled } from 'solid-js'
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui-sdk/solid/tooltip'
import { useSwarm } from '../../lib/useSwarm'
import { formatCountdown } from './format'
import './plan.css'

const pct = (u: number | undefined) => (u === undefined ? '–' : `${Math.round(u * 100)}%`)
const level = (u: number | undefined) => (u === undefined ? 'none' : u >= 0.9 ? 'bad' : u >= 0.7 ? 'warn' : 'ok')

export async function refreshUsage(): Promise<string> {
  const res = await fetch('/api/usage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  const j = await res.json()
  if (j.error) return j.error
  return j.started ? 'Checking usage… it updates in about 20 seconds.' : (j.reason ?? 'Could not check usage.')
}

/** Your plan's 5-hour and 7-day usage at a glance, with a refresh. */
export function UsagePill(props: { compact?: boolean }) {
  const swarm = useSwarm()
  const [now, setNow] = createSignal(Date.now())
  const [note, setNote] = createSignal('')
  onSettled(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  })
  const latest = () => swarm.snapshot()?.plan?.latest
  const five = () => latest()?.fiveHour
  const seven = () => latest()?.sevenDay
  const age = () => {
    const at = latest()?.at
    if (!at) return 'never'
    const m = Math.round((now() - at) / 60_000)
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
  }
  const refresh = async () => {
    setNote('Checking…')
    setNote(await refreshUsage())
    setTimeout(() => setNote(''), 25_000)
  }

  return (
    <div class="usage-pill" data-compact={props.compact ? '' : undefined}>
      <Tooltip>
        <TooltipTrigger class="usage-readout" aria-label={`Plan usage: 5 hours ${pct(five()?.utilization)}, 7 days ${pct(seven()?.utilization)}`}>
          <span class="usage-win" data-level={level(five()?.utilization)}>
            <span class="usage-k">5h</span> {pct(five()?.utilization)}
          </span>
          <span class="usage-win" data-level={level(seven()?.utilization)}>
            <span class="usage-k">7d</span> {pct(seven()?.utilization)}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <Show when={latest()} fallback="No reading yet. Tap refresh.">
            5-hour window resets in {formatCountdown(five()?.resetsAt, now()) || '?'}, 7-day in{' '}
            {formatCountdown(seven()?.resetsAt, now()) || '?'}. Read {age()}.
          </Show>
        </TooltipContent>
      </Tooltip>
      <Show when={!props.compact}>
        <button type="button" class="usage-refresh" onClick={refresh} aria-label="Refresh plan usage">
          ↻
        </button>
      </Show>
      <Show when={note() && !props.compact}>
        <span class="usage-note" role="status">
          {note()}
        </span>
      </Show>
    </div>
  )
}
