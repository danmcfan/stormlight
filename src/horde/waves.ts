/** Warriors in wave `n` (1-based): grows linearly to a cap, always whole pairs. */
export function waveSize(n: number, p: { waveStart: number; waveGrowth: number; waveMax: number }): number {
  const raw = Math.min(p.waveMax, p.waveStart + p.waveGrowth * (n - 1));
  return Math.max(2, Math.round(raw / 2) * 2);
}
