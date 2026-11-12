import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import type { Physics } from '../core/physics';
import { Plateau } from './plateau';
import { makeBridge, makeChrysalis, makeRock, makeRockbuds } from './props';

export interface Battlefield {
  spawn: THREE.Vector3;
  spawnHeading: number;
  /** Just off the bridge on the assault plateau: where you return after falling. */
  landing: THREE.Vector3;
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

const NORTH = -Math.PI / 2; // shape-polar angle pointing to world -Z
const SOUTH = Math.PI / 2; // shape-polar angle pointing to world +Z

/**
 * The assault plateau (centred at the origin, chrysalis in the middle), the
 * staging plateau you cross from, the bridge between them, and a ring of
 * distant plateaus for the horizon.
 */
export function buildBattlefield(scene: THREE.Scene, physics: Physics): Battlefield {
  const rng = mulberry32(1337);

  // --- The assault plateau -------------------------------------------------
  const main = new Plateau({ x: 0, z: 0, radius: 44, seed: 11, roughness: 0.16 });
  scene.add(main.mesh);
  physics.addStaticMesh(main.mesh);

  const chrysalis = makeChrysalis();
  chrysalis.position.x = 2; chrysalis.position.z = 6;
  scene.add(chrysalis);
  physics.addStaticHull(chrysalis);

  // --- Staging plateau and bridge -----------------------------------------
  const gap = 11;
  const mainEdge = main.radiusAtPolar(NORTH);
  const stagingSeed = 23;
  const probe = new Plateau({ x: 0, z: 0, radius: 26, seed: stagingSeed });
  const stagingEdge = probe.radiusAtPolar(SOUTH);
  probe.mesh.geometry.dispose();
  const stagingZ = -(mainEdge + gap + stagingEdge);
  const staging = new Plateau({ x: 0, z: stagingZ, radius: 26, seed: stagingSeed });
  scene.add(staging.mesh);
  physics.addStaticMesh(staging.mesh);

  const overlap = 3.5;
  const bridgeLen = gap + overlap * 2;
  const bridge = makeBridge(bridgeLen);
  const bridgeZ = -mainEdge - gap / 2;
  bridge.position.set(0, 0, bridgeZ);
  scene.add(bridge);
  // Collider top is flush with the plateau tops so there is no lip to step over.
  physics.addStaticBox(new THREE.Vector3(0, -0.2, bridgeZ), new THREE.Vector3(1.6, 0.2, bridgeLen / 2));

  // --- Rocks -----------------------------------------------------------------
  const keepClear = (p: THREE.Vector3) =>
    p.distanceTo(chrysalis.position) < 10 || (Math.abs(p.x) < 5 && p.z < -mainEdge + 14); // chrysalis + bridge landing
  const rocks: Battlefield['rocks'] = [];
  let placed = 0;
  for (let i = 0; placed < 16 && i < 200; i++) {
    const p = main.randomPoint(rng, 0.92);
    if (keepClear(p)) continue;
    const big = rng() < 0.3;
    const rock = makeRock(100 + i, big ? 2.4 + rng() * 1.6 : 0.8 + rng() * 1.2, big ? 0.9 : 0.6);
    rock.position.copy(p).setY(rock.scale.y * 0.35);
    scene.add(rock);
    physics.addStaticHull(rock);
    rocks.push({ x: p.x, z: p.z, r: Math.max(rock.scale.x, rock.scale.z) * 1.25 + 0.5 });
    placed++;
  }
  for (let i = 0; i < 6; i++) {
    const p = staging.randomPoint(rng, 0.85);
    if (Math.abs(p.x) < 5 && p.z > stagingZ + 10) continue;
    const rock = makeRock(400 + i, 0.8 + rng() * 1.8);
    rock.position.copy(p).setY(rock.scale.y * 0.35);
    scene.add(rock);
    physics.addStaticHull(rock);
  }

  // --- Rockbuds (decoration only) ---------------------------------------------
  const buds: THREE.Vector3[] = [];
  for (let i = 0; i < 170; i++) buds.push(main.randomPoint(rng, 0.95));
  for (let i = 0; i < 50; i++) buds.push(staging.randomPoint(rng, 0.92));
  scene.add(makeRockbuds(buds.filter((b) => b.distanceTo(chrysalis.position) > 6), 99));

  // --- Distant plateaus for the horizon ---------------------------------------
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rng() * 0.3;
    const d = 115 + rng() * 140;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.abs(x) < 40 && z < -40) continue; // keep the staging approach open
    const p = new Plateau({ x, z, y: -4 + rng() * 10, radius: 22 + rng() * 26, seed: 500 + i });
    p.mesh.castShadow = false;
    scene.add(p.mesh);
  }

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
    enemySpots,
    main,
    bridgeFar: new THREE.Vector3(0, 0.3, -mainEdge - gap - 2),
    bridgeNear: new THREE.Vector3(0, 0.3, -mainEdge + 2),
    rocks,
    chrysalis: { x: chrysalis.position.x, z: chrysalis.position.z, r: 8 },
  };
}
