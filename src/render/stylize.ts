import * as THREE from 'three';
import { look } from './look';

/**
 * Painterly shading for every MeshStandardMaterial / MeshPhysicalMaterial in
 * the scene, including GLB materials from the Blender pipeline. Patched in
 * place with onBeforeCompile, so the material's own colour, maps, metalness,
 * roughness and emissive keep working.
 *
 *  - Sunlight goes through a soft banded ramp (look.rampSteps / rampSoftness).
 *  - The shaded side shifts hue toward look.shadowColor (brightness kept);
 *    the sunlit side warms toward look.highlightColor.
 *  - A cool rim light on silhouettes.
 *  - Lit surfaces are capped at look.maxLit so only emissives bloom; strong
 *    emissives get look.glowBoost extra HDR.
 *  - Atmosphere replaces three's fog: distance haze plus blue haze filling
 *    the chasms below the plateau tops.
 */

const col = () => ({ value: new THREE.Color() });
/** Shared by every stylized program: updating these updates them all. */
export const styleUniforms = {
  uRampSteps: { value: 3 },
  uRampSoft: { value: 0.4 },
  uRampLift: { value: 0.8 },
  uSunLum: { value: 1 },
  uShadowColor: col(),
  uShadowHue: { value: 0.5 },
  uHighlightColor: col(),
  uHighlightWarmth: { value: 0.3 },
  uRimColor: col(),
  uRimStrength: { value: 0.2 },
  uRimPower: { value: 3 },
  uMaxLit: { value: 1.3 },
  uGlowBoost: { value: 2 },
  uHazeColor: col(),
  uHazeDensity: { value: 0.004 },
  uHazeMax: { value: 0.85 },
  uChasmColor: col(),
  uChasmFog: { value: 0.9 },
  uChasmDepth: { value: 25 },
  uFogTop: { value: 0 },
};

/** Copy look values into the shared uniforms. Cheap; call once a frame. */
export function syncStyleUniforms(sunColor: THREE.Color, sunIntensity: number): void {
  const u = styleUniforms;
  u.uRampSteps.value = Math.max(1, Math.round(look.rampSteps));
  u.uRampSoft.value = look.rampSoftness;
  u.uRampLift.value = look.rampLift;
  // Luminance of full, unshadowed sunlight: lets the shader tell lit from shaded.
  u.uSunLum.value = Math.max(1e-3, (sunColor.r * 0.2126 + sunColor.g * 0.7152 + sunColor.b * 0.0722) * sunIntensity);
  u.uShadowColor.value.set(look.shadowColor);
  u.uShadowHue.value = look.shadowHue;
  u.uHighlightColor.value.set(look.highlightColor);
  u.uHighlightWarmth.value = look.highlightWarmth;
  u.uRimColor.value.set(look.rimColor);
  u.uRimStrength.value = look.rimStrength;
  u.uRimPower.value = look.rimPower;
  u.uMaxLit.value = look.maxLit;
  u.uGlowBoost.value = look.glowBoost;
  u.uHazeColor.value.set(look.hazeColor);
  u.uHazeDensity.value = look.hazeDensity;
  u.uHazeMax.value = look.hazeMax;
  u.uChasmColor.value.set(look.chasmColor);
  u.uChasmFog.value = look.chasmFog;
  u.uChasmDepth.value = look.chasmDepth;
  u.uFogTop.value = look.fogTop;
}

const HEADER = /* glsl */`
uniform float uRampSteps, uRampSoft, uRampLift, uSunLum, uShadowHue, uHighlightWarmth, uRimStrength, uRimPower, uMaxLit, uGlowBoost;
uniform vec3 uShadowColor, uHighlightColor, uRimColor;
uniform vec3 uHazeColor, uChasmColor;
uniform float uHazeDensity, uHazeMax, uChasmFog, uChasmDepth, uFogTop;
varying vec3 vStylWorld;
float stylLit = 0.0;
float stylLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Soft banded light ramp: steps flat bands with smoothed edges.
float stylRamp(float x) {
  float s = x * uRampSteps;
  float w = max(uRampSoft, 1e-3) * 0.5;
  float i = floor(s), f = fract(s);
  return clamp((i + smoothstep(0.5 - w, 0.5 + w, f)) / uRampSteps, 0.0, 1.0);
}
// Atmosphere: blue haze filling the chasms, then distance haze.
vec3 stylAtmosphere(vec3 c, vec3 wp) {
  float d = length(wp - cameraPosition);
  // The top of the cliff stays warm; the haze thickens with depth below uFogTop.
  float below = clamp((uFogTop - wp.y) / uChasmDepth, 0.0, 1.0);
  float chasm = uChasmFog * below * (0.4 + 0.6 * (1.0 - exp(-d / 50.0)));
  // Hue first (warm rock turns cool blue at the same value), then value
  // toward the haze, so the deep chasm reads blue rather than lavender.
  vec3 cooled = stylLum(c) * uChasmColor / max(stylLum(uChasmColor), 1e-3);
  c = mix(c, cooled, smoothstep(0.0, 0.55, chasm));
  c = mix(c, uChasmColor, chasm * 0.75);
  float haze = uHazeMax * (1.0 - exp(-d * uHazeDensity));
  return mix(c, uHazeColor, haze);
}
`;

