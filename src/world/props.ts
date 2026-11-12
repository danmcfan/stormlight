import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mulberry32 } from '../core/math';

/**
 * Plains props. Rockbuds, the chrysalis and the bridge are modelled in
 * Blender (scripts/blender/build_plains_props.py → public/models/plains-props.glb);
 * boulders and rock spires are generated here and drawn with the terrain
 * material, so they carry the same strata as the plateaus.
 */

export interface PlainsProps {
  rockbudClosed: THREE.Mesh;
  rockbudOpen: THREE.Mesh;
  chrysalis: THREE.Mesh;
  bridge: THREE.Mesh;
}

/** Pick the prop meshes out of the loaded GLB scene. */
export function plainsPropsFrom(root: THREE.Object3D): PlainsProps {
  const get = (name: string) => {
    const o = root.getObjectByName(name);
    let mesh: THREE.Mesh | undefined;
    o?.traverse((c) => { if (!mesh && (c as THREE.Mesh).isMesh) mesh = c as THREE.Mesh; });
    if (!mesh) throw new Error(`plains-props.glb: missing ${name}`);
    return mesh;
  };
  return { rockbudClosed: get('rockbud_closed'), rockbudOpen: get('rockbud_open'), chrysalis: get('chrysalis'), bridge: get('bridge') };
}

/** Rockbuds: squat ridged clam shells, some open with vines. Two instanced meshes. */
export function makeRockbuds(points: THREE.Vector3[], props: PlainsProps, seed: number): THREE.Group {
  const rng = mulberry32(seed);
  const g = new THREE.Group();
  const open = points.filter(() => rng() < 0.55);
  const closed = points.filter((p) => !open.includes(p));
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [src, list] of [[props.rockbudOpen, open], [props.rockbudClosed, closed]] as const) {
    const inst = new THREE.InstancedMesh(src.geometry, src.material, list.length);
    list.forEach((pt, i) => {
      const k = 0.95 + rng() * 0.6;
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      mtx.compose(pt, q, s.set(k, k * (0.85 + rng() * 0.3), k));
      inst.setMatrixAt(i, mtx);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    g.add(inst);
  }
  return g;
}

/** The gemheart chrysalis, standing on the plateau at `pos`. */
export function makeChrysalis(props: PlainsProps, pos: THREE.Vector3, rotY = 0): THREE.Mesh {
  const m = new THREE.Mesh(props.chrysalis.geometry, props.chrysalis.material);
  m.position.copy(pos);
  m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A bridge-crew bridge: heavy planks along the span on two beams. `length` along Z. */
export function makeBridge(props: PlainsProps, length: number): THREE.Mesh {
  const m = new THREE.Mesh(props.bridge.geometry, props.bridge.material);
  // Modelled 18 m long along -Z; the deck top at y = 0.
  m.scale.z = length / 18;
  m.position.y = 0.05;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * A broken boulder: the convex hull of a box of points, cut by a few random
 * planes, so it has flat fractured faces like a piece split off a slab.
 * Returned in world space (centred on `at`, resting on its base).
 */
export function boulderGeometry(seed: number, size: number, squash: number, at: THREE.Vector3): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const sx = size * (0.8 + rng() * 0.5), sy = size * squash * (0.7 + rng() * 0.5), sz = size * (0.7 + rng() * 0.5);
  const cuts: { n: THREE.Vector3; d: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const n = new THREE.Vector3(rng() - 0.5, (rng() - 0.3) * 0.8, rng() - 0.5).normalize();
    cuts.push({ n, d: 0.55 + rng() * 0.3 });
  }
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 70; i++) {
    const p = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
    // Push toward the surface of a rounded box.
    const m = Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
    p.multiplyScalar(0.8 / m + 0.2);
    let ok = true;
    for (const c of cuts) if (p.dot(c.n) > c.d) { ok = false; break; }
    if (!ok) continue;
    pts.push(p.multiply(new THREE.Vector3(sx, sy, sz)));
  }
  const geo = new ConvexGeometry(pts);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo.computeBoundingBox();
  const rot = rng() * Math.PI * 2;
  geo.rotateY(rot);
  geo.translate(at.x, at.y - geo.boundingBox!.min.y - sy * 0.25, at.z);
  return geo;
}

/** A lone rock spire: a tapering, slightly bent column of banded rock. World space. */
export function spireGeometry(seed: number, height: number, baseR: number, at: THREE.Vector3): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const rings = 14, sides = 10;
  const pos: number[] = [];
  const idx: number[] = [];
  const bend = new THREE.Vector2((rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25);
  const ph = rng() * 10;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const y = -6 + (height + 6) * t;
    // Wide base, narrowing to a blunt, slightly hooked tip.
    const rad = baseR * (1 - 0.82 * Math.pow(t, 0.8)) * (1 + 0.25 * Math.max(0, 0.15 - t) / 0.15);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const lump = 1 + 0.16 * Math.sin(a * 3 + ph + t * 4) + 0.08 * Math.sin(a * 5 + t * 9);
      pos.push(
        at.x + Math.cos(a) * rad * lump + bend.x * y * t * 2,
        at.y + y,
        at.z + Math.sin(a) * rad * lump + bend.y * y * t * 2,
      );
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s, b = r * sides + ((s + 1) % sides);
      idx.push(a, a + sides, b, b, a + sides, b + sides);
    }
  }
  const tip = pos.length / 3;
  const last = rings * sides;
  let tx = 0, ty = 0, tz = 0;
  for (let s = 0; s < sides; s++) { tx += pos[(last + s) * 3]; ty += pos[(last + s) * 3 + 1]; tz += pos[(last + s) * 3 + 2]; }
  pos.push(tx / sides, ty / sides + baseR * 0.15, tz / sides);
  for (let s = 0; s < sides; s++) idx.push(last + s, tip, last + ((s + 1) % sides));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}
