import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Cut a box-built crowd model's draw calls: within each animated group, merge
 * the static leaf meshes that share a material into one mesh. Bones (groups)
 * and materials are untouched, so animation and hit flashes work as before.
 * A Parshendi warrior drops from ~30 draws to ~12, which matters with 40 of
 * them on screen (twice over, with the shadow pass).
 *
 * Kept outside the model code so it can run on any finished model.
 */
export function mergeStaticMeshes(root: THREE.Object3D): number {
  let removed = 0;
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.children.length > 1) parents.push(o); });
  for (const parent of parents) {
    const groups = new Map<string, THREE.Mesh[]>();
    for (const c of parent.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || m.children.length || Array.isArray(m.material) || m.name) continue;
      const g = m.geometry;
      if (!g.index || !g.attributes.normal || !g.attributes.uv) continue;
      const key = `${(m.material as THREE.Material).uuid}|${m.castShadow}|${m.receiveShadow}|${!!m.userData.noShadow}`;
      let list = groups.get(key);
      if (!list) groups.set(key, list = []);
      list.push(m);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const g = m.geometry.clone().applyMatrix4(m.matrix);
        // Keep only the attributes every box shares.
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        return g;
      });
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const first = list[0];
      const mesh = new THREE.Mesh(merged, first.material);
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.userData.noShadow = first.userData.noShadow;
      for (const m of list) { parent.remove(m); m.geometry.dispose(); }
      parent.add(mesh);
      removed += list.length - 1;
    }
  }
  return removed;
}
