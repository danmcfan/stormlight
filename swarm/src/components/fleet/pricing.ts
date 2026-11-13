import type { TokenUsage } from '../../lib/types'

// USD per million tokens: input, output, 5m cache write, 1h cache write, cache read.
type Rates = [number, number, number, number, number]

const OPUS: Rates = [5, 25, 6.25, 10, 0.5]
const OPUS_LEGACY: Rates = [15, 75, 18.75, 30, 1.5]
const SONNET: Rates = [3, 15, 3.75, 6, 0.3]
const HAIKU: Rates = [1, 5, 1.25, 2, 0.1]

function ratesFor(model: string): Rates {
  if (/opus-4(-1)?(-\d{8})?$/.test(model)) return OPUS_LEGACY
  if (model.includes('opus')) return OPUS
  if (model.includes('haiku')) return HAIKU
  return SONNET
}

export interface CostSplit {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/**
 * Splits a known total cost across the token classes by list-price weight, so
 * the parts always add up to the server's number.
 */
export function splitCost(model: string, u: TokenUsage, totalUsd: number): CostSplit {
  const r = ratesFor(model)
  const raw = {
    input: (u.input * r[0]) / 1e6,
    output: (u.output * r[1]) / 1e6,
    cacheWrite: (u.cacheWrite5m * r[2] + u.cacheWrite1h * r[3]) / 1e6,
    cacheRead: (u.cacheRead * r[4]) / 1e6,
  }
  const sum = raw.input + raw.output + raw.cacheWrite + raw.cacheRead
  const k = sum > 0 ? totalUsd / sum : 0
  return {
    input: raw.input * k,
    output: raw.output * k,
    cacheWrite: raw.cacheWrite * k,
    cacheRead: raw.cacheRead * k,
  }
}
