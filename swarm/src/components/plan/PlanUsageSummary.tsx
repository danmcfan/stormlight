import { Show, createSignal } from 'solid-js'
import { onSettled } from 'solid-js'
import { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue } from '@ui-sdk/solid/meter'
import { useSwarm } from '../../lib/useSwarm'
import type { PlanWindowUsage, SwarmSnapshot } from '../../lib/types'
import { formatCost } from '../fleet/format'
import { formatCountdown, formatPoints } from './format'
import './plan.css'

function level(u: number): 'ok' | 'warn' | 'bad' {
  return u >= 0.9 ? 'bad' : u >= 0.7 ? 'warn' : 'ok'
}

function WindowMeter(props: { label: string; usage?: PlanWindowUsage; now: number; fallback?: { utilization: number; resetsAt?: number } }) {
  const util = () => props.usage?.latestUtilization ?? props.fallback?.utilization
  const resets = () => props.usage?.resetsAt ?? props.fallback?.resetsAt
  return (
    <Show when={util() !== undefined} fallback={<div class="plan-meter plan-meter-sub">{props.label}: no reading</div>}>
      <Meter class="plan-meter" value={Math.round(util()! * 100)} data-level={level(util()!)}>
        <div class="plan-meter-head">
          <MeterLabel>{props.label}</MeterLabel>
          <MeterValue />
        </div>
        <MeterTrack class="plan-track">
          <MeterIndicator class="plan-fill" />
        </MeterTrack>
        <span class="plan-meter-sub">
          <Show when={resets() !== undefined}>resets in {formatCountdown(resets(), props.now)} · </Show>
          this run used <b>{props.usage ? formatPoints(props.usage.pointsUsed) : '--'}</b>
        </span>
      </Meter>
    </Show>
  )
}

/**
 * Subscription-limit usage: 5-hour and 7-day meters with reset countdowns, the
 * points the session used, API-equivalent $ per 1% of the 5-hour window, and the
 * estimate caveat. Pass `sessionId` to pick a session (default: most recently
 * active) and `snapshot` to reuse a snapshot the parent already holds.
 */
export function PlanUsageSummary(props: { sessionId?: string; snapshot?: SwarmSnapshot }) {
  const swarm = useSwarm()
  const [now, setNow] = createSignal(Date.now())
  onSettled(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  })
  const snap = () => props.snapshot ?? swarm.snapshot()
  const plan = () => snap()?.plan
  const session = () => {
    const s = snap()
    return s?.sessions.find((x) => x.id === props.sessionId) ?? s?.sessions[0]
  }

  return (
    <section class="plan-summary" aria-label="Plan usage">
      <Show when={plan()} fallback={<p class="note">No plan readings yet.</p>}>
        <div class="plan-meters">
          <WindowMeter label="5-hour window" usage={session()?.plan?.fiveHour} fallback={plan()!.latest?.fiveHour} now={now()} />
          <WindowMeter label="7-day window" usage={session()?.plan?.sevenDay} fallback={plan()!.latest?.sevenDay} now={now()} />
        </div>
        <Show when={session()?.plan?.costPerFiveHourPoint}>
          {(c) => (
            <p class="plan-meter-sub">
              <b>{formatCost(c())}</b> API-equivalent per 1% of the 5-hour window
            </p>
          )}
        </Show>
        <p class="note">{plan()!.note}</p>
      </Show>
    </section>
  )
}
