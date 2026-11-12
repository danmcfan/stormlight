import * as THREE from 'three';
import type { Combatant } from '../entities/combatant';

const POOL = 10;

/**
 * Screen-edge warnings for warriors winding up an attack you can't see
 * (behind you, or off the side of the view). Each sits on an ellipse round
 * the screen at the threat's bearing from the camera (top = ahead, bottom =
 * behind) and fills as the swing nears its strike.
 */
export class AttackWarnings {
  private root: HTMLElement;
  private els: HTMLElement[] = [];
  private seen = new Map<number, number>();
  private v = new THREE.Vector3();

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'threats';
    for (let i = 0; i < POOL; i++) {
      const e = document.createElement('div');
      e.className = 'threat hidden';
      e.innerHTML = '<i></i>';
      this.root.appendChild(e);
      this.els.push(e);
    }
    document.body.appendChild(this.root);
  }

  /**
   * @returns how many warnings appeared this frame for swings not warned before
   *          (the caller plays a sound)
   */
  update(camera: THREE.PerspectiveCamera, foes: readonly Combatant[], player: Combatant, range: number, enabled: boolean): number {
    let n = 0, fresh = 0;
    if (enabled && player.alive) {
      const w = window.innerWidth, h = window.innerHeight;
      const inv = camera.matrixWorldInverse;
      for (const c of foes) {
        if (n >= POOL) break;
        const f = c.fighter;
        if (!c.alive || f.state !== 'attack' || !f.move || f.frame >= f.move.windup) continue;
        if (c.position.distanceToSquared(player.position) > range * range) continue;
        // In view? Then no warning: you can see it coming.
        const v = this.v.copy(c.position).setY(c.position.y + c.chestHeight);
        v.applyMatrix4(inv); // camera space: -Z forward
        const inFront = v.z < -0.5;
        if (inFront) {
          const ndc = this.v.copy(c.position).setY(c.position.y + c.chestHeight).project(camera);
          if (Math.abs(ndc.x) < 0.82 && Math.abs(ndc.y) < 0.85) continue;
          v.copy(c.position).setY(c.position.y + c.chestHeight).applyMatrix4(inv);
        }
        const a = Math.atan2(v.x, -v.z); // 0 = straight ahead, ±π = behind
        const el = this.els[n++];
        const x = w / 2 + Math.sin(a) * w * 0.43;
        const y = h / 2 - Math.cos(a) * h * 0.41;
        const k = f.frame / f.move.windup; // 0 → 1 as the strike nears
        el.classList.remove('hidden');
        el.classList.toggle('heavy', f.move.kind === 'heavy');
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${a.toFixed(3)}rad) scale(${(0.85 + k * 0.4).toFixed(3)})`;
        el.style.setProperty('--k', k.toFixed(3));
        if (this.seen.get(c.id) !== f.attackSerial) { this.seen.set(c.id, f.attackSerial); fresh++; }
      }
    }
    for (let i = n; i < POOL; i++) this.els[i].classList.add('hidden');
    return fresh;
  }

  hide(): void {
    for (const e of this.els) e.classList.add('hidden');
  }
}
