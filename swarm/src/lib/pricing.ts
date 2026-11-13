import type { TokenUsage } from './types'

/** USD per million tokens. */
export interface ModelPrice {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

function price(input: number, output: number, cacheReadMult = 0.1): ModelPrice {
  return {
    input,
    output,
    cacheWrite5m: input * 1.25,
    cacheWrite1h: input * 2,
    cacheRead: input * cacheReadMult,
  }
}

/** List prices by exact model id. */
export const PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': price(4, 20, 0.05),
  'claude-sonnet-5-5': price(2, 10),
  'claude-haiku-5-5': price(0.1, 0.5),
  'claude-fable-5-2': price(8, 40),
  'claude-opus-5': price(5, 25),
  'claude-sonnet-5': price(2, 10),
  'claude-haiku-4-5': price(1, 5),
}

/** Used when only the family is recognised. */
const FAMILY_PRICES: Record<string, ModelPrice> = {
  opus: PRICES['claude-opus-5-5'],
  sonnet: PRICES['claude-sonnet-5-5'],
  haiku: PRICES['claude-haiku-5-5'],
  fable: PRICES['claude-fable-5-2'],
}

export const pricingNote =
  'Estimated from Anthropic list API prices; subscription plans are billed differently.'

export interface PriceLookup {
  price: ModelPrice | null
  /** True when the model was not an exact match (family guess or unknown). */
  approximate: boolean
}

export function lookupPrice(model: string | undefined): PriceLookup {
  if (!model) return { price: null, approximate: true }
  // Strip date suffixes and context-window tags: claude-sonnet-5-5-20260101, ...[1m]
  const id = model.toLowerCase().replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
  const exact = PRICES[id]
  if (exact) return { price: exact, approximate: false }
  for (const family of Object.keys(FAMILY_PRICES)) {
    if (id.includes(family)) return { price: FAMILY_PRICES[family], approximate: true }
  }
  return { price: null, approximate: true }
}

/** True when cost for this model is a guess or zero (unknown model). */
export function isPriceUncertain(model: string | undefined): boolean {
  return lookupPrice(model).approximate
}

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }
}

export function addUsage(into: TokenUsage, u: TokenUsage): TokenUsage {
  into.input += u.input
  into.output += u.output
  into.cacheWrite5m += u.cacheWrite5m
  into.cacheWrite1h += u.cacheWrite1h
  into.cacheRead += u.cacheRead
  return into
}

/** Estimated USD cost of one usage record for a model. Unknown models cost 0. */
export function costOf(model: string | undefined, usage: TokenUsage): number {
  const { price: p } = lookupPrice(model)
  if (!p) return 0
  return (
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheWrite5m * p.cacheWrite5m +
      usage.cacheWrite1h * p.cacheWrite1h +
      usage.cacheRead * p.cacheRead) /
    1_000_000
  )
}
