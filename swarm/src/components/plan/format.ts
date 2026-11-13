/** Percentage points -> "1.9%"; "<0.1%" for tiny nonzero values. */
export function formatPoints(p: number | undefined): string {
  if (p === undefined || !Number.isFinite(p)) return '--'
  if (p <= 0) return '0%'
  if (p < 0.1) return '<0.1%'
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`
}

/** "2h 14m" / "3d 4h" until `at`, or "now" once passed. */
export function formatCountdown(at: number | undefined, now: number): string {
  if (at === undefined) return ''
  const ms = at - now
  if (ms <= 0) return 'now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${Math.max(m, 1)}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
