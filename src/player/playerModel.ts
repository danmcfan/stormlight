import * as THREE from 'three';
import { clamp, damp } from '../core/math';

const plate = new THREE.MeshStandardMaterial({ color: '#7a8796', metalness: 0.65, roughness: 0.42, flatShading: true });
const plateDark = new THREE.MeshStandardMaterial({ color: '#4d5865', metalness: 0.6, roughness: 0.5, flatShading: true });
const glow = new THREE.MeshStandardMaterial({ color: '#d8f2ff', emissive: '#9fdcff', emissiveIntensity: 2.2 });
const bladeMat = new THREE.MeshStandardMaterial({ color: '#c9d4de', metalness: 0.95, roughness: 0.18, flatShading: true });

function box(w: number, h: number, d: number, mat: THREE.Material, y = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

interface Limb { upper: THREE.Group; lower: THREE.Group }

function makeLimb(upperLen: number, lowerLen: number, w: number, mat: THREE.Material, endPiece?: THREE.Mesh): Limb {
  const upper = new THREE.Group();
  upper.add(box(w, upperLen, w * 1.05, mat, -upperLen / 2));
  const lower = new THREE.Group();
  lower.position.y = -upperLen;
  lower.add(box(w * 0.92, lowerLen, w, mat, -lowerLen / 2));
  // Joint guard (knee / elbow couter)
  lower.add(box(w * 1.1, w * 0.7, w * 1.15, plateDark, 0));
  if (endPiece) { endPiece.position.y -= lowerLen; lower.add(endPiece); }
  upper.add(lower);
  return { upper, lower };
}

export interface AnimInput {
  speed: number;
  jogSpeed: number;
  sprintSpeed: number;
  forwardAccel: number;
  turnRate: number;
  grounded: boolean;
}

/**
 * Placeholder Shardbearer in Plate: chunky boxes, a glowing visor slit and
 * a Shardblade held low. Animated procedurally from locomotion state so the
 * movement reads (stride, bob, lean, bank) before we have real animations.
 */
export class PlayerModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private torso = new THREE.Group();
  private legL: Limb; private legR: Limb;
  private armL: Limb; private armR: Limb;
  private phase = 0;
  private lean = 0;
  private bank = 0;
  private time = 0;
  /** Fires once per footfall with the current speed (for camera shake / sound). */
  onFootfall: ((speed: number) => void) | null = null;

  constructor() {
    this.root.add(this.body);

    // Legs
    const boot = box(0.3, 0.14, 0.42, plateDark, -0.04);
    boot.position.z = 0.06;
    this.legL = makeLimb(0.47, 0.46, 0.25, plate, boot);
    this.legR = makeLimb(0.47, 0.46, 0.25, plate, boot.clone());
    this.legL.upper.position.set(0.17, 1.0, 0);
    this.legR.upper.position.set(-0.17, 1.0, 0);
    this.body.add(this.legL.upper, this.legR.upper);
    this.body.add(box(0.56, 0.22, 0.36, plateDark, 1.03)); // fauld / hips

    // Torso pivots at the waist so lean bends the upper body.
    this.torso.position.y = 1.08;
    this.body.add(this.torso);
    this.torso.add(box(0.62, 0.36, 0.38, plate, 0.2)); // abdomen
    const chest = box(0.78, 0.4, 0.46, plate, 0.52);
    this.torso.add(chest);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), glow);
    gem.position.set(0, 0.55, 0.24);
    this.torso.add(gem);
    for (const side of [-1, 1]) {
      const pauldron = box(0.34, 0.2, 0.46, plateDark, 0.78);
      pauldron.position.x = side * 0.48;
      pauldron.rotation.z = side * -0.25;
      this.torso.add(pauldron);
    }

    // Helm with visor slit
    const helm = new THREE.Group();
    helm.position.y = 0.92;
    helm.add(box(0.3, 0.34, 0.34, plate, 0.17));
    const visor = box(0.24, 0.035, 0.02, glow, 0.2);
    visor.position.z = 0.175;
    visor.castShadow = false;
    helm.add(visor);
    helm.add(box(0.06, 0.1, 0.3, plateDark, 0.38)); // crest
    this.torso.add(helm);

    // Arms
    const gauntletL = box(0.17, 0.16, 0.19, plateDark, -0.05);
    this.armL = makeLimb(0.36, 0.34, 0.19, plate, gauntletL);
    this.armL.upper.position.set(0.47, 0.68, 0);
    this.armR = makeLimb(0.36, 0.34, 0.19, plate, gauntletL.clone());
    this.armR.upper.position.set(-0.47, 0.68, 0);
    this.torso.add(this.armL.upper, this.armR.upper);

    // Shardblade in the right hand, carried low and angled back.
    const blade = new THREE.Group();
    const steel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.55, 0.16), bladeMat);
    steel.position.y = 0.95;
    steel.castShadow = true;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 4), bladeMat);
    tip.scale.set(0.45, 1, 1);
    tip.position.y = 1.87;
    const guard = box(0.1, 0.07, 0.42, plateDark, 0.16);
    const hilt = box(0.06, 0.3, 0.06, plateDark, 0);
    blade.add(steel, tip, guard, hilt);
    blade.position.y = -0.4;
    blade.rotation.x = 1.9; // point trails behind and down
    this.armR.lower.add(blade);

    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  }

  update(dt: number, a: AnimInput): void {
    this.time += dt;
    const speed = a.grounded ? a.speed : 0;
    const run = clamp(speed / a.jogSpeed, 0, 1);
    const sprint = clamp((speed - a.jogSpeed) / (a.sprintSpeed - a.jogSpeed), 0, 1);

    // Stride: one footfall every `stride` metres.
    const stride = 0.85 + run * 0.35 + sprint * 0.55;
    const prevPhase = this.phase;
    this.phase += (speed * dt * Math.PI) / stride;
    if (Math.floor(prevPhase / Math.PI) !== Math.floor(this.phase / Math.PI) && speed > 0.5) {
      this.onFootfall?.(speed);
    }
    const p = this.phase;
    const legAmp = run * 0.5 + sprint * 0.35;
    const armAmp = run * 0.35 + sprint * 0.35;

    this.legL.upper.rotation.x = -Math.sin(p) * legAmp;
    this.legR.upper.rotation.x = Math.sin(p) * legAmp;
    this.legL.lower.rotation.x = Math.max(0, Math.cos(p)) * legAmp * 1.6;
    this.legR.lower.rotation.x = Math.max(0, -Math.cos(p)) * legAmp * 1.6;

    this.armL.upper.rotation.x = Math.sin(p) * armAmp;
    this.armL.lower.rotation.x = -0.25 - run * 0.4 - sprint * 0.5;
    // Blade arm swings less — it's carrying a six-foot sword.
    this.armR.upper.rotation.x = -Math.sin(p) * armAmp * 0.4 + 0.1;
    this.armR.lower.rotation.x = -0.35 - sprint * 0.3;
    this.armR.upper.rotation.z = 0.12;

    // Weight: bob on each step, lean into acceleration and speed, bank into turns.
    const bob = Math.abs(Math.sin(p)) * (0.03 + sprint * 0.05) * run;
    const breathe = Math.sin(this.time * 1.6) * 0.008 * (1 - run);
    this.body.position.y = -bob + breathe;
    const targetLean = clamp(a.forwardAccel * 0.012, -0.18, 0.22) + run * 0.06 + sprint * 0.2;
    this.lean = damp(this.lean, targetLean, 8, dt);
    this.torso.rotation.x = this.lean;
    const targetBank = clamp(-a.turnRate * speed * 0.012, -0.3, 0.3);
    this.bank = damp(this.bank, targetBank, 10, dt);
    this.body.rotation.z = this.bank;
    // Shoulders counter-rotate against the hips a little when striding.
    this.torso.rotation.y = Math.sin(p) * 0.12 * run;
  }
}
