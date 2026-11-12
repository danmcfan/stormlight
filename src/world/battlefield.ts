import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import type { Physics } from '../core/physics';
import type { Models } from '../render/assets';
import { Plateau, TIERS, TerrainBuilder, plateauOutline, type PlateauTier } from './plateau';
import { buildLayout, type PlainsCell, type V2 } from './plainsLayout';
import { boulderGeometry, makeBridge, makeChrysalis, makeRockbuds, plainsPropsFrom, spireGeometry } from './props';
import { makeTerrainMaterial } from './terrainMaterial';

export interface Battlefield {
  spawn: THREE.Vector3;
  spawnHeading: number;
  /** Just off the bridge on the assault plateau: where you return after falling. */
  landing: THREE.Vector3;
  /** Staging-side end of the bridge deck: the match shot stands near here. */
  bridgeStart: THREE.Vector3;
  /** Where Parshendi stand, with the heading they face. */
  enemySpots: { pos: THREE.Vector3; heading: number; role: 'warrior' | 'duelist' }[];
  /** The assault plateau (rim queries for horde arrivals and ledge falls). */
  main: Plateau;
  /** Bridge ends: staging side and assault side (horde reinforcements cross it). */
  bridgeFar: THREE.Vector3;
  bridgeNear: THREE.Vector3;
  /** Rock footprints on the assault plateau (x, z, radius), to keep arrivals clear. */
  rocks: { x: number; z: number; r: number }[];
  chrysalis: { x: number; z: number; r: number };
}

/** Slabs within this distance of the battlefield get full detail (ledges, fissures, shadows). */
const NEAR = 140;
const MID = 400;
/** Slabs within this distance get colliders (falling bodies hit their walls). */
const COLLIDE = 95;

function centroid(poly: V2[]): V2 {
  let x = 0, z = 0;
  for (const p of poly) { x += p.x; z += p.z; }
  return { x: x / poly.length, z: z / poly.length };
}

/** Distance from a point inside a convex CCW polygon to its nearest edge (negative outside). */
function insideDistance(poly: V2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x, ez = q.z - p.z, l = Math.hypot(ex, ez) || 1;
    // Outward normal (ez, -ex)/l; inside distance = -(signed distance).
    d = Math.min(d, -(((x - p.x) * ez - (z - p.z) * ex) / l));
  }
  return d;
}

function randomInCell(cell: PlainsCell, rng: () => number, inset: number): THREE.Vector3 | null {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of cell.poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  for (let i = 0; i < 20; i++) {
    const x = x0 + (x1 - x0) * rng(), z = z0 + (z1 - z0) * rng();
    if (insideDistance(cell.poly, x, z) > inset) return new THREE.Vector3(x, cell.y, z);
  }
  return null;
}

/**
 * The Shattered Plains around the fight: the assault plateau (centred at the
 * origin, chrysalis in the middle), the staging plateau you cross from, the
 * bridge between them, and hundreds of slabs out to the horizon
 * (plainsLayout.ts), all in a handful of merged meshes.
 */
