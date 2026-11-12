export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a <= 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed angle that takes `from` to `to`. */
export function angleDiff(to: number, from: number): number {
  return wrapAngle(to - from);
}

/** Move `cur` toward `target` by at most `maxDelta`. */
export function approach(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return Math.min(cur + maxDelta, target);
  return Math.max(cur - maxDelta, target);
}

/** Rotate angle `cur` toward `target` by at most `maxDelta` along the shortest path. */
export function approachAngle(cur: number, target: number, maxDelta: number): number {
  const d = angleDiff(target, cur);
  if (Math.abs(d) <= maxDelta) return wrapAngle(target);
  return wrapAngle(cur + Math.sign(d) * maxDelta);
}

/** Frame-rate independent exponential smoothing. */
export function damp(cur: number, target: number, lambda: number, dt: number): number {
  return lerp(cur, target, 1 - Math.exp(-lambda * dt));
}

export function dampAngle(cur: number, target: number, lambda: number, dt: number): number {
  return wrapAngle(cur + angleDiff(target, cur) * (1 - Math.exp(-lambda * dt)));
}

/**
 * Heading convention used throughout: an angle `a` points along (sin a, 0, cos a).
 * So angle 0 faces +Z, which matches Object3D.rotation.y.
 */
export function headingOf(x: number, z: number): number {
  return Math.atan2(x, z);
}

/** Deterministic PRNG so the plateau looks the same every load. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
