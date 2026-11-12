import * as THREE from 'three';

/**
 * Closest distance between segments p1-q1 and p2-q2 (Ericson, Real-Time
 * Collision Detection §5.1.9). Optionally writes the closest point on the
 * first segment to `outPoint`.
 */
export function segmentDistance(
  p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, outPoint?: THREE.Vector3,
): number {
  const d1 = _d1.subVectors(q1, p1), d2 = _d2.subVectors(q2, p2), r = _r.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s: number, t: number;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) { s = t = 0; }
  else if (a <= EPS) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= EPS) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = _c1.copy(p1).addScaledVector(d1, s);
  const c2 = _c2.copy(p2).addScaledVector(d2, t);
  if (outPoint) outPoint.copy(c1);
  return c1.distanceTo(c2);
}
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3();
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();

export interface Capsule {
  bottom: THREE.Vector3;
  top: THREE.Vector3;
  radius: number;
}

/**
 * Did a blade moving from segment (a0,b0) to (a1,b1) during one tick touch
 * the capsule? Samples intermediate segments so fast swings can't tunnel
 * through a target between frames. Writes the contact point on the blade.
 */
export function sweptBladeHits(
  a0: THREE.Vector3, b0: THREE.Vector3, a1: THREE.Vector3, b1: THREE.Vector3,
  cap: Capsule, samples: number, contact: THREE.Vector3,
): boolean {
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    _sa.lerpVectors(a0, a1, t);
    _sb.lerpVectors(b0, b1, t);
    if (segmentDistance(_sa, _sb, cap.bottom, cap.top, contact) <= cap.radius) return true;
  }
  return false;
}
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3();
