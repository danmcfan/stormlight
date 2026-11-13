/**
 * Pose the Shardplate pieces the way src/render/humanoid.ts does.
 *
 * The GLB stores each piece's geometry relative to its own joint, not in a body pose (no
 * skinning: the game parents each piece to the group for its bone). So a viewer that just
 * drops the GLB on the origin shows a pile at the middle. These constants are copied from
 * humanoid.ts; if the skeleton moves there, move them here (and the Blender scripts read
 * the same file through scripts/blender/skeleton.py).
 */

export const SKELETON = {
  HIP_Y: 1.0,
  WAIST_Y: 1.08,
  SHOULDER: { x: 0.42, y: 0.62 }, // from the waist
  UPPER_ARM: 0.35,
  LOWER_ARM: 0.36,
  THIGH: 0.4,
  SHIN: 0.53,
  HELM_Y: 0.92, // from the waist
  LEG_X: 0.25,
  FAULD_Y: 1.22,
  FAULD_FRONT_Z: 0.3,
  FAULD_BACK_Z: -0.26,
  TASSET_X: 0.3,
  TASSET_Y: 1.24,
};

export type Pose = {
  /** Arm abduction from hanging, degrees (the compare renders use 45, the game's rest is 0). */
  arm: number;
  /** Elbow bend, degrees (negative folds the forearm forward). */
  elbow: number;
  /** Leg splay, degrees. */
  leg: number;
};

export const REST: Pose = { arm: 0, elbow: 0, leg: 0 };
export const APOSE: Pose = { arm: 30, elbow: -20, leg: 4 };

const D = Math.PI / 180;

/**
 * Place every piece of `root` in body space (+Y up, +Z forward, +X the character's left).
 * Returns the names it didn't recognise, so a new piece in the GLB is noticed rather
 * than silently left at the origin.
 */
export function poseShardplate(
  root: { getObjectByName(n: string): any },
  pose: Pose,
  names: string[],
): string[] {
  const S = SKELETON;
  const W = S.WAIST_Y;
  const a = pose.arm * D;
  const e = pose.elbow * D;
  const lg = pose.leg * D;
  const used = new Set<string>();

  const put = (name: string, x: number, y: number, z: number, rz = 0) => {
    const o = root.getObjectByName(name);
    if (!o) return;
    o.position.set(x, y, z);
    o.rotation.set(0, 0, rz);
    used.add(name);
  };

  put('helm', 0, W + S.HELM_Y, 0);
  put('helm_crest', 0, W + S.HELM_Y, 0);
  for (const n of ['gorget', 'breastplate', 'abdomen']) put(n, 0, W, 0);
  put('belt', 0, W, 0);
  put('fauld_front', 0, S.FAULD_Y, S.FAULD_FRONT_Z);
  put('fauld_back', 0, S.FAULD_Y, S.FAULD_BACK_Z);

  for (const [s, side] of [[1, 'l'], [-1, 'r']] as const) {
    const shx = s * S.SHOULDER.x;
    const shy = W + S.SHOULDER.y;
    // Arms: shoulder -> elbow -> wrist, each rotated by the accumulated angle.
    // The pauldron rides on the torso (humanoid.ts), so the arm's abduction doesn't turn it.
    put(`pauldron_${side}`, shx, shy, 0);
    put(`upperarm_${side}`, shx, shy, 0, s * a);
    const ex = shx + s * Math.sin(a) * S.UPPER_ARM;
    const ey = shy - Math.cos(a) * S.UPPER_ARM;
    put(`forearm_${side}`, ex, ey, 0, s * (a + e));
    const wx = ex + s * Math.sin(a + e) * S.LOWER_ARM;
    const wy = ey - Math.cos(a + e) * S.LOWER_ARM;
    put(`gauntlet_${side}`, wx, wy, 0, s * (a + e));

    // Legs: hip -> knee -> ankle.
    const hx = s * S.LEG_X;
    put(`thigh_${side}`, hx, S.HIP_Y, 0, s * lg);
    put(`tasset_${side}`, s * S.TASSET_X, S.TASSET_Y, 0);
    const kx = hx + s * Math.sin(lg) * S.THIGH;
    const ky = S.HIP_Y - Math.cos(lg) * S.THIGH;
    put(`shin_${side}`, kx, ky, 0, s * lg);
    const ax = kx + s * Math.sin(lg) * S.SHIN;
    const ay = ky - Math.cos(lg) * S.SHIN;
    put(`boot_${side}`, ax, ay, 0, s * lg);
  }

  return names.filter((n) => !used.has(n));
}
