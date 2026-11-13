import { For } from 'solid-js'
import type { SwarmSnapshot } from '../../lib/types'
import { cacheWrite, formatCost, formatTokens, shortModel, totalTokens } from './format'

export function Totals(props: { snapshot: SwarmSnapshot }) {
  const t = () => props.snapshot.totals
  const running = () => props.snapshot.agents.filter((a) => a.status === 'running').length
  const models = () =>
    Object.entries(t().byModel).sort((a, b) => b[1].costUsd - a[1].costUsd)

  return (
    <section class="totals" aria-label="Totals">
      <dl class="stats">
        <div class="stat stat-cost">
          <dt>
            Est. cost
          </dt>
          <dd>{formatCost(t().costUsd)}</dd>
        </div>
        <div class="stat">
          <dt>Agents running</dt>
          <dd>
            <span data-live={running() > 0 ? '' : undefined}>{running()}</span>
            <span class="stat-of"> / {props.snapshot.agents.length}</span>
          </dd>
        </div>
        <div class="stat">
          <dt>Tokens in</dt>
          <dd>{formatTokens(t().usage.input)}</dd>
        </div>
        <div class="stat">
          <dt>Tokens out</dt>
          <dd>{formatTokens(t().usage.output)}</dd>
        </div>
        <div class="stat">
          <dt>Cache write</dt>
          <dd>{formatTokens(cacheWrite(t().usage))}</dd>
        </div>
        <div class="stat">
          <dt>Cache read</dt>
          <dd>{formatTokens(t().usage.cacheRead)}</dd>
        </div>
      </dl>

      <div class="models">
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
