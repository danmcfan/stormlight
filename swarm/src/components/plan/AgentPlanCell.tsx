import type { Agent } from '../../lib/types'
import { formatPoints } from './format'
import './plan.css'

/**
 * Compact plan share of one agent: "1.9% · 5h  0.4% · 7d". Shows an em dash
 * when there are no plan readings. Values are estimates (see PlanUsageSummary).
 */
export function AgentPlanCell(props: { agent: Pick<Agent, 'plan'> }) {
  const p = () => props.agent.plan
  return (
    <span class="plan-cell" title="Estimated share of your plan windows, by API-equivalent cost">
      {p() ? (
        <>
          <span>{formatPoints(p()!.fiveHour)} · 5h</span>
          <span>{formatPoints(p()!.sevenDay)} · 7d</span>
        </>
      ) : (
        <span data-empty>--</span>
      )}
    </span>
  )
}
