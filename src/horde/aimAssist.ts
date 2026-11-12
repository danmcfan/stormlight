import { angleDiff, headingOf } from '../core/math';

export interface AimCandidate {
  id: number;
  x: number;
  z: number;
}

export interface AimParams {
  /** Half-angle of the search cone, degrees. */
  coneDeg: number;
  /** Metres. */
  range: number;
  /** How much distance matters against angle (0 = pure angle). */
  distanceWeight: number;
}

/**
 * Pick the warrior a swing should turn toward: inside a cone around the
 * direction the player is pushing (or facing), within range, scored by angle
 * off that direction plus distance. Returns null when nothing qualifies, so
 * the swing goes exactly where the stick says.
 */
export function chooseAimTarget(
  px: number, pz: number, dirHeading: number, list: readonly AimCandidate[], p: AimParams,
): AimCandidate | null {
  const cone = (p.coneDeg * Math.PI) / 180;
  let best: AimCandidate | null = null;
  let bestScore = Infinity;
  for (const c of list) {
    const dx = c.x - px, dz = c.z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist > p.range) continue;
    // Someone standing on top of you is always a fair target.
    const off = dist < 0.4 ? 0 : Math.abs(angleDiff(headingOf(dx, dz), dirHeading));
    if (off > cone) continue;
    const score = off / Math.max(cone, 1e-3) + p.distanceWeight * (dist / p.range);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}
