import { describe, expect, it } from 'vitest';
import { chooseAimTarget } from '../src/horde/aimAssist';
import { killFeel, type KillFeelParams } from '../src/horde/killFeel';
import { allocateTokens } from '../src/horde/tokens';
import { waveSize } from '../src/horde/waves';

describe('attack tokens', () => {
  const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  it('never hands out more than the cap', () => {
    const reqs = [1, 2, 3, 4, 5].map((id) => ({ id, want: 2, held: 0, priority: id }));
    for (const cap of [0, 1, 2, 3, 5]) expect(total(allocateTokens(reqs, cap))).toBe(Math.min(cap, 10));
  });

  it('gives one token per pair before anyone gets a second', () => {
    const reqs = [{ id: 1, want: 2, held: 0, priority: 9 }, { id: 2, want: 2, held: 0, priority: 5 }, { id: 3, want: 2, held: 0, priority: 1 }];
    const m = allocateTokens(reqs, 3);
    expect([m.get(1), m.get(2), m.get(3)]).toEqual([1, 1, 1]);
    const m2 = allocateTokens(reqs, 4);
    expect([m2.get(1), m2.get(2), m2.get(3)]).toEqual([2, 1, 1]);
  });

  it('holders keep their tokens over higher-priority newcomers', () => {
    const m = allocateTokens([{ id: 1, want: 2, held: 2, priority: 0 }, { id: 2, want: 2, held: 0, priority: 99 }], 3);
    expect(m.get(1)).toBe(2);
    expect(m.get(2)).toBe(1);
  });

  it('releases tokens a pair no longer wants', () => {
    const m = allocateTokens([{ id: 1, want: 0, held: 2, priority: 5 }, { id: 2, want: 2, held: 0, priority: 1 }], 2);
    expect(m.get(1)).toBe(0);
    expect(m.get(2)).toBe(2);
  });

  it('a lowered cap trims holders lowest priority first', () => {
    const m = allocateTokens([{ id: 1, want: 2, held: 2, priority: 1 }, { id: 2, want: 1, held: 1, priority: 5 }], 2);
    expect(m.get(2)).toBe(1);
    expect(m.get(1)).toBe(1);
  });
});

describe('aim assist', () => {
  const p = { coneDeg: 55, range: 5, distanceWeight: 0.6 };
  // Heading 0 = +Z.
  it('turns toward a warrior inside the cone', () => {
    expect(chooseAimTarget(0, 0, 0, [{ id: 1, x: 1.5, z: 2.5 }], p)?.id).toBe(1);
  });
  it('ignores warriors behind, outside the cone or out of range', () => {
    expect(chooseAimTarget(0, 0, 0, [{ id: 1, x: 0, z: -2 }, { id: 2, x: 3, z: 0.5 }, { id: 3, x: 0, z: 7 }], p)).toBeNull();
  });
  it('prefers the one nearest the pushed direction', () => {
    const list = [{ id: 1, x: 1.6, z: 2 }, { id: 2, x: 0.2, z: 3 }];
    expect(chooseAimTarget(0, 0, 0, list, p)?.id).toBe(2);
    // Push toward +X (heading +90°): now the first is closer to the stick.
    expect(chooseAimTarget(0, 0, Math.PI / 4, list, p)?.id).toBe(1);
  });
  it('prefers the nearer of two at the same angle', () => {
    expect(chooseAimTarget(0, 0, 0, [{ id: 1, x: 0, z: 4.5 }, { id: 2, x: 0, z: 2 }], p)?.id).toBe(2);
  });
  it('always accepts someone standing on top of you', () => {
    expect(chooseAimTarget(0, 0, 0, [{ id: 1, x: -0.1, z: -0.2 }], p)?.id).toBe(1);
  });
});

describe('kill feel', () => {
  const p: KillFeelParams = {
    baseStop: 11, window: 1.2, falloff: 0.8, minScale: 0.15, baseShake: 0.09,
    multiStop: 6, multiSlowmo: 0.45, waveSlowmo: 1.1, slowmoScale: 0.3,
  };
  it('a lone kill gets the full freeze and no slow-mo', () => {
    expect(killFeel(0, 1, false, p)).toMatchObject({ hitStop: 11, slowmo: 0 });
  });
  it('rapid kills freeze less and less, down to a floor', () => {
    const stops = [0, 1, 2, 4, 20].map((n) => killFeel(n, 1, false, p).hitStop);
    for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeLessThanOrEqual(stops[i - 1]);
    expect(stops[1]).toBeLessThan(11);
    expect(stops[4]).toBe(Math.round(11 * 0.15));
  });
  it('the second kill of one swing is a big moment, even mid-crowd', () => {
    const k = killFeel(6, 2, false, p);
    expect(k.hitStop).toBe(17);
    expect(k.slowmo).toBeGreaterThan(0);
    expect(k.slowmoScale).toBeLessThan(1);
    // A third kill in the same swing doesn't restart it.
    expect(killFeel(6, 3, false, p).slowmo).toBe(0);
  });
  it('the last kill of a wave gets the longest slow-mo', () => {
    const k = killFeel(5, 1, true, p);
    expect(k.slowmo).toBe(1.1);
    expect(k.hitStop).toBe(17);
  });
});

describe('waves', () => {
  const p = { waveStart: 4, waveGrowth: 6, waveMax: 38 };
  it('grows from a few pairs to the cap, always in pairs', () => {
    const sizes = [1, 2, 3, 7, 30].map((w) => waveSize(w, p));
    expect(sizes[0]).toBe(4);
    expect(sizes[1]).toBe(10);
    expect(sizes[4]).toBe(38);
    for (const s of sizes) expect(s % 2).toBe(0);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
  });
});
