import * as THREE from 'three';

export interface CrowdMember {
  /** The member's model root; its leaf meshes are hidden and drawn instanced. */
  root: THREE.Object3D;
  /** Its leaf meshes, in traversal order (filled by `register`). */
  meshes: THREE.Mesh[];
  /** 0..1 hit flash. */
  flash: number;
  /** Draw this member this frame. */
  show: boolean;
}

/**
 * Draws a crowd of identically built models with one InstancedMesh per body
 * part, instead of one draw per part per model. Each model still animates
 * normally (bones, IK); its meshes are just hidden, and every frame their
 * world matrices are copied into the matching part's instance buffer.
 * 40 Parshendi go from ~900 draws (plus the shadow pass) to ~23.
 *
 * Every registered model must have the same parts in the same order (true for
 * models built by the same code with the same options).
 */
export class CrowdInstancer {
  readonly group = new THREE.Group();
  private parts: THREE.InstancedMesh[] = [];
  private color = new THREE.Color();

  constructor(private capacity: number) {}

  /** Hide a model's meshes and add it to the crowd. Returns its mesh list. */
  register(root: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    if (!this.parts.length) {
      for (const m of meshes) {
        // A shared copy of the part's material: per-warrior flashes go
        // through the instance colour instead.
        const mat = (m.material as THREE.Material).clone();
        const im = new THREE.InstancedMesh(m.geometry, mat, this.capacity);
        im.castShadow = m.castShadow;
        im.receiveShadow = m.receiveShadow;
        im.frustumCulled = false; // members are spread out; the GPU culls cheaply
        im.count = 0;
        im.setColorAt(0, this.color.setRGB(1, 1, 1));
        this.parts.push(im);
        this.group.add(im);
      }
    } else if (meshes.length !== this.parts.length) {
      throw new Error(`CrowdInstancer: model has ${meshes.length} parts, crowd has ${this.parts.length}`);
    }
    for (const m of meshes) m.visible = false;
    return meshes;
  }

  /** Copy every shown member's part matrices into the instance buffers. */
  update(members: readonly CrowdMember[]): void {
    const parts = this.parts;
    let n = 0;
    for (const mem of members) {
      if (!mem.show || n >= this.capacity) continue;
      const f = mem.flash;
      // Pale-blue glint, like the duel's hit flash.
      this.color.setRGB(1 + 0.9 * f, 1 + 1.2 * f, 1 + 1.6 * f);
      for (let k = 0; k < parts.length; k++) {
        parts[k].setMatrixAt(n, mem.meshes[k].matrixWorld);
        parts[k].setColorAt(n, this.color);
      }
      n++;
    }
    for (const im of parts) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}
