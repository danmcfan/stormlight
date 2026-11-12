import { mulberry32 } from '../core/math';

/**
 * Layout of the Shattered Plains: a vast, nearly flat expanse broken into
 * hundreds of flat-topped slabs, like dried mud cracked from above, with
 * narrow deep chasms between tightly packed plateaus.
 *
 * Built as a power diagram (a Voronoi diagram where each site has a weight,
 * so the assault plateau can be much bigger than its neighbours). Every cell
 * is a convex polygon; each edge is pulled back by half the chasm width
 * between the two cells, so neighbours are separated by straight-walled
 * chasms of a chosen width. Cells grow with distance from the battlefield
 * (detail where you fight, big cheap slabs on the horizon).
 *
 * Pure data (no three.js), so it can be unit tested.
 */

export interface V2 { x: number; z: number }

export type CellKind = 'main' | 'staging' | 'plain';

export interface PlainsCell {
  id: number;
  kind: CellKind;
  /** Power-diagram site. */
  site: V2;
  /** Nominal slab spacing here (metres); drives corner rounding and detail. */
  size: number;
  /** Height of the flat top. */
  y: number;
  /** Convex outline after the chasm inset, counter-clockwise in (x, z). */
  poly: V2[];
  /** Distance of the site from the battlefield centre. */
  dist: number;
  /** Random number in [0, 1) for per-cell variation. */
  rand: number;
}

export interface LayoutOptions {
  seed: number;
  /** Radius of the plains around the battlefield. */
  extent: number;
  main: { r: number };
  staging: { r: number };
  /** Chasm crossed by the bridge, between the assault and staging plateaus. */
  bridgeGap: number;
  /** Narrowest chasm round the assault plateau (horde climbers come up out of it). */
  mainGap: number;
}

export interface PlainsLayout {
  cells: PlainsCell[];
  main: PlainsCell;
  staging: PlainsCell;
  /** Distance from the assault plateau's centre to its rim along -Z (the bridge side). */
  mainNorthEdge: number;
  /** Distance from the staging plateau's centre to its rim along +Z. */
  stagingSouthEdge: number;
  stagingZ: number;
}

export const defaultLayout: LayoutOptions = {
  seed: 1337,
  extent: 1000,
  main: { r: 41 },
  staging: { r: 26 },
  bridgeGap: 11,
  mainGap: 6.5,
};

/** Slab spacing at a distance from the battlefield. */
export function spacingAt(d: number): number {
  return 14 + 0.075 * d;
}

/** Chasm width between two cells at a distance from the battlefield. */
function gapBetween(a: Site, b: Site, h: number, o: LayoutOptions): number {
  const kinds = [a.kind, b.kind];
  if (kinds.includes('main') && kinds.includes('staging')) return o.bridgeGap;
  const d = Math.min(a.dist, b.dist);
  // Narrow near the fight, wider (but still narrow next to the slabs) far off.
  let g = (2.6 + 0.022 * d) * (0.75 + 0.6 * h);
  if (kinds.includes('main')) g = Math.max(g, o.mainGap + 2 * h);
  if (kinds.includes('staging')) g = Math.max(g, 4.5);
  return g;
}

interface Site extends V2 { kind: CellKind; s: number; w: number; dist: number }

/** Clip a convex polygon to the half-plane a·p <= c. */
export function clipHalfPlane(poly: V2[], ax: number, az: number, c: number): V2[] {
  const out: V2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const dp = ax * p.x + az * p.z - c, dq = ax * q.x + az * q.z - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return out;
}

