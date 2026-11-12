import * as THREE from 'three';
import { TAU } from '../core/math';
import { rayExit, type PlainsCell, type V2 } from './plainsLayout';

/**
 * Plateau geometry for the Shattered Plains.
 *
 * Each slab of the layout (plainsLayout.ts) becomes a flat top with a
 * rounded, wind-worn rim and sheer walls dropping into the chasm. The rock
 * strata run by world height (with a gentle long wave), the same function
 * in TypeScript and in the terrain shader (terrainMaterial.ts): near walls
 * get a row of vertices on every stratum boundary and step in or out there,
 * so the ledges line up with the colour bands. Neighbouring plateaus share
 * strata, as real rock layers would.
 */

// --- Strata (keep in sync with terrainMaterial.ts) ---------------------------------

export const STRATA_BAND = 1.9;

/** Long, gentle waviness of the strata (metres of height). */
export function strataWave(x: number, z: number): number {
  return 1.6 * Math.sin(x * 0.043 + 1.7 * Math.sin(z * 0.029)) + 1.0 * Math.sin(z * 0.061 + x * 0.017);
}

/** Stratum coordinate: integer steps are band boundaries. Monotonic in h. */
export function strataT(h: number): number {
  return h / STRATA_BAND + 0.45 * Math.sin(h * 0.19);
}

/** Inverse of strataT (Newton). */
export function strataH(t: number): number {
  let h = t * STRATA_BAND;
  for (let i = 0; i < 6; i++) h -= (strataT(h) - t) / (1 / STRATA_BAND + 0.45 * 0.19 * Math.cos(h * 0.19));
  return h;
}

function hash1(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** How far stratum k stands out from (+) or is eroded back into (-) the wall. */
export function ledge(k: number): number {
  return (hash1(k + 0.5) - 0.62) * 0.95;
}

/** Smooth 1D value noise. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i + seed * 17.13) * (1 - u) + hash1(i + 1 + seed * 17.13) * u;
}

// --- Detail tiers --------------------------------------------------------------------------

export interface PlateauTier {
  /** Outline spacing (metres). */
  ds: number;
  /** Rounded rim radius as a fraction of slab size, and its segments. */
  bevel: number;
  bevelSegs: number;
  /** Rows per stratum boundary (ledges) down to this depth below the top; 0 = none. */
  ledgeDepth: number;
  /** Extra wall rows (depths below the top). */
  rows: number[];
  /** Outline wobble (metres). */
  wobble: number;
  /** Vertical fissures in the walls. */
  fissures: boolean;
  /** Fillet segments per radian of corner. */
  arcDensity: number;
}

export const TIERS: Record<'near' | 'mid' | 'far', PlateauTier> = {
  near: { ds: 1.6, bevel: 0.07, bevelSegs: 3, ledgeDepth: 30, rows: [38, 50], wobble: 0.55, fissures: true, arcDensity: 4 },
  mid: { ds: 4.5, bevel: 0.06, bevelSegs: 2, ledgeDepth: 0, rows: [3, 7, 13, 22, 50], wobble: 1.0, fissures: false, arcDensity: 2 },
  far: { ds: 12, bevel: 0.05, bevelSegs: 1, ledgeDepth: 0, rows: [6, 30, 60], wobble: 1.5, fissures: false, arcDensity: 1 },
};

// --- Outline -------------------------------------------------------------------------------

/** Round the corners of a convex polygon with circular fillets. */
function filleted(poly: V2[], radius: number, arcDensity: number): V2[] {
  const out: V2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n], v = poly[i], q = poly[(i + 1) % n];
    const ax = p.x - v.x, az = p.z - v.z, bx = q.x - v.x, bz = q.z - v.z;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 1e-6 || lb < 1e-6) continue;
    const ux = ax / la, uz = az / la, wx = bx / lb, wz = bz / lb;
    const interior = Math.acos(Math.max(-1, Math.min(1, ux * wx + uz * wz)));
    const tanHalf = Math.tan(interior / 2);
    // Tangent distance from the corner, kept under 45% of each edge.
    const td = Math.min(radius / Math.max(tanHalf, 1e-3), 0.45 * la, 0.45 * lb);
    const r = td * tanHalf;
    const turn = Math.PI - interior;
    const segs = Math.max(1, Math.ceil(turn * arcDensity));
    const t0 = { x: v.x + ux * td, z: v.z + uz * td };
    const t1 = { x: v.x + wx * td, z: v.z + wz * td };
    // Arc centre along the bisector.
    const bxs = ux + wx, bzs = uz + wz, bl = Math.hypot(bxs, bzs) || 1;
    const cd = r / Math.max(Math.sin(interior / 2), 1e-3);
    const c = { x: v.x + (bxs / bl) * cd, z: v.z + (bzs / bl) * cd };
    const a0 = Math.atan2(t0.z - c.z, t0.x - c.x);
    const a1 = Math.atan2(t1.z - c.z, t1.x - c.x);
    let da = a1 - a0;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    for (let k = 0; k <= segs; k++) {
      const a = a0 + (da * k) / segs;
      out.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r });
    }
  }
  return out;
}

