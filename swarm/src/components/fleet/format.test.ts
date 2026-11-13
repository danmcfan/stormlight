import { describe, expect, it } from 'vitest'
import { formatCost, formatDuration, formatRelative, formatTokens, shortModel } from './format'

describe('formatTokens', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(12_345)).toBe('12.3k')
    expect(formatTokens(1_000)).toBe('1k')
    expect(formatTokens(1_234_567)).toBe('1.2M')
    expect(formatTokens(999_960)).toBe('1M')
  })
})

describe('formatCost', () => {
  it('uses four decimals below a cent and two above', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(0.0004)).toBe('$0.0004')
    expect(formatCost(0.0099)).toBe('$0.0099')
    expect(formatCost(0.01)).toBe('$0.01')
    expect(formatCost(3.456)).toBe('$3.46')
    expect(formatCost(1234.5)).toBe('$1,234.50')
  })
})

describe('formatDuration', () => {
  it('reads like 3m 12s', () => {
    expect(formatDuration(-5)).toBe('0s')
    expect(formatDuration(12_000)).toBe('12s')
    expect(formatDuration(192_000)).toBe('3m 12s')
    expect(formatDuration(3_900_000)).toBe('1h 5m')
  })
})

describe('formatRelative', () => {
  it('counts back from now', () => {
    expect(formatRelative(1000, 2000)).toBe('just now')
    expect(formatRelative(0, 90_000)).toBe('1m ago')
    expect(formatRelative(0, 7_200_000)).toBe('2h ago')
  })
})

describe('shortModel', () => {
  it('drops the vendor prefix and date', () => {
    expect(shortModel('claude-sonnet-5-5')).toBe('sonnet-5-5')
    expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
  })
})