export function polyArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Symmetric hash of a cell pair → [0, 1). */
function pairHash(i: number, j: number, seed: number): number {
  const a = Math.min(i, j), b = Math.max(i, j);
  let h = (a * 374761393 + b * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function buildLayout(o: LayoutOptions = defaultLayout): PlainsLayout {
  const rng = mulberry32(o.seed);
  // The assault plateau at the origin, the staging plateau to the north (-Z).
  const stagingZ = -(o.main.r + o.staging.r + o.bridgeGap);
  const sites: Site[] = [
    { x: 0, z: 0, kind: 'main', s: o.main.r * 2, w: o.main.r * o.main.r, dist: 0 },
    { x: 0, z: stagingZ, kind: 'staging', s: o.staging.r * 2, w: o.staging.r * o.staging.r, dist: -stagingZ },
  ];

  // --- Sites: dart throwing with a spacing that grows with distance --------------
  const cellSize = 24;
  const grid = new Map<string, Site[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
  const addToGrid = (s: Site) => {
    const k = key(s.x, s.z);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(s);
  };
  const near = (x: number, z: number, r: number): Site[] => {
    const out: Site[] = [];
    const c0 = Math.floor((x - r) / cellSize), c1 = Math.floor((x + r) / cellSize);
    const r0 = Math.floor((z - r) / cellSize), r1 = Math.floor((z + r) / cellSize);
    for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) {
      const list = grid.get(`${i},${j}`);
      if (list) out.push(...list);
    }
    return out;
  };
  const tries = 60000;
  const bridgeMid = { x: 0, z: -(o.main.r + o.bridgeGap / 2) };
  for (let t = 0; t < tries; t++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * o.extent;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const s = spacingAt(d) * (0.85 + rng() * 0.35);
    // Keep the big plateaus' own ground clear, and a corridor beside the bridge
    // so the shared rim is long and straight where the bridge lands.
    if (Math.hypot(x, z) < o.main.r + s * 0.6) continue;
    if (Math.hypot(x, z - stagingZ) < o.staging.r + s * 0.6) continue;
    if (Math.hypot(x - bridgeMid.x, z - bridgeMid.z) < 22) continue;
    let ok = true;
    for (const q of near(x, z, 60)) {
      if (Math.hypot(q.x - x, q.z - z) < 0.5 * (s + Math.min(q.s, 120)) * 0.82) { ok = false; break; }
    }
    if (!ok) continue;
    const site: Site = { x, z, kind: 'plain', s, w: (s * 0.5) ** 2, dist: d };
    sites.push(site);
    addToGrid(site);
  }
  for (const s of sites.slice(0, 2)) addToGrid(s);

  // --- Cells: clip a box round each site by its neighbours' half-planes -------------
  const cells: PlainsCell[] = [];
  const idOf = new Map<Site, number>();
  sites.forEach((s, i) => idOf.set(s, i));
  for (let i = 0; i < sites.length; i++) {
    const si = sites[i];
    const R = si.kind === 'plain' ? si.s * 1.6 : si.s * 1.2;
    let poly: V2[] = [
      { x: si.x - R, z: si.z - R }, { x: si.x + R, z: si.z - R },
      { x: si.x + R, z: si.z + R }, { x: si.x - R, z: si.z + R },
    ];
    const cands = near(si.x, si.z, R * 2 + 60);
    for (const sj of cands) {
      if (sj === si) continue;
      const dx = sj.x - si.x, dz = sj.z - si.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const g = gapBetween(si, sj, pairHash(i, idOf.get(sj)!, o.seed), o);
      // Power bisector |p-pi|² - wi = |p-pj|² - wj, pulled back by g/2 toward i.
      const ax = 2 * dx, az = 2 * dz;
      const c = (sj.x * sj.x + sj.z * sj.z) - (si.x * si.x + si.z * si.z) - sj.w + si.w - g * len;
      poly = clipHalfPlane(poly, ax, az, c);
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;
    // Cells still touching the starting box are unbounded (edge of the plains): drop.
    if (si.kind === 'plain' && poly.some((p) => Math.abs(p.x - si.x) > R - 1e-3 || Math.abs(p.z - si.z) > R - 1e-3)) continue;
    const area = polyArea(poly);
    if (area < 0) poly.reverse();
    if (Math.abs(area) < si.s * si.s * 0.12) continue; // slivers become wider chasms
    const rand = rng();
    // A few slabs are missing altogether: wider, irregular chasm junctions.
    if (si.kind === 'plain' && si.dist > 90 && rand < 0.04) continue;
    const y = si.kind !== 'plain' ? 0
      : si.dist < 160 ? (rng() - 0.6) * 3.2
      : (rng() - 0.55) * 9;
    // Now and then a far slab stands tall: a butte above the plain (as on the reference horizon).
    const butte = si.kind === 'plain' && si.dist > 220 && rng() < 0.07 ? 10 + rng() * 20 : 0;
    cells.push({ id: i, kind: si.kind, site: { x: si.x, z: si.z }, size: si.kind === 'plain' ? si.s : 30, y: y + butte, poly, dist: si.dist, rand });
  }

  const main = cells.find((c) => c.kind === 'main')!;
  const staging = cells.find((c) => c.kind === 'staging')!;
  return {
    cells, main, staging, stagingZ,
    mainNorthEdge: -rayExit(main.poly, { x: 0, z: 0 }, { x: 0, z: -1 }).z,
    stagingSouthEdge: rayExit(staging.poly, { x: 0, z: stagingZ }, { x: 0, z: 1 }).z - stagingZ,
  };
}

/** Where a ray from inside a convex polygon leaves it. */
export function rayExit(poly: V2[], from: V2, dir: V2): V2 {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x, ez = q.z - p.z;
    const den = dir.x * ez - dir.z * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p.x - from.x) * ez - (p.z - from.z) * ex) / den;
    const u = ((p.x - from.x) * dir.z - (p.z - from.z) * dir.x) / den;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return { x: from.x + dir.x * best, z: from.z + dir.z * best };
}
