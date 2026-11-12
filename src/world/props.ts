import * as THREE from 'three';
import { mulberry32 } from '../core/math';

const bridgeRng = mulberry32(7);

const rockMat = new THREE.MeshStandardMaterial({ color: '#a8927a', roughness: 0.92, flatShading: true });

/** Lumpy flat-shaded boulder. */
export function makeRock(seed: number, size: number, squash = 0.7): THREE.Mesh {
  const rng = mulberry32(seed);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  // Jitter shared vertices identically so the surface stays closed.
  const offsets = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = offsets.get(key);
    if (k === undefined) { k = 0.75 + rng() * 0.5; offsets.set(key, k); }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, rockMat);
  m.scale.set(size * (0.8 + rng() * 0.6), size * squash * (0.7 + rng() * 0.6), size * (0.8 + rng() * 0.6));
  m.rotation.y = rng() * Math.PI * 2;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** The gemheart chrysalis: a huge ridged shell growing out of the plateau. */
export function makeChrysalis(): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ridge = 1 + 0.08 * Math.sin(Math.atan2(v.z, v.x) * 9) + 0.05 * Math.sin(v.y * 11);
    v.multiplyScalar(ridge);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#8f897d', roughness: 0.75, flatShading: true }));
  m.scale.set(4.2, 5.2, 3.6);
  m.position.y = 2.4;
  m.rotation.z = 0.12;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Rockbuds: little shelled plants with green tendrils, scattered instanced. */
export function makeRockbuds(points: THREE.Vector3[], seed: number): THREE.Group {
  const rng = mulberry32(seed);
  const g = new THREE.Group();
  const shell = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.35, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#8c8a80', roughness: 1, flatShading: true }),
    points.length,
  );
  const vines = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.22, 0.55, 5),
    new THREE.MeshStandardMaterial({ color: '#7f9a55', roughness: 0.9, flatShading: true }),
    points.length,
  );
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  points.forEach((pt, i) => {
    const k = 0.6 + rng() * 0.9;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
    mtx.compose(pt, q, s.set(k, k * 0.8, k));
    shell.setMatrixAt(i, mtx);
    mtx.compose(new THREE.Vector3(pt.x, pt.y + 0.28 * k, pt.z), q, s.set(k, k, k));
    vines.setMatrixAt(i, mtx);
  });
  shell.receiveShadow = vines.receiveShadow = true;
  g.add(shell, vines);
  return g;
}

/** A Sadeas-style wooden bridge: plank deck, cross beams, no rails. */
export function makeBridge(length: number, width = 3.2): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#7d6a55', roughness: 0.9, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: '#5a4a3b', roughness: 0.95, flatShading: true });
  const planks = Math.round(length / 0.45);
  for (let i = 0; i < planks; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(width * (0.96 + bridgeRng() * 0.06), 0.12, 0.4), wood);
    p.position.set((bridgeRng() - 0.5) * 0.08, -0.02, -length / 2 + (i + 0.5) * (length / planks));
    p.castShadow = p.receiveShadow = true;
    g.add(p);
  }
  for (const side of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, length), dark);
    beam.position.set(side * (width / 2 - 0.25), -0.26, 0);
    beam.castShadow = true;
    g.add(beam);
  }
  return g;
}
