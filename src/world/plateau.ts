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
}

const STRATA = ['#7d6753', '#6f5b49', '#8b735d', '#655242', '#7a634f'].map((c) => new THREE.Color(c));
const TOP = new THREE.Color('#8f7b63');

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
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 14 });
    // Shape (x, y) → world (x, z); extrusion runs downward from y = 0.
    geo.rotateX(Math.PI / 2);
    geo.computeVertexNormals();

    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      if (nrm.getY(i) > 0.5) {
        c.copy(TOP).multiplyScalar(0.94 + rng() * 0.1);
      } else {
        const band = Math.floor((-pos.getY(i) + Math.sin(pos.getX(i) * 0.15) * 1.5) / 3.2);
        c.copy(STRATA[((band % STRATA.length) + STRATA.length) % STRATA.length]);
        c.multiplyScalar(0.92 + rng() * 0.12);
      }
      colors.set([c.r, c.g, c.b], i * 3);
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
