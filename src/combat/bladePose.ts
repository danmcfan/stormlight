import * as THREE from 'three';
import type { Move, Moveset, Pose, Stance } from './moves';

const DEG = Math.PI / 180;

/** Unit vector for a body-space yaw/pitch in degrees (+Z forward, +X left, +Y up). */
export function dirFromAngles(yawDeg: number, pitchDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const y = yawDeg * DEG, p = pitchDeg * DEG;
  return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
}

/** Spherical interpolation between unit vectors (great-circle arc). */
export function slerpDir(a: THREE.Vector3, b: THREE.Vector3, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const d = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const ang = Math.acos(d);
  if (ang < 1e-4) return out.copy(a).lerp(b, t).normalize();
  const s = Math.sin(ang);
  const wa = Math.sin((1 - t) * ang) / s, wb = Math.sin(t * ang) / s;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).normalize();
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export interface BladePose {
  /** Blade direction, body space, unit length. */
  dir: THREE.Vector3;
  /** Hand distance from the shoulder pivot along `dir` (capped at arm length). */
  reach: number;
  /** Torso twist, radians. */
  twist: number;
  /** Both hands on the hilt: pivot sits nearer the chest centre. */
  twoHanded: boolean;
}

/**
 * Pose of a move at a (possibly fractional) frame. Segments that fall inside
 * the active window are linear (fast, even sweep); others ease in and out.
 */
export function movePose(m: Move, frame: number, out: BladePose = newPose()): BladePose {
  const k = m.keys;
  let i = 0;
  while (i < k.length - 2 && frame >= k[i + 1].f) i++;
  const a = k[i], b = k[i + 1];
  const span = Math.max(1e-6, b.f - a.f);
  let t = THREE.MathUtils.clamp((frame - a.f) / span, 0, 1);
  const activeFrom = m.windup, activeTo = m.windup + m.active;
  const inActive = a.f >= activeFrom - 0.01 && b.f <= activeTo + 0.01;
  if (!inActive) t = smooth(t);
  const da = dirFromAngles(a.yaw, a.pitch, tmpA), db = dirFromAngles(b.yaw, b.pitch, tmpB);
  slerpDir(da, db, t, out.dir);
  out.reach = (a.reach ?? 0.5) + ((b.reach ?? 0.5) - (a.reach ?? 0.5)) * t;
  out.twist = ((a.twist ?? 0) + ((b.twist ?? 0) - (a.twist ?? 0)) * t) * DEG;
  out.twoHanded = !!m.twoHanded;
  return out;
}

export function staticPose(p: Pose, twoHanded: boolean, out: BladePose = newPose()): BladePose {
  dirFromAngles(p.yaw, p.pitch, out.dir);
  out.reach = p.reach;
  out.twist = p.twist * DEG;
  out.twoHanded = twoHanded;
  return out;
}

export function newPose(): BladePose {
  return { dir: new THREE.Vector3(0, 0, 1), reach: 0.5, twist: 0, twoHanded: false };
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** The bits of fighter state the pose depends on. */
export interface PoseSource {
  state: string;
  stance: Stance;
  move: Move | null;
  frame: number;
}

/** Reaction poses: readable silhouettes for being hit, staggered or parried. */
const REACT: Record<string, Pose> = {
  hitstun: { yaw: -40, pitch: -45, reach: 0.45, twist: 15 },
  blockstun: { yaw: 75, pitch: 15, reach: 0.38, twist: 22 },
  stagger: { yaw: -60, pitch: -65, reach: 0.4, twist: 30 },
  parried: { yaw: -70, pitch: 115, reach: 0.5, twist: -35 },
  dead: { yaw: -30, pitch: -75, reach: 0.4, twist: 0 },
};

/** Where the weapon is right now for a fighter. */
export function currentPose(f: PoseSource, set: Moveset, out: BladePose = newPose()): BladePose {
  if (f.state === 'attack' && f.move) return movePose(f.move, f.frame, out);
  const two = set.twoHandedGuard[f.stance];
  if (f.state === 'block') {
    // Raise the guard over the first few frames.
    const t = smooth(Math.min(1, f.frame / 5));
    const g = staticPose(set.guard[f.stance], two, tmpPose);
    const b = staticPose(set.block, two, out);
    slerpDir(g.dir, b.dir, t, out.dir);
    out.reach = g.reach + (b.reach - g.reach) * t;
    out.twist = g.twist + (b.twist - g.twist) * t;
    return out;
  }
  const react = REACT[f.state];
  return staticPose(react ?? set.guard[f.stance], two, out);
}
const tmpPose = newPose();

/** Arm length (shoulder to grip) of the rig; reach is capped to this. */
export const ARM_REACH = 0.78;
const ONE_HAND_PIVOT = new THREE.Vector3(-0.42, 1.7, 0.02); // right shoulder
const TWO_HAND_PIVOT = new THREE.Vector3(-0.2, 1.62, 0.08); // between the shoulders

/**
 * Grip position in body space. The pivot is the (twisted) right shoulder for
 * one-handed poses, nearer the chest centre for two-handed ones, so the hand
 * is always within the arm's reach and the sword never floats.
 */
export function handPoint(pose: BladePose, out: THREE.Vector3): THREE.Vector3 {
  const p = pose.twoHanded ? TWO_HAND_PIVOT : ONE_HAND_PIVOT;
  const c = Math.cos(pose.twist), s = Math.sin(pose.twist);
  out.set(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  return out.addScaledVector(pose.dir, Math.min(pose.reach, ARM_REACH));
}

/**
 * World-space damaging segment of a weapon.
 * @param scale  fighter size multiplier (Parshendi are a bit smaller than Plate)
 */
export function bladeSegment(
  pose: BladePose, feet: THREE.Vector3, facing: number, hitFrom: number, hitTo: number,
  scale: number, outA: THREE.Vector3, outB: THREE.Vector3,
): void {
  const c = Math.cos(facing), s = Math.sin(facing);
  // Body → world: rotate about Y by `facing` (body +Z maps to (sin f, 0, cos f)).
  const toWorld = (v: THREE.Vector3, out: THREE.Vector3) =>
    out.set(feet.x + (v.x * c + v.z * s) * scale, feet.y + v.y * scale, feet.z + (-v.x * s + v.z * c) * scale);
  const hand = handPoint(pose, tmpHand);
  toWorld(tmpP.copy(hand).addScaledVector(pose.dir, hitFrom), outA);
  toWorld(tmpP.copy(hand).addScaledVector(pose.dir, hitTo), outB);
}
const tmpHand = new THREE.Vector3();
const tmpP = new THREE.Vector3();
