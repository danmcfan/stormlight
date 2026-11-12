import * as THREE from 'three';
import type { Capsule } from '../combat/hits';
import type { Combatant } from '../entities/combatant';

const RING = 12;

/** Wireframes for body capsules and blade segments (tuning panel → Show hitboxes). */
export class HitboxView {
  readonly group = new THREE.Group();
  private lines: THREE.LineSegments;
  private positions: Float32Array;
  private colors: Float32Array;
  private cap: Capsule = { bottom: new THREE.Vector3(), top: new THREE.Vector3(), radius: 0 };

  constructor(maxFighters: number) {
    // Per fighter: blade (1 seg) + axis (1) + 2 rings (RING segs each).
    const segs = maxFighters * (2 + RING * 2);
    this.positions = new Float32Array(segs * 6);
    this.colors = new Float32Array(segs * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1000;
    this.group.add(this.lines);
  }

  update(fighters: Combatant[], visible: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    let s = 0;
    const seg = (a: THREE.Vector3, b: THREE.Vector3, r: number, g: number, bl: number) => {
      this.positions.set([a.x, a.y, a.z, b.x, b.y, b.z], s * 6);
      this.colors.set([r, g, bl, r, g, bl], s * 6);
      s++;
    };
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    for (const f of fighters) {
      if (!f.alive) continue;
      const active = f.fighter.isActive();
      seg(f.bladeA, f.bladeB, active ? 1 : 0.4, active ? 0.2 : 0.4, active ? 0.2 : 0.4);
      const c = f.capsule(this.cap);
      const inv = f.fighter.invulnerable();
      const [r, g, b] = inv ? [0.3, 0.6, 1] : f.fighter.state === 'block' ? [1, 0.85, 0.2] : [0.2, 1, 0.4];
      seg(c.bottom, c.top, r, g, b);
      for (const y of [c.bottom.y, c.top.y]) {
        for (let i = 0; i < RING; i++) {
          const a0 = (i / RING) * Math.PI * 2, a1 = ((i + 1) / RING) * Math.PI * 2;
          p0.set(c.bottom.x + Math.cos(a0) * c.radius, y, c.bottom.z + Math.sin(a0) * c.radius);
          p1.set(c.bottom.x + Math.cos(a1) * c.radius, y, c.bottom.z + Math.sin(a1) * c.radius);
          seg(p0, p1, r, g, b);
        }
      }
    }
    const geo = this.lines.geometry;
    geo.setDrawRange(0, s * 2);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}
