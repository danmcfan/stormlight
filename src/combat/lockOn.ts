import { angleDiff, headingOf } from '../core/math';

export interface LockCandidate {
  id: number;
  x: number;
  z: number;
}

interface Scored {
  c: LockCandidate;
  dist: number;
  /** Angle relative to camera forward; positive = to the LEFT, negative = to the RIGHT. */
  rel: number;
}

function score(px: number, pz: number, cameraYaw: number, list: LockCandidate[], range: number): Scored[] {
  const out: Scored[] = [];
  for (const c of list) {
    const dx = c.x - px, dz = c.z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist > range || dist < 0.001) continue;
    out.push({ c, dist, rel: angleDiff(headingOf(dx, dz), cameraYaw) });
  }
  return out;
}

/** Max angle off camera-forward that can be acquired (110°). */
const ACQUIRE_CONE = (110 * Math.PI) / 180;

/**
 * Pick what the player most likely means: something near the centre of the
 * view, nearer preferred. Returns null if nothing is in range and in view.
 */
export function selectTarget(px: number, pz: number, cameraYaw: number, list: LockCandidate[], range: number): LockCandidate | null {
  let best: Scored | null = null;
  let bestScore = Infinity;
  for (const s of score(px, pz, cameraYaw, list, range)) {
    const off = Math.abs(s.rel);
    if (off > ACQUIRE_CONE) continue;
    const sc = s.dist / range + (off / Math.PI) * 2.5;
    if (sc < bestScore) { bestScore = sc; best = s; }
  }
  return best ? best.c : null;
}

/**
 * Switch to the next target to the right (dir = 1) or left (dir = -1) of the
 * current one, judged by angle around the player from the camera's view.
 * Returns the current target if there is nothing further in that direction.
 */
export function switchTarget(
  px: number, pz: number, cameraYaw: number,
  current: LockCandidate, list: LockCandidate[], range: number, dir: 1 | -1,
): LockCandidate {
  const all = score(px, pz, cameraYaw, list, range);
  const curRel = angleDiff(headingOf(current.x - px, current.z - pz), cameraYaw);
  let best: Scored | null = null;
  for (const s of all) {
    if (s.c.id === current.id) continue;
    // Right = smaller (more negative) relative angle.
    const delta = dir === 1 ? curRel - s.rel : s.rel - curRel;
    if (delta <= 0.01) continue;
    if (!best) { best = s; continue; }
    const bestDelta = dir === 1 ? curRel - best.rel : best.rel - curRel;
    if (delta < bestDelta) best = s;
  }
  return best ? best.c : current;
}
