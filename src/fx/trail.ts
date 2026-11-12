import * as THREE from 'three';

const SEGMENTS = 16;
/** Metres the blade tip can plausibly move between two rendered frames. */
const MAX_JUMP = 2.5;

/**
 * Ribbon behind a weapon during a swing: the last few blade positions as a
 * triangle strip, faded by age. Additive blending, so fading the colour to
 * black fades it out — no sorting or alpha needed.
 */
export class BladeTrail {
  readonly mesh: THREE.Mesh;
  private tips: THREE.Vector3[] = [];
  private bases: THREE.Vector3[] = [];
  private ages: number[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(private color: THREE.Color, private life = 0.16) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(SEGMENTS * 2 * 3);
    this.col = new Float32Array(SEGMENTS * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let i = 0; i < SEGMENTS - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  clear(): void {
    this.tips.length = this.bases.length = this.ages.length = 0;
  }

  /** Call every rendered frame. `emit` while the swing is live. */
  update(dt: number, emit: boolean, tip: THREE.Vector3, base: THREE.Vector3): void {
    for (let i = 0; i < this.ages.length; i++) this.ages[i] += dt;
    while (this.ages.length && this.ages[this.ages.length - 1] > this.life) { this.ages.pop(); this.tips.pop(); this.bases.pop(); }
    // A tip that jumps further than any swing could in one frame means the
    // fighter was teleported (respawn): start a fresh trail instead of
    // stretching a ribbon across the gap.
    if (this.tips.length && this.tips[0].distanceTo(tip) > MAX_JUMP) this.clear();
    if (emit) {
      this.tips.unshift(tip.clone()); this.bases.unshift(base.clone()); this.ages.unshift(0);
      if (this.tips.length > SEGMENTS) { this.tips.pop(); this.bases.pop(); this.ages.pop(); }
    }
    const n = this.tips.length;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    for (let i = 0; i < SEGMENTS; i++) {
      const j = Math.min(i, n - 1);
      const fade = i < n ? Math.max(0, 1 - this.ages[j] / this.life) * (1 - i / SEGMENTS) : 0;
      this.tips[j].toArray(this.pos, i * 6);
      this.bases[j].toArray(this.pos, i * 6 + 3);
      const r = this.color.r * fade, g = this.color.g * fade, b = this.color.b * fade;
      this.col.set([r, g, b], i * 6);
      this.col.set([r * 0.15, g * 0.15, b * 0.15], i * 6 + 3);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
}
