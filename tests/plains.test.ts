import { describe, expect, it } from 'vitest';
import { buildLayout, polyArea, type V2 } from '../src/world/plainsLayout';

/** Smallest distance between two convex polygons (they must not overlap). */
function polyDistance(a: V2[], b: V2[]): number {
  const segDist = (p: V2, s0: V2, s1: V2) => {
    const ex = s1.x - s0.x, ez = s1.z - s0.z;
    const t = Math.max(0, Math.min(1, ((p.x - s0.x) * ex + (p.z - s0.z) * ez) / (ex * ex + ez * ez)));
    return Math.hypot(p.x - (s0.x + ex * t), p.z - (s0.z + ez * t));
  };
  let d = Infinity;
  for (const [P, Q] of [[a, b], [b, a]]) {
    for (const p of P) for (let i = 0; i < Q.length; i++) d = Math.min(d, segDist(p, Q[i], Q[(i + 1) % Q.length]));
  }
  return d;
}

describe('Shattered Plains layout', () => {
  const L = buildLayout();

  it('is hundreds of slabs, tightly packed', () => {
    expect(L.cells.length).toBeGreaterThan(300);
    const near = L.cells.filter((c) => c.kind === 'plain' && c.dist < 120);
    expect(near.length).toBeGreaterThan(15);
  });

  it('keeps an assault plateau big enough for the horde', () => {
    const a = polyArea(L.main.poly);
    expect(a).toBeGreaterThan(Math.PI * 32 * 32);
    expect(a).toBeLessThan(Math.PI * 52 * 52);
  });

  it('puts the bridge chasm between the staging and assault plateaus', () => {
    const gap = -L.stagingZ - L.mainNorthEdge - L.stagingSouthEdge;
    expect(gap).toBeCloseTo(11, 3);
    expect(L.mainNorthEdge).toBeGreaterThan(32);
  });

  it('separates every slab from its neighbours by a chasm', () => {
    const main = L.main.poly;
    for (const c of L.cells) {
      if (c === L.main) continue;
      if (Math.hypot(c.site.x, c.site.z) > 140) continue;
      const d = polyDistance(main, c.poly);
      expect(d).toBeGreaterThan(c.kind === 'staging' ? 10.9 : 6.4);
    }
    const near = L.cells.filter((c) => c.dist < 200);
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j];
      if (Math.hypot(a.site.x - b.site.x, a.site.z - b.site.z) > 120) continue;
      expect(polyDistance(a.poly, b.poly)).toBeGreaterThan(2);
    }
  });

  it('is deterministic', () => {
    const again = buildLayout();
    expect(again.cells.length).toBe(L.cells.length);
    expect(again.main.poly).toEqual(L.main.poly);
  });
});
