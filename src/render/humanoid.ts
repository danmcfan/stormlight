import * as THREE from 'three';
import { handPoint, type BladePose } from '../combat/bladePose';
import { clamp, damp } from '../core/math';

/*
 * Shared skeleton (body space, metres, +Z forward, +X = left):
 *   hips at y 1.0, legs 0.47 + 0.46
 *   torso pivots at the waist (y 1.08); shoulders at (±0.42, +0.62) from it
 *   arms 0.40 + 0.36 (+ hand)
 * Matches the pivots in combat/bladePose.ts so the weapon sits in the hand.
 */
const HIP_Y = 1.0;
const WAIST_Y = 1.08;
const SHOULDER = new THREE.Vector3(0.42, 0.62, 0);
const UPPER_ARM = 0.4;
const LOWER_ARM = 0.36;
const HAND = 0.06;

export type HumanoidKind = 'plate' | 'parshendi';

export interface AnimState {
  speed: number;
  jogSpeed: number;
  sprintSpeed: number;
  forwardAccel: number;
  turnRate: number;
  grounded: boolean;
  /** Combat state name from the fighter. */
  combat: string;
  /** True during a swing's active frames (blade snaps exactly to its pose). */
  active: boolean;
}

interface Limb { upper: THREE.Group; lower: THREE.Group }

interface FlashMat { mat: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number }

/**
 * Box-built humanoid with procedural animation:
 *  - legs walk from locomotion speed
 *  - the weapon is placed from the combat pose, and both arms reach for it
 *    with two-bone IK
 *  - hit flash, death fall
 */
