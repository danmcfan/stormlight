import * as THREE from 'three';

/**
 * Terrain shading for the plateaus, boulders and spires.
 *
 * A MeshStandardMaterial whose base colour is painted in the shader from
 * world position and normal, then lit by the shared painterly shading
 * (render/stylize.ts patches it like every other material):
 *
 *  - Walls: rock strata by world height with a gentle long wave, the same
 *    functions as plateau.ts (STRATA_BAND, strataWave, strataT), so bands are
 *    smooth and roughly horizontal on every plateau, near or far, and line up
 *    with the ledges in the geometry. Orange, rose, apricot and cream from the
 *    style reference, with brushy detail from the generated cliff texture.
 *  - Tops: pale tan stone with subtle large-scale variation, hairline cracks
 *    (generated top texture), patches of crem crust (generated crem texture)
 *    and a few sage patches.
 *  - Rim: the rounded edge between them catches a pale worn highlight.
 *
 * Detail texture (public/textures/terrain-detail.jpg, see
 * scripts/gen/make_terrain_textures.py): R = top cracks, G = cliff layering,
 * B = crem crust; luminance only, centred on 0.5.
 */

const hex = (h: string) => new THREE.Color(h);

export const terrainUniforms = {
  uDetail: { value: null as THREE.Texture | null },
  /** 1: output a mask instead of colour (green = plateau top, red = wall). For look-dev measures. */
  uTerrainDebug: { value: 0 },
  uStrata: {
    // Most often first: orange and rust, then apricot, rose and tan; cream bands are thinner and rarer.
    value: ['#d4875c', '#c7714c', '#dc9a6c', '#d07a52', '#e2a676', '#efd3a8', '#f3dfbb'].map(hex),
  },
  uTopA: { value: hex('#d2b592') },
  uTopB: { value: hex('#b8977a') },
  uCrem: { value: hex('#eee5d3') },
  uSage: { value: hex('#a8ab82') },
  uRim: { value: hex('#f2e0bf') },
};

const HEADER = /* glsl */`
uniform sampler2D uDetail;
uniform float uTerrainDebug;
uniform vec3 uStrata[7];
uniform vec3 uTopA, uTopB, uCrem, uSage, uRim;
varying vec3 vTWorld;
varying vec3 vTNormal;
varying float vTRock;
varying float vTShade;
float tHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0;
  return mix(mix(tHash(n), tHash(n + 1.0), f.x), mix(tHash(n + 57.0), tHash(n + 58.0), f.x), f.y);
}
float strataWave(vec2 p) { return 1.6 * sin(p.x * 0.043 + 1.7 * sin(p.y * 0.029)) + 1.0 * sin(p.y * 0.061 + p.x * 0.017); }
float strataT(float h) { return h / 1.9 + 0.45 * sin(h * 0.19); }
vec3 strataColor(float k) {
  float i = floor(pow(tHash(k * 0.731 + 3.17), 1.8) * 7.0);
  vec3 c = uStrata[0];
  for (int j = 1; j < 7; j++) if (float(j) == i) c = uStrata[j];
  return c * (0.93 + 0.12 * tHash(k * 1.37 + 0.5));
}
float terrainUp = 0.0;
`;

