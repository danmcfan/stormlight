import * as THREE from 'three';
import { tuning } from '../config';
import type { Parshendi } from '../enemies/parshendi';
import { selectTarget, switchTarget } from './lockOn';

function makeReticle(): THREE.Sprite {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.translate(size / 2, size / 2);
  g.rotate(Math.PI / 4);
  g.strokeStyle = '#bfe8ff';
  g.lineWidth = 7;
  g.shadowColor = '#7fd0ff';
  g.shadowBlur = 14;
  g.strokeRect(-26, -26, 52, 52);
  g.fillStyle = '#e8f8ff';
  g.fillRect(-7, -7, 14, 14);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.renderOrder = 999;
  s.scale.setScalar(0.32);
  s.visible = false;
  return s;
}

/** Owns which enemy is locked, the reticle, and mouse-flick target switching. */
export class LockOnSystem {
  target: Parshendi | null = null;
  readonly reticle = makeReticle();
  private flick = 0;
  private cooldown = 0;
  private pulse = 0;

  constructor(scene: THREE.Scene, private enemies: Parshendi[]) {
    scene.add(this.reticle);
  }

  private candidates() {
    return this.enemies.map((e) => ({ id: e.id, x: e.position.x, z: e.position.z }));
  }

  toggle(playerPos: THREE.Vector3, cameraYaw: number): void {
    if (this.target) { this.target = null; return; }
    const pick = selectTarget(playerPos.x, playerPos.z, cameraYaw, this.candidates(), tuning.lockOn.range);
    this.target = pick ? this.enemies.find((e) => e.id === pick.id) ?? null : null;
    this.pulse = 1;
  }

  /** Accumulate horizontal mouse motion; a decisive flick switches target. */
  handleMouse(dx: number, dt: number, playerPos: THREE.Vector3, cameraYaw: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flick = this.flick * Math.exp(-8 * dt) + dx;
    if (!this.target || this.cooldown > 0) return;
    if (Math.abs(this.flick) < tuning.lockOn.switchThreshold) return;
    const dir = this.flick > 0 ? 1 : -1;
    const cur = this.target;
    const next = switchTarget(playerPos.x, playerPos.z, cameraYaw,
      { id: cur.id, x: cur.position.x, z: cur.position.z }, this.candidates(), tuning.lockOn.range, dir);
    if (next.id !== cur.id) {
      this.target = this.enemies.find((e) => e.id === next.id) ?? cur;
      this.pulse = 1;
    }
    this.flick = 0;
    this.cooldown = tuning.lockOn.switchCooldown;
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    if (this.target && this.target.position.distanceTo(playerPos) > tuning.lockOn.breakRange) this.target = null;
    this.reticle.visible = !!this.target;
    if (this.target) {
      this.reticle.position.copy(this.target.position).setY(this.target.position.y + this.target.chestHeight);
      this.pulse = Math.max(0, this.pulse - dt * 4);
      this.reticle.scale.setScalar(0.32 * (1 + this.pulse * 0.8));
    }
  }

  /** Point the camera frames when locked: the target's chest. */
  focus(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.target) return null;
    return out.copy(this.target.position).setY(this.target.position.y + this.target.chestHeight);
  }
}
