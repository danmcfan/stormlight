/**
 * The game's light and Plate materials, shared by the viewer pages so the shading you
 * judge is the shading the player sees. Copied from src/render/look.ts and
 * src/render/humanoid.ts; move them here when those change.
 */
import * as THREE from 'three';

export const LOOK = {
  sunColor: '#fff1dc',
  sunIntensity: 2.7,
  sunElevation: 64,
  sunAzimuth: -28,
  skyLight: '#b9d3ef',
  groundLight: '#d9a273',
  ambient: 0.85,
  exposure: 1.2,
};

/** Plate materials by glTF name, as src/render/humanoid.ts builds them for the player. */
export const PLATE_MATS: Record<string, THREE.MeshStandardMaterialParameters> = {
  plate: { color: '#8d959d', metalness: 0.25, roughness: 0.48 },
  plate_dark: { color: '#2b2724', metalness: 0.05, roughness: 0.85 },
  trim: {
    color: '#323b6e',
    metalness: 0.25,
    roughness: 0.38,
    emissive: new THREE.Color('#080c22'),
    emissiveIntensity: 0.5,
  },
  glow: { color: '#a9ccff', emissive: new THREE.Color('#5aa2ff'), emissiveIntensity: 2.2 },
};

/** The game's sun, sky/ground hemisphere and a dim back fill, added to `scene`. */
export function addGameLights(scene: THREE.Scene) {
  const sun = new THREE.DirectionalLight(LOOK.sunColor, LOOK.sunIntensity);
  const el = THREE.MathUtils.degToRad(LOOK.sunElevation);
  const az = THREE.MathUtils.degToRad(LOOK.sunAzimuth);
  sun.position.setFromSphericalCoords(12, Math.PI / 2 - el, az);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(LOOK.skyLight, LOOK.groundLight, LOOK.ambient));
  // A dim fill from behind so back faces don't go black while inspecting.
  const fill = new THREE.DirectionalLight('#cfe0ff', 0.35);
  fill.position.set(-4, 2, -5);
  scene.add(fill);
}