/** Evenly resample a closed polyline. */
function resample(pts: V2[], ds: number, min = 8): V2[] {
  const n = pts.length;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(q.x - p.x, q.z - p.z));
  }
  const total = cum[n];
  const count = Math.max(min, Math.round(total / ds));
  const out: V2[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = (k / count) * total;
    while (cum[seg + 1] < s) seg++;
    const p = pts[seg], q = pts[(seg + 1) % n];
    const t = (s - cum[seg]) / Math.max(cum[seg + 1] - cum[seg], 1e-9);
    out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
  }
  return out;
}

export interface Outline {
  pts: V2[];
  /** Outward unit normals. */
  nrm: V2[];
  /** Arc length at each point. */
  arc: number[];
}

/**
 * The plateau's rim: the cell polygon with rounded corners, evenly
 * resampled, with a little wobble. `calm` points (e.g. bridge ends) keep
 * the rim straight within `calmRadius`.
 */
export function plateauOutline(cell: PlainsCell, tier: PlateauTier, calm: V2[] = [], calmRadius = 6): Outline {
  const corner = cell.kind === 'plain' ? cell.size * 0.24 : 9;
  const pts = resample(filleted(cell.poly, corner, tier.arcDensity), tier.ds);
  const n = pts.length;
  const nrm: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], q = pts[(i + 1) % n];
    const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
    nrm.push({ x: dz / l, z: -dx / l }); // CCW: outward is to the right
  }
  const arc: number[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    arc.push(s);
    s += Math.hypot(pts[(i + 1) % n].x - pts[i].x, pts[(i + 1) % n].z - pts[i].z);
  }
  const seed = cell.id * 0.37;
  const out = pts.map((p, i) => {
    let w = (noise1(arc[i] / 11 + seed, 1) - 0.5) * 1.4 + (noise1(arc[i] / 3.7 + seed, 2) - 0.5) * 0.6;
    for (const c of calm) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      w *= Math.min(1, Math.max(0, (d - calmRadius) / 4));
    }
    return { x: p.x + nrm[i].x * w * tier.wobble, z: p.z + nrm[i].z * w * tier.wobble };
  });
  return { pts: out, nrm, arc };
}

// --- Geometry --------------------------------------------------------------------------------

/** Accumulates plateaus (and other terrain pieces) into one indexed geometry. */
export class TerrainBuilder {
  pos: number[] = [];
  idx: number[] = [];
  /** Per vertex: 1 for loose rock (boulders), 0 for plateaus and spires. */
  rock: number[] = [];
  /** Per vertex: baked shade (1 = open rock, lower in fissures and under overhanging ledges). */
  shade: number[] = [];

  get vertexCount(): number { return this.pos.length / 3; }

