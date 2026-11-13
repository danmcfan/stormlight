import { For } from 'solid-js'
import type { SwarmSnapshot } from '../../lib/types'
import { cacheWrite, formatCost, formatTokens, shortModel, totalTokens } from './format'

const MAX_PIPS = 16

export function Totals(props: { snapshot: SwarmSnapshot }) {
  const t = () => props.snapshot.totals
  const total = () => props.snapshot.agents.length
  const running = () => props.snapshot.agents.filter((a) => a.status === 'running').length
  const pips = () => Array.from({ length: Math.min(total(), MAX_PIPS) }, (_, i) => i < running())
  const models = () => Object.entries(t().byModel).sort((a, b) => b[1].costUsd - a[1].costUsd)

  return (
    <section class="totals" aria-label="Totals">
      <dl class="tile">
        <dt class="lbl">Est. cost</dt>
        <dd class="big">{formatCost(t().costUsd)}</dd>
      </dl>

      <div class="tile">
        <h3 class="lbl">Tokens</h3>
        <dl class="tok">
          <div>
            <dt class="lbl">In</dt>
            <dd>{formatTokens(t().usage.input)}</dd>
          </div>
          <div>
            <dt class="lbl">Out</dt>
            <dd>{formatTokens(t().usage.output)}</dd>
          </div>
          <div>
            <dt class="lbl">Cache write</dt>
            <dd>{formatTokens(cacheWrite(t().usage))}</dd>
          </div>
          <div>
            <dt class="lbl">Cache read</dt>
            <dd>{formatTokens(t().usage.cacheRead)}</dd>
          </div>
        </dl>
      </div>

      <dl class="tile">
        <dt class="lbl">Agents running</dt>
        <dd class="big">
          <span data-live={running() > 0 ? '' : undefined}>{running()}</span>
          <small>of {total()}</small>
        </dd>
        <dd class="pips" aria-hidden="true">
          <For each={pips()}>{(on) => <i class={on ? '' : 'off'} />}</For>
        </dd>
      </dl>

      <div class="tile models">
        <table class="mini">
          <caption class="sr-only">Usage by model</caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col" class="num">Tokens</th>
              <th scope="col" class="num">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            <For each={models()} keyed={(m) => m[0]}>
              {(m) => (
                <tr>
                  <th scope="row" class="mono">{shortModel(m()[0])}</th>
                  <td class="num">{formatTokens(totalTokens(m()[1].usage))}</td>
                  <td class="num">{formatCost(m()[1].costUsd)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <p class="note">est. {props.snapshot.pricingNote}</p>
      </div>
    </section>
  )
}