const COLOR = /* glsl */`#include <color_fragment>
{
  vec3 wp = vTWorld;
  vec3 wn = normalize(vTNormal);
  terrainUp = smoothstep(0.55, 0.88, wn.y);

  // --- Walls: strata by height ---
  vec2 w2 = abs(wn.xz) + 1e-3;
  w2 /= (w2.x + w2.y);
  float dA = texture2D(uDetail, vec2(wp.z, wp.y * 1.4) / 7.0).g;
  float dB = texture2D(uDetail, vec2(wp.x, wp.y * 1.4) / 7.0).g;
  float det = dA * w2.x + dB * w2.y;
  float along = wp.x * w2.y + wp.z * w2.x;
  float h = wp.y + strataWave(wp.xz);
  // Brushy band edges: the cliff detail nudges where one band meets the next.
  float t = strataT(h) + (det - 0.5) * 0.18 + (tNoise(vec2(along * 0.25, h * 0.6)) - 0.5) * 0.1;
  float k = floor(t), f = fract(t);
  vec3 cliff = mix(strataColor(k), strataColor(k + 1.0), smoothstep(0.9, 1.0, f));
  cliff *= 0.35 + 1.3 * det;
  cliff *= vTShade;
  // Block joints: short vertical cracks, staggered from one stratum to the next.
  float ju = along / 3.4 + tHash(k * 3.71) * 17.0 + (tNoise(vec2(h * 1.3, k)) - 0.5) * 0.25;
  float jc = floor(ju);
  float jd = abs(fract(ju) - 0.5);
  float jw = 0.045 + 0.6 * fwidth(ju);
  float joint = step(0.72, tHash(jc * 1.91 + k * 7.3)) * (1.0 - smoothstep(jw * 0.5, jw, jd)) * smoothstep(0.03, 0.12, f) * smoothstep(0.03, 0.12, 1.0 - f);
  cliff *= 1.0 - 0.45 * joint;
  // Each stratum is lit along its upper edge and darker underneath.
  cliff *= 0.84 + 0.26 * smoothstep(0.0, 1.0, f);
  // Far off, a painter simplifies: the bands soften toward one warm rock colour.
  float far = smoothstep(120.0, 650.0, length(wp - cameraPosition)) * 0.55;
  cliff = mix(cliff, vec3(0.62, 0.33, 0.2) * (0.7 + 0.6 * det), far);
  // Faint vertical streaks washing down the walls.
  cliff *= 0.9 + 0.16 * tNoise(vec2(along * 0.45, wp.y * 0.04));

  // --- Tops: pale tan stone, cracks, crem, sage ---
  vec2 q = wp.xz;
  float c1 = texture2D(uDetail, q / 9.0).r;
  float c2 = texture2D(uDetail, q / 23.0 + 0.37).r;
  float crack = min(c1, c2 + 0.08);
  float macro = tNoise(q / 21.0) * 0.6 + tNoise(q / 6.5) * 0.4;
  vec3 top = mix(uTopB, uTopA, smoothstep(0.2, 0.8, macro));
  // Mottled, darker weathering patches and darker cracks.
  top *= 0.9 + 0.2 * tNoise(q / 2.3 + 1.7);
  top *= 0.5 + 1.0 * crack;
  float cremAmt = smoothstep(0.58, 0.78, tNoise(q / 9.5 + 7.3)) * 0.85;
  float cremDet = texture2D(uDetail, q / 5.0).b;
  top = mix(top, uCrem * (0.55 + 0.9 * cremDet), cremAmt);
  float sage = smoothstep(0.74, 0.9, tNoise(q / 27.0 + 3.1)) * (1.0 - cremAmt);
  top = mix(top, uSage * (0.8 + 0.4 * macro), sage * 0.5);

  // --- Rim: pale worn highlight on the rounded edge ---
  float rim = clamp(1.0 - abs(terrainUp - 0.55) * 2.6, 0.0, 1.0);
  // Loose boulders: weathered pale stone, only a hint of the strata.
  cliff = mix(cliff, mix(uTopB, uTopA, 0.5) * (0.55 + 0.9 * det), vTRock * 0.65);
  vec3 col = mix(cliff, top, terrainUp);
  col = mix(col, uRim * (0.85 + 0.3 * det), rim * 0.45);
  diffuseColor.rgb = col;
}`;

const DEBUG = /* glsl */`#include <dithering_fragment>
if (uTerrainDebug > 0.5) gl_FragColor = vec4(terrainUp > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), 1.0);`;

/** One shared terrain material. */
export function makeTerrainMaterial(detail: THREE.Texture): THREE.MeshStandardMaterial {
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.colorSpace = THREE.NoColorSpace;
  detail.anisotropy = 4;
  detail.needsUpdate = true;
  terrainUniforms.uDetail.value = detail;
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRock;\nattribute float aShade;\nvarying vec3 vTWorld;\nvarying vec3 vTNormal;\nvarying float vTRock;\nvarying float vTShade;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vTNormal = normalize(mat3(modelMatrix) * objectNormal);
  vTRock = aRock;
  vTShade = aShade;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace('#include <color_fragment>', COLOR)
      .replace('#include <dithering_fragment>', DEBUG);
  };
  m.customProgramCacheKey = () => 'terrain';
  return m;
}

/** Look-dev: show the top / wall mask instead of colour. */
export function setTerrainDebug(on: boolean): void {
  terrainUniforms.uTerrainDebug.value = on ? 1 : 0;
}
