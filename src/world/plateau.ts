import * as THREE from 'three';
import { TAU, mulberry32 } from '../core/math';

export interface PlateauOptions {
  x: number;
  z: number;
  /** Height of the flat top. */
  y?: number;
  radius: number;
  seed: number;
  /** How jagged the outline is, as a fraction of radius. */
  roughness?: number;
  depth?: number;
  /** Metres per mesh row down the cliff (rock bands are coloured per row). Coarser for distant plateaus. */
  rowHeight?: number;
}

// Style reference palette: sandstone orange and cream bands, sun-bleached
// cream tops with sage patches.
const STRATA = ['#d98a5c', '#efcfa0', '#cf7d52', '#e6ad78', '#f2d9b0', '#c97a55'].map((c) => new THREE.Color(c));
const TOP = new THREE.Color('#e2c79f');
const SAGE = new THREE.Color('#a9b07a');

/** A flat-topped mesa with a jagged outline and banded cliff walls. */
export class Plateau {
  readonly mesh: THREE.Mesh;
  readonly center: THREE.Vector3;
  private radii: number[];

  constructor(o: PlateauOptions) {
    const rng = mulberry32(o.seed);
    const n = 56;
    const rough = o.roughness ?? 0.18;
    // Layered noise around the rim: a few big bays plus fine jaggedness.
    const p1 = rng() * TAU, p2 = rng() * TAU;
    this.radii = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const big = Math.sin(a * 2 + p1) * 0.55 + Math.sin(a * 5 + p2) * 0.3;
      const fine = (rng() - 0.5) * 0.6;
      this.radii.push(o.radius * (1 + rough * (big + fine)));
    }

    const shape = new THREE.Shape();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = Math.cos(a) * this.radii[i], y = Math.sin(a) * this.radii[i];
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    const depth = o.depth ?? 120;
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: Math.round(depth / (o.rowHeight ?? 2)) });
    // Shape (x, y) → world (x, z); extrusion runs downward from y = 0.
    geo.rotateX(Math.PI / 2);
    geo.computeVertexNormals();

    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    // Non-indexed geometry: colour whole triangles, so the rock bands have
    // crisp painted edges instead of blending across a mesh row.
    for (let f = 0; f < pos.count; f += 3) {
      if (nrm.getY(f) > 0.5) {
        for (let i = f; i < f + 3; i++) {
          c.copy(TOP).multiplyScalar(0.95 + rng() * 0.08);
          const wx = pos.getX(i) + o.x, wz = pos.getZ(i) + o.z;
          const patch = Math.sin(wx * 0.11 + Math.sin(wz * 0.07) * 2) * Math.sin(wz * 0.09 + wx * 0.03);
          if (patch > 0.55) c.lerp(SAGE, 0.55);
          colors.set([c.r, c.g, c.b], i * 3);
        }
        continue;
      }
      const y = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
      const x = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
      const z = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
      // Bands about 4 m tall, wavering a little round the cliff.
      const band = Math.floor((-y + Math.sin(x * 0.15 + z * 0.1) * 2.5) / 4.1);
      c.copy(STRATA[((band % STRATA.length) + STRATA.length) % STRATA.length]);
      c.multiplyScalar(0.93 + rng() * 0.1);
      for (let i = f; i < f + 3; i++) colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
    this.center = new THREE.Vector3(o.x, o.y ?? 0, o.z);
    this.mesh.position.copy(this.center);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
  }

  /**
   * Distance from the centre to the rim along a world-space heading angle
   * measured like Math.atan2(z, x) (i.e. the shape's own polar angle).
   */
  radiusAtPolar(a: number): number {
    const n = this.radii.length;
    const f = (((a % TAU) + TAU) % TAU) / TAU * n;
    const i0 = Math.floor(f) % n, i1 = (i0 + 1) % n;
    const t = f - Math.floor(f);
    return this.radii[i0] * (1 - t) + this.radii[i1] * t;
  }

  /** Random point on the top surface, kept `margin` (fraction of rim distance) away from the edge. */
  randomPoint(rng: () => number, margin = 0.85): THREE.Vector3 {
    const a = rng() * TAU;
    const d = Math.sqrt(rng()) * this.radiusAtPolar(a) * margin;
    return new THREE.Vector3(this.center.x + Math.cos(a) * d, this.center.y, this.center.z + Math.sin(a) * d);
  }
}
