import type { TokenUsage } from '../../lib/types'

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  const k = Math.round(n / 100) / 10
  if (k < 1000) return `${stripZero(k)}k`
  const m = Math.round(n / 100_000) / 10
  if (m < 1000) return `${stripZero(m)}M`
  return `${stripZero(Math.round(n / 100_000_000) / 10)}B`
}

function stripZero(x: number): string {
  return x.toFixed(1).replace(/\.0$/, '')
}

export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatRelative(at: number, now: number): string {
  const diff = Math.max(0, now - at)
  if (diff < 5000) return 'just now'
  const total = Math.floor(diff / 1000)
  if (total < 60) return `${total}s ago`
  const m = Math.floor(total / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function formatClock(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** claude-sonnet-5-5-20260101 -> sonnet-5-5 */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead
}

export function cacheWrite(u: TokenUsage): number {
  return u.cacheWrite5m + u.cacheWrite1h
}