  /** Add a plateau: flat top, rounded rim, banded walls. Returns its outline. */
  addPlateau(cell: PlainsCell, tier: PlateauTier, outline: Outline): void {
    const { pts, nrm, arc } = outline;
    const n = pts.length;
    const y0 = cell.y;
    const b = Math.min(2.2, Math.max(0.6, cell.size * tier.bevel));

    // Row profile per vertex: [depth, inset] pairs; same count for every vertex.
    // 1) Rounded rim: quarter circle from the top (inset b) down to the wall.
    const rimRows = (): [number, number][] => {
      const rows: [number, number][] = [];
      for (let k = 0; k <= tier.bevelSegs; k++) {
        const phi = (k / tier.bevelSegs) * (Math.PI / 2);
        rows.push([b * (1 - Math.cos(phi)), b * (1 - Math.sin(phi))]);
      }
      return rows;
    };

    // 2) Ledges: two rows hugging every stratum boundary between the rim and ledgeDepth.
    let kHi = 0, kLo = 0;
    if (tier.ledgeDepth > 0) {
      let wmin = Infinity, wmax = -Infinity;
      for (const p of pts) { const w = strataWave(p.x, p.z); wmin = Math.min(wmin, w); wmax = Math.max(wmax, w); }
      kHi = Math.floor(strataT(y0 - b - 0.4 + wmax));
      kLo = Math.ceil(strataT(y0 - tier.ledgeDepth + wmin));
    }

    const base = this.vertexCount;
    let rowCount = -1;
    for (let i = 0; i < n; i++) {
      const p = pts[i], nm = nrm[i];
      const rows = rimRows();
      const wave = strataWave(p.x, p.z);
      // Fissures: narrow vertical grooves along the wall.
      const fis = tier.fissures ? -0.8 * Math.pow(Math.max(0, noise1(arc[i] / 2.6 + cell.id, 3) - 0.45) / 0.55, 1.3) : 0;
      // Blocks: each stratum juts out or is eroded back by a different amount along the wall.
      const block = (k: number) => tier.fissures ? 0.4 * (noise1(arc[i] / 4.5 + k * 3.1 + cell.id, 4) - 0.5) : 0;
      const wallRows: [number, number, number][] = [];
      const fisShade = 1 - 0.55 * Math.min(1, -fis / 0.5);
      let prevDepth = b + 0.25;
      for (let k = kHi; k >= kLo && tier.ledgeDepth > 0; k--) {
        const yk = strataH(k) - wave; // world y of boundary k here
        const depth = y0 - yk;
        // Above the boundary is stratum k, below it stratum k-1.
        const above = Math.max(depth - 0.12, prevDepth + 0.02);
        const below = Math.max(depth + 0.12, above + 0.02);
        const fade = Math.min(1, Math.max(0, (above - b) / 1.5));
        const jutAbove = ledge(k) + block(k), jutBelow = ledge(k - 1) + block(k - 1);
        // In the shadow of the stratum above when it juts out further.
        const under = 1 - 0.45 * Math.min(1, Math.max(0, (jutAbove - jutBelow) / 0.5)) * fade;
        wallRows.push([above, -(jutAbove + fis) * fade, fisShade]);
        wallRows.push([below, -(jutBelow + fis) * fade, fisShade * under]);
        prevDepth = below;
      }
      for (const d of tier.rows) wallRows.push([Math.max(d, prevDepth + 0.05), -fis * 0.5, fisShade]), (prevDepth = Math.max(d, prevDepth + 0.05));
      const all = rows.map(([d, ins]) => [d, ins, 1] as [number, number, number]).concat(wallRows);
      if (rowCount < 0) rowCount = all.length;
      for (const [depth, inset, sh] of all) {
        this.pos.push(p.x - nm.x * inset, y0 - depth, p.z - nm.z * inset);
        this.rock.push(0);
        this.shade.push(sh);
      }
    }
    // Walls and rim: quads between neighbouring vertices, row by row.
    for (let i = 0; i < n; i++) {
      const a = base + i * rowCount, c = base + ((i + 1) % n) * rowCount;
      for (let r = 0; r < rowCount - 1; r++) {
        // Outward-facing winding (counter-clockwise seen from outside).
        this.idx.push(a + r, c + r, a + r + 1, c + r, c + r + 1, a + r + 1);
      }
    }
    // Top: fan from the centroid to the inner rim ring (row 0).
    let cx = 0, cz = 0;
    for (const p of pts) { cx += p.x; cz += p.z; }
    cx /= n; cz /= n;
    const centre = this.vertexCount;
    this.pos.push(cx, y0, cz);
    this.rock.push(0);
    this.shade.push(1);
    for (let i = 0; i < n; i++) {
      this.idx.push(centre, base + ((i + 1) % n) * rowCount, base + i * rowCount);
    }
  }

  /** Append an existing geometry (world space), e.g. a boulder or spire. */
  addGeometry(geo: THREE.BufferGeometry, matrix?: THREE.Matrix4, rock = 0): void {
    const g = geo;
    const p = g.attributes.position;
    const base = this.vertexCount;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (matrix) v.applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      this.rock.push(rock);
      this.shade.push(1);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('aRock', new THREE.Float32BufferAttribute(this.rock, 1));
    geo.setAttribute('aShade', new THREE.Float32BufferAttribute(this.shade, 1));
    geo.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}

// --- Gameplay queries ---------------------------------------------------------------------

/**
 * A walkable plateau: its rim as seen from its centre. The horde reads
 * `center` and `radiusAtPolar` (arrivals climb over the rim, warriors keep
 * clear of it).
 */
export class Plateau {
  readonly center: THREE.Vector3;
  private radii: number[] = [];

  constructor(readonly cell: PlainsCell, readonly outline: Outline, samples = 240) {
    // The power-diagram site sits inside its cell: use it as the centre.
    const cx = cell.site.x, cz = cell.site.z;
    this.center = new THREE.Vector3(cx, cell.y, cz);
    const from = { x: cx, z: cz };
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * TAU;
      const hit = rayExit(outline.pts, from, { x: Math.cos(a), z: Math.sin(a) });
      this.radii.push(Math.hypot(hit.x - cx, hit.z - cz));
    }
  }

  /**
   * Distance from the centre to the rim along a world-space heading angle
   * measured like Math.atan2(z, x).
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
