import * as THREE from 'three';
import { look } from './look';

/**
 * Paint on the Shardplate, after the concept close-up (art/source/shardbearer-closeup): the
 * plates are slate steel with darker value in their folds, edges worn bright, orange plateau
 * dust caught in the seams and along the enamel, and visible brushwork.
 *
 * The Plate's materials are swapped per fighter by name (HumanoidModel), so what the GLB
 * carries is not colour but a mask, baked in Blender (scripts/blender/plate_bake.py) on the
 * plate faces' UVs: R occlusion, G worn convex edges, B cavities. This patch reads it and
 * paints with the material's own colours, so the enemy's bronze Plate wears bronze.
 *
 * The mask rides in as the material's aoMap: three then supplies its UV varying, and the
 * occlusion also darkens the sky fill. Brushwork is value noise at two scales in the piece's
 * own space, so it stays put on a moving limb. Cost: one texture read and ~40 ALU ops per
 * Plate pixel.
 */

/** Shared by every painted Plate material; set from look values once a frame. */
export const plateUniforms = {
  uPlateShade: { value: 0.7 },
  uPlateWear: { value: 1.2 },
  uPlateDust: { value: 0.8 },
  uPlateBrush: { value: 0.08 },
};

/** Copy the look values into the shared uniforms. Cheap; call once a frame. */
export function syncPlateUniforms(): void {
  const u = plateUniforms;
  u.uPlateShade.value = look.plateShade;
  u.uPlateWear.value = look.plateWear;
  u.uPlateDust.value = look.plateDust;
  u.uPlateBrush.value = look.plateBrush;
}

const VERT_HEAD = /* glsl */`
varying vec3 vPlateObj;`;

const FRAG_HEAD = /* glsl */`
varying vec3 vPlateObj;
uniform float uPlateShade, uPlateWear, uPlateDust, uPlateBrush;
uniform vec3 uPlateWorn, uPlateDustColor;
float plateHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float plateNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(plateHash(i), plateHash(i + vec3(1, 0, 0)), f.x),
                 mix(plateHash(i + vec3(0, 1, 0)), plateHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(plateHash(i + vec3(0, 0, 1)), plateHash(i + vec3(1, 0, 1)), f.x),
                 mix(plateHash(i + vec3(0, 1, 1)), plateHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

// After the albedo is known, before lighting. Broad strokes are stretched along the piece's
// height so they read as brush drags down the plate, not blotches.
const PAINT = /* glsl */`#include <color_fragment>
{
  vec3 pm = texture2D(aoMap, vAoMapUv).rgb;
  float broad = plateNoise(vPlateObj * vec3(14.0, 2.5, 14.0));
  float fine = plateNoise(vPlateObj * 38.0 + 7.3);
  float brush = broad * 0.65 + fine * 0.35;
  diffuseColor.rgb *= mix(1.0, pm.r, uPlateShade);
  float dust = clamp(pm.b * uPlateDust * (0.55 + 0.9 * fine), 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPlateDustColor, dust);
  float wear = clamp(pm.g * uPlateWear * (0.6 + 0.8 * broad), 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPlateWorn, wear);
  diffuseColor.rgb *= 1.0 + (brush - 0.5) * uPlateBrush;
}`;

export interface PlatePaintColours {
  /** Bright polished steel (or bronze) where edges are worn. */
  worn: THREE.ColorRepresentation;
  /** Orange plateau dust caught in the seams. */
  dust: THREE.ColorRepresentation;
}

/** Paint a Plate material with `mask` (the GLB's plate UVs). Safe to call once per material. */
export function paintPlate(m: THREE.MeshStandardMaterial, mask: THREE.Texture, colours: PlatePaintColours): void {
  if (m.userData.platePainted) return;
  m.userData.platePainted = true;
  m.aoMap = mask;
  m.aoMapIntensity = 1;
  const own = { uPlateWorn: { value: new THREE.Color(colours.worn) }, uPlateDustColor: { value: new THREE.Color(colours.dust) } };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, plateUniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${VERT_HEAD}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlateObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${FRAG_HEAD}`)
      .replace('#include <color_fragment>', PAINT);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `platePaint|${prevKey()}`;
  m.needsUpdate = true;
}

/** The mask as a texture: data, not colour, and glTF's UV convention (no flip). */
export function preparePlateMask(tex: THREE.Texture): THREE.Texture {
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.channel = 0;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
