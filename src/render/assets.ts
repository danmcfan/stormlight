import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Models built by the Blender pipeline (scripts/blender/, public/models/). */
export interface Models {
  /** Origin at the grip (right hand); blade along +Y, cutting edge toward +Z. */
  shardblade: THREE.Object3D;
  /**
   * Shardplate as rigid pieces, one node per bone (helm, breastplate,
   * upperarm_l, ...), each with its origin at that joint. See
   * scripts/blender/build_shardplate.py and HumanoidModel.
   */
  shardplate: THREE.Object3D;
}

const url = (file: string) => `${import.meta.env.BASE_URL}models/${file}`;

async function load(loader: GLTFLoader, file: string): Promise<THREE.Object3D> {
  const gltf = await loader.loadAsync(url(file));
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
  });
  return gltf.scene;
}

export async function loadModels(): Promise<Models> {
  const loader = new GLTFLoader();
  const [shardblade, shardplate] = await Promise.all([load(loader, 'shardblade.glb'), load(loader, 'shardplate.glb')]);
  return { shardblade, shardplate };
}