export class HumanoidModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private torso = new THREE.Group();
  private legL!: Limb; private legR!: Limb;
  private armL!: Limb; private armR!: Limb;
  readonly weapon = new THREE.Group();
  /** Blade tip / base in weapon space, for trails. */
  readonly tipLocal: THREE.Vector3;
  readonly baseLocal: THREE.Vector3;
  private mats: FlashMat[] = [];
  private phase = 0;
  private lean = 0;
  private bank = 0;
  private time = Math.random() * 10;
  private flash = 0;
  private deathT = 0;
  // Smoothed visual weapon pose.
  private dir = new THREE.Vector3(0, 0, 1);
  private hand = new THREE.Vector3(0, 1.4, 0.4);
  private tangent = new THREE.Vector3(0, -1, 0);
  private twist = 0;
  private twoHanded = 0;
  onFootfall: ((speed: number) => void) | null = null;

  constructor(readonly kind: HumanoidKind, readonly scale = 1, variant = 0) {
    this.root.add(this.body);
    this.root.scale.setScalar(scale);
    this.torso.position.y = WAIST_Y;
    this.body.add(this.torso);
    this.body.add(this.weapon);
    if (kind === 'plate') this.buildPlate(variant); else this.buildParshendi(variant);
    if (kind === 'plate') { this.tipLocal = new THREE.Vector3(0, 1.95, 0); this.baseLocal = new THREE.Vector3(0, 0.3, 0); }
    else { this.tipLocal = new THREE.Vector3(0, 1.28, 0.3); this.baseLocal = new THREE.Vector3(0, 0.85, 0.05); }
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  // --- Construction -------------------------------------------------------------

  private mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6, ...opts });
    this.mats.push({ mat: m, emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
    return m;
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  private limb(upperLen: number, lowerLen: number, w: number, mat: THREE.Material, joint: THREE.Material, end?: THREE.Mesh): Limb {
    const upper = new THREE.Group();
    upper.add(this.box(w, upperLen, w * 1.05, mat, 0, -upperLen / 2));
    const lower = new THREE.Group();
    lower.position.y = -upperLen;
    lower.add(this.box(w * 0.92, lowerLen, w, mat, 0, -lowerLen / 2));
    lower.add(this.box(w * 1.1, w * 0.7, w * 1.15, joint));
    if (end) { end.position.y -= lowerLen; lower.add(end); }
    upper.add(lower);
    return { upper, lower };
  }

  private addLegs(mat: THREE.Material, joint: THREE.Material, boot: THREE.Material, w: number): void {
    const footL = this.box(w * 1.2, 0.14, w * 1.7, boot, 0, -0.04, 0.06);
    this.legL = this.limb(0.47, 0.46, w, mat, joint, footL);
    this.legR = this.limb(0.47, 0.46, w, mat, joint, footL.clone());
    this.legL.upper.position.set(0.17, HIP_Y, 0);
    this.legR.upper.position.set(-0.17, HIP_Y, 0);
    this.body.add(this.legL.upper, this.legR.upper);
  }

  private addArms(mat: THREE.Material, joint: THREE.Material, hand: THREE.Material, w: number): void {
    const fist = this.box(w * 0.9, 0.15, w, hand, 0, -0.05);
    this.armL = this.limb(UPPER_ARM, LOWER_ARM, w, mat, joint, fist);
    this.armR = this.limb(UPPER_ARM, LOWER_ARM, w, mat, joint, fist.clone());
    this.armL.upper.position.set(SHOULDER.x, SHOULDER.y, SHOULDER.z);
    this.armR.upper.position.set(-SHOULDER.x, SHOULDER.y, SHOULDER.z);
    this.torso.add(this.armL.upper, this.armR.upper);
  }

  private buildPlate(variant: number): void {
    // Variant 1: a Parshendi Shardbearer's Plate, darker and bronze-toned.
    const enemy = variant === 1;
    const plate = this.mat(enemy ? '#6e5a47' : '#7a8796', { metalness: 0.65, roughness: 0.42 });
    const dark = this.mat(enemy ? '#3b2d25' : '#4d5865', { metalness: 0.6, roughness: 0.5 });
    const glow = this.mat('#d8f2ff', { emissive: new THREE.Color('#9fdcff'), emissiveIntensity: 2.2, flatShading: false });
    const steel = this.mat('#c9d4de', { metalness: 0.95, roughness: 0.18 });
    const etch = this.mat('#bfe8ff', { emissive: new THREE.Color('#7fd0ff'), emissiveIntensity: 0.9 });

    this.addLegs(plate, dark, dark, 0.25);
    this.body.add(this.box(0.56, 0.22, 0.36, dark, 0, 1.03, 0));
    const t = this.torso;
    t.add(this.box(0.62, 0.36, 0.38, plate, 0, 0.2));
    t.add(this.box(0.78, 0.4, 0.46, plate, 0, 0.52));
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), glow);
    gem.position.set(0, 0.55, 0.24);
    t.add(gem);
    for (const side of [-1, 1]) {
      const p = this.box(0.34, 0.2, 0.46, dark, side * 0.46, 0.76);
      p.rotation.z = side * -0.25;
      t.add(p);
    }
    const helm = new THREE.Group();
    helm.position.y = 0.92;
    helm.add(this.box(0.3, 0.34, 0.34, plate, 0, 0.17));
    const visor = this.box(0.24, 0.035, 0.02, glow, 0, 0.2, 0.175);
    visor.castShadow = false;
    helm.add(visor, this.box(0.06, 0.1, 0.3, dark, 0, 0.38));
    if (enemy) {
      // Carapace-like ridges sweeping back from the helm.
      for (const side of [-1, 1]) {
        const ridge = this.box(0.05, 0.08, 0.34, dark, side * 0.12, 0.36, -0.04);
        ridge.rotation.z = side * 0.35;
        helm.add(ridge);
      }
    }
    t.add(helm);
    this.addArms(plate, dark, dark, 0.19);

    // Shardblade: grip at the origin, blade along +Y, wide axis along Z.
    const w = this.weapon;
    w.add(this.box(0.06, 0.34, 0.06, dark, 0, -0.03));
    w.add(this.box(0.1, 0.07, 0.42, dark, 0, 0.16));
    w.add(this.box(0.05, 1.57, 0.17, steel, 0, 0.98));
    w.add(this.box(0.054, 1.3, 0.025, etch, 0, 0.95));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), steel);
    tip.scale.set(0.42, 1, 1);
    tip.position.y = 1.9;
    w.add(tip);
  }

  private buildParshendi(variant: number): void {
    const duelist = variant === 1;
    const skinA = this.mat(duelist ? '#1d1414' : '#2a2020', { roughness: 0.8 });
    const skinB = this.mat(duelist ? '#5e1a16' : '#7d2a22', { roughness: 0.8 });
    const shell = this.mat(duelist ? '#c98a2e' : '#b2552c', { roughness: 0.5 });
    const metal = this.mat('#5d5d62', { metalness: 0.7, roughness: 0.4 });
    const wood = this.mat('#4a3424', { roughness: 0.9 });

    this.addLegs(skinB, shell, skinA, 0.22);
    this.body.add(this.box(0.5, 0.2, 0.32, skinA, 0, 1.03));
    const t = this.torso;
    t.add(this.box(0.5, 0.35, 0.3, skinB, 0, 0.2));
    t.add(this.box(0.66, 0.42, 0.36, skinA, 0, 0.5));
    t.add(this.box(0.3, 0.3, 0.37, skinB, 0.14, 0.52)); // marbling
    t.add(this.box(0.6, 0.36, 0.1, shell, 0, 0.5, 0.18)); // carapace chest
    for (const side of [-1, 1]) t.add(this.box(0.26, 0.15, 0.36, shell, side * 0.44, 0.74));
    const head = new THREE.Group();
    head.position.y = 0.86;
    head.add(this.box(0.27, 0.3, 0.28, skinA, 0, 0.16));
    head.add(this.box(0.31, 0.12, 0.32, shell, 0, 0.33)); // carapace skull ridge
    head.add(this.box(0.2, 0.12, 0.06, skinB, 0, 0.0, 0.13)); // braided beard
    if (duelist) head.add(this.box(0.05, 0.16, 0.3, shell, 0, 0.45));
    t.add(head);
    this.addArms(skinA, shell, skinA, 0.17);

    // Axe: haft along +Y, head's edge facing +Z (the swing direction).
    const w = this.weapon;
    w.add(this.box(0.05, 1.35, 0.05, wood, 0, 0.45));
    w.add(this.box(0.04, 0.34, 0.34, metal, 0, 1.05, 0.15));
    w.add(this.box(0.03, 0.3, 0.06, metal, 0, 1.05, 0.34));
  }

  // --- Animation ------------------------------------------------------------------

  hitFlash(): void { this.flash = 1; }

  reset(): void {
    this.deathT = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
  }

  update(dt: number, a: AnimState, pose: BladePose): void {
    this.time += dt;
    this.updateFlash(dt);
    if (a.combat === 'dead') { this.updateDeath(dt); this.placeWeapon(dt, pose, a.active); this.solveArms(); return; }

    const speed = a.grounded ? a.speed : 0;
    const run = clamp(speed / a.jogSpeed, 0, 1);
    const sprint = clamp((speed - a.jogSpeed) / Math.max(0.01, a.sprintSpeed - a.jogSpeed), 0, 1);
    const stride = 0.85 + run * 0.35 + sprint * 0.55;
    const prev = this.phase;
    this.phase += (speed * dt * Math.PI) / stride;
    if (Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI) && speed > 0.5) this.onFootfall?.(speed);

    const p = this.phase;
    const legAmp = run * 0.5 + sprint * 0.35;
    this.legL.upper.rotation.x = -Math.sin(p) * legAmp;
    this.legR.upper.rotation.x = Math.sin(p) * legAmp;
    this.legL.lower.rotation.x = Math.max(0, Math.cos(p)) * legAmp * 1.6;
    this.legR.lower.rotation.x = Math.max(0, -Math.cos(p)) * legAmp * 1.6;

    // Fighting crouch: knees bend a little when not running.
    const crouch = (1 - run) * (a.combat === 'block' ? 0.18 : 0.1);
    this.legL.upper.rotation.x -= crouch; this.legR.upper.rotation.x -= crouch;
    this.legL.lower.rotation.x += crouch * 2; this.legR.lower.rotation.x += crouch * 2;

    const bob = Math.abs(Math.sin(p)) * (0.03 + sprint * 0.05) * run;
    const breathe = Math.sin(this.time * 1.6) * 0.008 * (1 - run);
    this.body.position.y = -bob + breathe - crouch * 0.18;

    let targetLean = clamp(a.forwardAccel * 0.012, -0.18, 0.22) + run * 0.06 + sprint * 0.2;
    if (a.combat === 'attack') targetLean = a.active ? 0.22 : 0.08;
    if (a.combat === 'stagger' || a.combat === 'parried') targetLean = -0.25;
    if (a.combat === 'hitstun') targetLean = -0.15;
    this.lean = damp(this.lean, targetLean, 10, dt);
    this.torso.rotation.x = this.lean;
    const targetBank = clamp(-a.turnRate * speed * 0.012, -0.3, 0.3);
    this.bank = damp(this.bank, targetBank, 10, dt);
    this.body.rotation.z = this.bank;

    this.placeWeapon(dt, pose, a.active);
    this.torso.rotation.y = this.twist + Math.sin(p) * 0.1 * run;
    this.solveArms();
  }

  private updateFlash(dt: number): void {
    if (this.flash <= 0) return;
    this.flash = Math.max(0, this.flash - dt * 7);
    // A brief pale-blue glint, not a white-out: keep the silhouette readable.
    const k = this.flash * 0.45;
    for (const f of this.mats) {
      f.mat.emissive.copy(f.emissive).lerp(FLASH, k);
      f.mat.emissiveIntensity = Math.max(f.intensity, k);
    }
  }

  private updateDeath(dt: number): void {
    this.deathT = Math.min(1, this.deathT + dt * 1.6);
    const t = 1 - Math.pow(1 - this.deathT, 3);
    this.body.rotation.x = -t * (Math.PI / 2 - 0.08);
    this.body.position.y = -t * 0.75;
    this.body.position.z = -t * 0.9;
  }

  /** Move the visible weapon toward the combat pose (exactly, during active frames). */
  private placeWeapon(dt: number, pose: BladePose, active: boolean): void {
    const k = active ? 1 : 1 - Math.exp(-22 * dt);
    const prevDir = _v.copy(this.dir);
    this.dir.lerp(pose.dir, k).normalize();
    handPoint(pose, _hand);
    this.hand.lerp(_hand, k);
    this.twist += (pose.twist - this.twist) * k;
    this.twoHanded += ((pose.twoHanded ? 1 : 0) - this.twoHanded) * (1 - Math.exp(-14 * dt));

    // Leading edge follows the swing; at rest the edge faces down/forward.
    const motion = _m.subVectors(this.dir, prevDir);
    if (motion.lengthSq() > 1e-6) this.tangent.lerp(motion.normalize(), 0.5);
    else this.tangent.lerp(_rest, 1 - Math.exp(-4 * dt));
    const z = _z.copy(this.tangent).addScaledVector(this.dir, -this.tangent.dot(this.dir));
    if (z.lengthSq() < 1e-6) z.set(0, 0, 1).addScaledVector(this.dir, -this.dir.z);
    z.normalize();
    const x = _x.crossVectors(this.dir, z).normalize();
    _mat.makeBasis(x, this.dir, z);
    this.weapon.quaternion.setFromRotationMatrix(_mat);
    this.weapon.position.copy(this.hand);
  }

  private solveArms(): void {
    this.root.updateMatrixWorld(true);
    // Right hand on the grip.
    this.weapon.localToWorld(_target.set(0, 0, 0));
    this.ik(this.armR, _target, _pole.set(-1, -1.1, -0.7));
    // Left hand lower on the hilt when two-handed, otherwise out for balance.
    this.weapon.localToWorld(_t2.set(0, -0.2, 0));
    this.body.localToWorld(_t3.set(0.5, 1.15, 0.2));
    _target.lerpVectors(_t3, _t2, this.twoHanded);
    this.ik(this.armL, _target, _pole.set(1, -1.1, -0.7));
  }

  /** Two-bone IK: point the upper arm and forearm so the hand reaches `target`. */
  private ik(limb: Limb, target: THREE.Vector3, poleBody: THREE.Vector3): void {
    const s = this.scale;
    const L1 = UPPER_ARM * s, L2 = (LOWER_ARM + HAND) * s;
    limb.upper.getWorldPosition(_sh);
    const toT = _d.subVectors(target, _sh);
    const dist = clamp(toT.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    toT.normalize();
    // Elbow bends toward the pole (down, outward, back) in world space.
    const pole = this.root.localToWorld(_pw.copy(poleBody)).sub(this.root.getWorldPosition(_o));
    pole.addScaledVector(toT, -pole.dot(toT)).normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const elbow = _e.copy(_sh).addScaledVector(toT, a).addScaledVector(pole, h);
    const hand = _hw.copy(_sh).addScaledVector(toT, dist);

    this.aim(limb.upper, _sh, elbow);
    limb.upper.updateMatrixWorld(true);
    this.aim(limb.lower, elbow, hand);
  }

  /** Rotate a limb group so its local -Y axis points from `from` to `to`. */
  private aim(g: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
    const dir = _a.subVectors(to, from).normalize();
    _qw.setFromUnitVectors(DOWN, dir);
    g.parent!.getWorldQuaternion(_qp);
    g.quaternion.copy(_qp.invert().multiply(_qw));
  }
}

const FLASH = new THREE.Color('#dff4ff');
const DOWN = new THREE.Vector3(0, -1, 0);
const _rest = new THREE.Vector3(0, -0.6, 0.8).normalize();
const _v = new THREE.Vector3(), _m = new THREE.Vector3(), _z = new THREE.Vector3(), _x = new THREE.Vector3();
const _hand = new THREE.Vector3(), _mat = new THREE.Matrix4();
const _target = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3();
const _pole = new THREE.Vector3(), _pw = new THREE.Vector3(), _o = new THREE.Vector3();
const _sh = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _hw = new THREE.Vector3();
const _a = new THREE.Vector3(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion();
