/**
 * Attack tokens (God of War / Arkham style): only a few warriors may swing at
 * the Shardbearer at once. Tokens are handed to *pairs*; a pair holding two
 * lets both partners commit, a pair holding one has one partner strike while
 * the other feints.
 */
export interface TokenRequest {
  /** Pair id. */
  id: number;
  /** Tokens this pair would like (0..2+). 0 = not asking (and releases any held). */
  want: number;
  /** Tokens it already holds (kept while still wanted). */
  held: number;
  /** Higher = served first (waited longer, closer, a vengeful survivor...). */
  priority: number;
}

/**
 * Decide how many tokens each pair holds. Holders keep what they still want;
 * free tokens go out highest priority first, one per pair in a first pass so
 * more pairs get a turn, then extras in a second pass.
 */
export function allocateTokens(reqs: readonly TokenRequest[], maxTokens: number): Map<number, number> {
  const out = new Map<number, number>();
  let free = Math.max(0, Math.floor(maxTokens));
  // Holders first (in priority order, in case the cap was lowered live).
  const byPriority = [...reqs].sort((a, b) => b.priority - a.priority || a.id - b.id);
  for (const r of byPriority) {
    const keep = Math.min(r.held, r.want, free);
    out.set(r.id, keep);
    free -= keep;
  }
  for (const pass of [1, Infinity]) {
    for (const r of byPriority) {
      if (free <= 0) return out;
      const have = out.get(r.id)!;
      const target = Math.min(r.want, pass === 1 ? Math.max(have, 1) : r.want);
      const give = Math.min(free, Math.max(0, target - have));
      if (give > 0) { out.set(r.id, have + give); free -= give; }
    }
  }
  return out;
}