const DIRECT_FROM = 'vec3 irradiance = dotNL * directLight.color;';
const DIRECT_TO = /* glsl */`
	// Lift: under a high sun, walls facing it still read as sunlit, not shaded.
	float stylBand = stylRamp( saturate( dotNL * ( 1.0 + uRampLift ) ) );
	vec3 irradiance = stylBand * directLight.color;
	// Lit = facing the sun and out of shadow; drives the warm / cool hue shift.
	stylLit = max( stylLit, smoothstep( 0.0, 0.12, dotNL ) * stylLum( directLight.color ) / uSunLum );`;

const OPAQUE = /* glsl */`
{
  vec3 base = outgoingLight - totalEmissiveRadiance;
  float lit = clamp( stylLit, 0.0, 1.0 );
  float l = stylLum( base );
  // Shade shifts hue toward blue at the same brightness; light warms.
  vec3 coolTint = uShadowColor / max( stylLum( uShadowColor ), 1e-3 );
  vec3 warmTint = uHighlightColor / max( stylLum( uHighlightColor ), 1e-3 );
  // Metal already carries the sky's blue in its reflections: tint it less.
  float tintAmt = 1.0 - 0.75 * metalnessFactor;
  base *= mix( vec3( 1.0 ), coolTint, uShadowHue * ( 1.0 - lit ) * tintAmt );
  base *= mix( vec3( 1.0 ), warmTint, uHighlightWarmth * lit );
  // Rim light from the sky on silhouettes.
  float rim = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), uRimPower );
  base += rim * uRimStrength * uRimColor * ( 0.35 + diffuseColor.rgb ) * ( 0.5 + 0.5 * lit );
  // Keep lit surfaces under the bloom threshold: only glows bloom.
  float bl = stylLum( base );
  if ( bl > uMaxLit ) base *= uMaxLit / bl;
  vec3 glow = totalEmissiveRadiance * ( 1.0 + uGlowBoost * smoothstep( 0.25, 1.2, stylLum( totalEmissiveRadiance ) ) );
  outgoingLight = stylAtmosphere( base + glow, vStylWorld );
}
#include <opaque_fragment>`;

const WORLD_POS = /* glsl */`#include <project_vertex>
{
  vec4 stylWp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
  stylWp = instanceMatrix * stylWp;
  #endif
  vStylWorld = ( modelMatrix * stylWp ).xyz;
}`;

let directChunk: string | null = null;
function lightsChunk(): string {
  if (directChunk) return directChunk;
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (!src.includes(DIRECT_FROM)) console.warn('stylize: three lighting chunk changed; banded light disabled');
  directChunk = src.replace(DIRECT_FROM, DIRECT_TO);
  return directChunk;
}

function patch(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, styleUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vStylWorld;')
    .replace('#include <project_vertex>', WORLD_POS);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${HEADER}`)
    .replace('#include <lights_physical_pars_fragment>', lightsChunk())
    .replace('#include <opaque_fragment>', OPAQUE)
    .replace('#include <fog_fragment>', '');
}

type Std = THREE.MeshStandardMaterial;

export function stylizeMaterial(m: Std): void {
  if (m.userData.stylized) return;
  m.userData.stylized = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    patch(shader);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `stylized|${prevKey()}`;
  m.fog = false;
  m.needsUpdate = true;
}

/** Stylize every standard material under `root`. Safe to call repeatedly. */
export function stylizeScene(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if ((m as Std).isMeshStandardMaterial) stylizeMaterial(m as Std);
  });
}
