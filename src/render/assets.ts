import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Models built by the Blender pipeline (scripts/blender/, public/models/). */
export interface Models {
  /** Origin at the grip (right hand); blade along +Y, cutting edge toward +Z. */
  shardblade: THREE.Object3D;
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
  const [shardblade] = await Promise.all([load(loader, 'shardblade.glb')]);
  return { shardblade };
}
