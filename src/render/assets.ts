import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { preparePlateMask } from './platePaint';

/** Models built by the Blender pipeline (scripts/blender/, public/models/). */
export interface Models {
  /** Origin at the grip (right hand); blade along +Y, cutting edge toward +Z. */
  shardblade: THREE.Object3D;
  /**
   * Shardplate as rigid pieces, one node per bone (helm, breastplate,
   * upperarm_l, ...), each with its origin at that joint. See
   * scripts/blender/build_shardplate.py and HumanoidModel. Its paint mask
   * (shardplate-mask.jpg, see platePaint.ts) is on `userData.paintMask`.
   */
  shardplate: THREE.Object3D;
  /** Plains props: rockbuds, chrysalis, bridge (scripts/blender/build_plains_props.py). */
  plainsProps: THREE.Object3D;
  /** Terrain detail map (scripts/gen/make_terrain_textures.py): R top cracks, G cliff, B crem. */
  terrainDetail: THREE.Texture;
}

const url = (file: string) => `${import.meta.env.BASE_URL}models/${file}`;
const textureUrl = (file: string) => `${import.meta.env.BASE_URL}textures/${file}`;

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
  const [shardblade, shardplate, plainsProps, terrainDetail, plateMask] = await Promise.all([
    load(loader, 'shardblade.glb'), load(loader, 'shardplate.glb'), load(loader, 'plains-props.glb'),
    new THREE.TextureLoader().loadAsync(textureUrl('terrain-detail.jpg')),
    new THREE.TextureLoader().loadAsync(url('shardplate-mask.jpg')),
  ]);
  shardplate.userData.paintMask = preparePlateMask(plateMask);
  return { shardblade, shardplate, plainsProps, terrainDetail };
}
