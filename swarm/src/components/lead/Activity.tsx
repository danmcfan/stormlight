import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { useSwarm } from '../../lib/useSwarm'
import { selectActivity, totalCalls } from './activity-model'
import { Gem } from '../frame/Gem'
import { StatusDot } from '../fleet/StatusDot'
import { shortModel } from '../fleet/format'
import './activity.css'

/**
 * "What the lead is doing right now": a compact, collapsible stream of its
 * tool calls and the subagents it launched, in [from, to]. Renders nothing
 * when there is no matching lead agent or nothing happened in the window.
 */
export function Activity(props: {
  sessionId: () => string | null | undefined
  from: () => number
  to: () => number | undefined
  live: () => boolean
}) {
  const { snapshot } = useSwarm()
  const sel = createMemo(() => selectActivity(snapshot(), props.sessionId(), props.from(), props.to()))
  const isEmpty = createMemo(
    () => !sel().lead || (sel().calls.length === 0 && sel().subagents.length === 0),
  )

  const [expanded, setExpanded] = createSignal(props.live())
  // A new run (new `from`) resets the default: open while live, closed once done.
  createEffect(
    () => props.from(),
    () => {
      setExpanded(props.live())
    },
  )

  let feedRef: HTMLUListElement | undefined
  createEffect(
    () => totalCalls(sel()),
    () => {
      if (props.live() && feedRef) feedRef.scrollTop = feedRef.scrollHeight
    },
  )

  return (
    <Show when={!isEmpty()}>
      <div class="lead-activity">
        <button
          type="button"
          class="lead-activity-head"
          aria-expanded={expanded() ? 'true' : 'false'}
          onClick={() => setExpanded((e) => !e)}
        >
          <span class="lead-activity-glyph" aria-hidden="true">
            <Gem
              kind={sel().lead!.status === 'done' ? 'set' : sel().lead!.status === 'error' ? 'dead' : 'live'}
            />
          </span>
          <span class="lead-activity-summary">
            {totalCalls(sel())} tools · {sel().subagents.length} agents
          </span>
          <Show when={props.live() && sel().lead!.currentActivity}>
            <span class="lead-activity-now">{sel().lead!.currentActivity}</span>
          </Show>
          <span class="lead-activity-chevron" aria-hidden="true">
            ▸
          </span>
        </button>

        <Show when={expanded()}>
          <div class="lead-activity-body">
            <ul class="lead-activity-calls" ref={feedRef}>
              <Show when={sel().earlierCount > 0}>
                <li class="lead-activity-earlier">+{sel().earlierCount} earlier</li>
              </Show>
              <For each={sel().calls}>
                {(g) => (
                  <li class="lead-activity-call">
                    <span class="lead-activity-tag">
                      {g.name}
                      {g.count > 1 ? ` ×${g.count}` : ''}
                    </span>
                    <span class="lead-activity-call-summary">{g.summary}</span>
                  </li>
                )}
              </For>
            </ul>

            <Show when={sel().subagents.length > 0}>
              <ul class="lead-activity-agents">
                <For each={sel().subagents}>
                  {(a) => (
                    <li class="lead-activity-agent" data-status={a.status}>
                      <StatusDot status={a.status} />
                      <span class="lead-activity-agent-desc">{a.description ?? a.label}</span>
                      <span class="lead-activity-agent-model">{shortModel(a.model)}</span>
                      <Show when={a.status === 'running' && a.currentActivity}>
                        <span class="lead-activity-agent-now">{a.currentActivity}</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}