export function buildBattlefield(scene: THREE.Scene, physics: Physics, models: Models): Battlefield {
  const rng = mulberry32(1337);
  const layout = buildLayout();
  const material = makeTerrainMaterial(models.terrainDetail);
  const props = plainsPropsFrom(models.plainsProps);

  const mainEdge = layout.mainNorthEdge;
  const stagingZ = layout.stagingZ;
  const stagingEdge = layout.stagingSouthEdge;
  const gap = -stagingZ - mainEdge - stagingEdge;
  const bridgeZ = -mainEdge - gap / 2;
  // Keep the rims straight where the bridge rests.
  const calm: Record<number, V2[]> = {
    [layout.main.id]: [{ x: 0, z: -mainEdge }],
    [layout.staging.id]: [{ x: 0, z: stagingZ + stagingEdge }],
  };

  // --- Plateaus --------------------------------------------------------------------
  const near = new TerrainBuilder();
  const mid = new TerrainBuilder();
  const far = new TerrainBuilder();
  const collide = new TerrainBuilder();
  let main: Plateau | null = null, staging: Plateau | null = null;
  for (const cell of layout.cells) {
    const big = cell.kind !== 'plain';
    const tier: PlateauTier = big || cell.dist < NEAR ? TIERS.near : cell.dist < MID ? TIERS.mid : TIERS.far;
    const outline = plateauOutline(cell, tier, calm[cell.id]);
    (tier === TIERS.near ? near : tier === TIERS.mid ? mid : far).addPlateau(cell, tier, outline);
    if (big || cell.dist < COLLIDE) collide.addPlateau(cell, { ...tier, rows: [16] , ledgeDepth: 14 }, outline);
    if (cell.kind === 'main') main = new Plateau(cell, outline);
    if (cell.kind === 'staging') staging = new Plateau(cell, outline);
  }
  if (!main || !staging) throw new Error('plains layout lost a plateau');

  // --- Chrysalis ------------------------------------------------------------------------
  const chrysalis = makeChrysalis(props, new THREE.Vector3(2, 0, 6), 0.4);
  scene.add(chrysalis);
  physics.addStaticHull(chrysalis);

  // --- Bridge ------------------------------------------------------------------------------
  const overlap = 3.5;
  const bridgeLen = gap + overlap * 2;
  const bridge = makeBridge(props, bridgeLen);
  bridge.position.set(0, bridge.position.y, bridgeZ);
  scene.add(bridge);
  // Collider top is flush with the plateau tops so there is no lip to step over.
  physics.addStaticBox(new THREE.Vector3(0, -0.2, bridgeZ), new THREE.Vector3(1.6, 0.2, bridgeLen / 2));

  // --- Boulders: broken slabs of the same rock ----------------------------------------------
  const keepClear = (p: THREE.Vector3) =>
    p.distanceTo(chrysalis.position) < 10 || (Math.abs(p.x) < 5 && p.z < -mainEdge + 14); // chrysalis + bridge landing
  const rocks: Battlefield['rocks'] = [];
  const addBoulder = (seed: number, size: number, squash: number, at: THREE.Vector3, solid: boolean) => {
    const geo = boulderGeometry(seed, size, squash, at);
    if (solid) physics.addStaticHull(new THREE.Mesh(geo));
    near.addGeometry(geo, undefined, 1);
    const bb = geo.boundingBox ?? (geo.computeBoundingBox(), geo.boundingBox!);
    return Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
  };
  let placed = 0;
  for (let i = 0; placed < 16 && i < 200; i++) {
    const p = main.randomPoint(rng, 0.9);
    if (keepClear(p)) continue;
    const big = rng() < 0.2;
    const r = addBoulder(100 + i, big ? 1.6 + rng() * 1.0 : 0.6 + rng() * 0.8, big ? 0.7 : 0.55, p, true);
    rocks.push({ x: p.x, z: p.z, r: r * 1.15 + 0.5 });
    placed++;
  }
  for (let i = 0; i < 6; i++) {
    const p = staging.randomPoint(rng, 0.85);
    if (Math.abs(p.x) < 5 && p.z > stagingZ + 10) continue;
    addBoulder(400 + i, 0.7 + rng() * 1.5, 0.6, p, true);
  }
  for (const cell of layout.cells) {
    if (cell.kind !== 'plain' || cell.dist > NEAR || cell.rand > 0.45) continue;
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const p = randomInCell(cell, rng, 2);
      if (p) addBoulder(700 + cell.id * 7 + i, 0.6 + rng() * 1.6, 0.6, p, cell.dist < COLLIDE);
    }
  }

  // --- Rock spires, here and there across the plains --------------------------------------------
  // A lone spire now and then (plains-cracked-slabs-spire.png), never crowding the sky.
  const spireCells = layout.cells.filter((c) => c.kind === 'plain' && c.dist > 260 && c.dist < 800 && c.size > 28);
  let spires = 0;
  for (const cell of spireCells) {
    if (rng() > 0.012 || spires >= 4) continue;
    const c = centroid(cell.poly);
    const inR = insideDistance(cell.poly, c.x, c.z);
    if (inR < 6) continue;
    const h = 22 + rng() * 25;
    mid.addGeometry(spireGeometry(900 + cell.id, h, Math.min(inR * 0.7, 5 + h * 0.08), new THREE.Vector3(c.x, cell.y, c.z)));
    spires++;
  }

  // --- Meshes ---------------------------------------------------------------------------------
  const add = (b: TerrainBuilder, shadows: boolean) => {
    const mesh = new THREE.Mesh(b.build(), material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  add(near, true);
  add(mid, false);
  add(far, false);
  const collider = new THREE.Mesh(collide.build());
  physics.addStaticMesh(collider);
  collider.geometry.dispose();

  // --- Rockbuds (decoration only) ---------------------------------------------------------------
  const buds: THREE.Vector3[] = [];
  const nearBridge = (p: THREE.Vector3) => Math.abs(p.x) < 3 && (Math.abs(p.z + mainEdge) < 9 || Math.abs(p.z - stagingZ - stagingEdge) < 9);
  for (let i = 0; i < 110; i++) buds.push(main.randomPoint(rng, 0.94));
  for (let i = 0; i < 35; i++) buds.push(staging.randomPoint(rng, 0.9));
  // Thicker along the rim facing the bridge, as in the style reference.
  for (let i = 0; i < 30; i++) {
    const a = -Math.PI / 2 + (rng() - 0.5) * 1.6;
    const r = main.radiusAtPolar(a) - 2.5 - rng() * 10;
    buds.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  for (const cell of layout.cells) {
    if (cell.kind !== 'plain' || cell.dist > 110) continue;
    const n = 2 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) { const p = randomInCell(cell, rng, 1.2); if (p) buds.push(p); }
  }
  const clear = (p: THREE.Vector3) => p.distanceTo(chrysalis.position) > 5.5 && !nearBridge(p)
    && !rocks.some((r) => Math.hypot(p.x - r.x, p.z - r.z) < r.r);
  scene.add(makeRockbuds(buds.filter(clear), props, 99));

  // --- Parshendi positions ------------------------------------------------------
  const enemySpots: Battlefield['enemySpots'] = [];
  const ring = [0.3, 1.2, 2.1, 2.9, 3.8, 4.6, 5.4];
  for (const a of ring) {
    const r = 8.5 + rng() * 2;
    enemySpots.push({
      pos: new THREE.Vector3(chrysalis.position.x + Math.cos(a) * r, 0, chrysalis.position.z + Math.sin(a) * r),
      heading: Math.atan2(Math.cos(a), Math.sin(a)), // face outward
      role: 'warrior',
    });
  }
  // A forward screen near the bridge landing, with a duelist at its centre
  // who comes out to meet you in the open ground.
  for (const x of [-11, 11]) {
    enemySpots.push({ pos: new THREE.Vector3(x, 0, -mainEdge + 21 + rng() * 3), heading: Math.PI, role: 'warrior' });
  }
  enemySpots.push({ pos: new THREE.Vector3(0, 0, -mainEdge + 19), heading: Math.PI, role: 'duelist' });

  return {
    spawn: new THREE.Vector3(0, 0.5, stagingZ + stagingEdge - 6),
    spawnHeading: 0,
    landing: new THREE.Vector3(0, 0.3, -mainEdge + 5),
    bridgeStart: new THREE.Vector3(0, 0, bridgeZ - bridgeLen / 2),
    enemySpots,
    main,
    bridgeFar: new THREE.Vector3(0, 0.3, -mainEdge - gap - 2),
    bridgeNear: new THREE.Vector3(0, 0.3, -mainEdge + 2),
    rocks,
    chrysalis: { x: chrysalis.position.x, z: chrysalis.position.z, r: 8 },
  };
}
