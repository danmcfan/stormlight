import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Rapier = typeof RAPIER;

export class Physics {
  readonly world: RAPIER.World;

  private constructor(readonly R: Rapier) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics(RAPIER);
  }

  /**
   * Static triangle-mesh collider matching a mesh's world-space geometry.
   * Vertices are welded and internal edges fixed so characters don't snag
   * on the seams between triangles of a flat surface.
   */
  addStaticMesh(mesh: THREE.Mesh): void {
    mesh.updateWorldMatrix(true, false);
    const src = mesh.geometry.clone();
    src.deleteAttribute('normal');
    src.deleteAttribute('uv');
    src.deleteAttribute('color');
    src.applyMatrix4(mesh.matrixWorld);
    const geo = mergeVertices(src, 1e-3);
    const pos = new Float32Array(geo.attributes.position.array);
    const indices = new Uint32Array(geo.index!.array);
    const desc = this.R.ColliderDesc.trimesh(pos, indices, this.R.TriMeshFlags.FIX_INTERNAL_EDGES);
    this.world.createCollider(desc);
    src.dispose();
    geo.dispose();
  }

  /** Static convex hull around a mesh's world-space vertices (rocks etc.). */
  addStaticHull(mesh: THREE.Mesh): void {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    const desc = this.R.ColliderDesc.convexHull(new Float32Array(geo.attributes.position.array));
    if (desc) this.world.createCollider(desc);
    geo.dispose();
  }

  addStaticBox(center: THREE.Vector3, half: THREE.Vector3, rotY = 0): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    this.world.createCollider(
      this.R.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
  }
}
