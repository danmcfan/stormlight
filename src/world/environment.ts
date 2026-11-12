import * as THREE from 'three';
import { look } from '../render/look';
import { syncStyleUniforms } from '../render/stylize';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // always on the far plane
}`;

/**
 * Painted sky: zenith-to-horizon gradient, soft streaky high cloud laid in
 * flat-ish bands, a warm glow round the sun, and a dark highstorm wall low
 * on the horizon to the east. Fades into the same haze colour the terrain
 * fades into, so distant plateaus melt into the horizon.
 */
const SKY_FRAG = /* glsl */`
uniform vec3 uZenith, uHorizon, uHaze, uCloud, uStorm, uSunDir, uSunColor;
uniform float uCover, uStormHeight, uTime;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// Soft posterise: flat colour areas with soft edges, like laid-in paint.
float bands(float x, float n) { float s = x * n; return (floor(s) + smoothstep(0.3, 0.7, fract(s))) / n; }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.4));

  // High cloud: streaks stretched along one direction, thinning overhead.
  vec2 p = d.xz / (max(h, 0.0) + 0.18);
  vec2 q = vec2(p.x * 0.55 + p.y * 0.2, p.y * 1.6 - p.x * 0.15) * 0.9 + vec2(uTime * 0.004, 0.0);
  float n = fbm(q + fbm(q * 0.7) * 1.3);
  float cloud = smoothstep(1.0 - uCover * 0.75, 1.05 - uCover * 0.3, n) * smoothstep(0.0, 0.18, h);
  cloud = bands(cloud, 3.0);
  float sunSide = 0.5 + 0.5 * dot(normalize(d.xz + 1e-4), normalize(uSunDir.xz + 1e-4));
  c = mix(c, uCloud * (0.93 + 0.07 * sunSide), cloud * 0.8);

  // Warm glow round the sun.
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(sd, 400.0) * 3.0 + pow(sd, 18.0) * 0.12);

  // Haze at the horizon, matching the terrain's distance haze.
  c = mix(c, uHaze, smoothstep(0.14, 0.0, h) * 0.9);

  // Highstorm wall: dark slate, billowing top edge, lit along its crown.
  float az = atan(d.z, d.x);
  float arc = smoothstep(1.45, 0.5, abs(az + 0.35));
  float top = uStormHeight * arc * (0.55 + 0.6 * fbm(vec2(az * 7.0, 3.0) + uTime * 0.002));
  float wall = smoothstep(top, top - 0.012, h) * step(-0.2, h) * step(0.002, top);
  vec3 storm = mix(uStorm, uHaze, 0.3);
  storm = mix(storm, mix(uStorm, uCloud, 0.45), smoothstep(top - 0.03, top, h)); // lit crown
  c = mix(c, storm, wall * 0.92);

  // Below the horizon (only seen past distant plateaus): chasm haze.
  c = mix(c, uHaze * 0.92, smoothstep(0.0, -0.08, h));
  gl_FragColor = vec4(c, 1.0);
}`;

/** Roshar at high noon: painted sky, strong warm sun, cool sky fill. */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private sunDir = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // Atmosphere is applied per material by the stylizer (height fog), not three's fog.
    scene.fog = null;
    scene.background = new THREE.Color(look.skyHorizon);

    this.hemi = new THREE.HemisphereLight(look.skyLight, look.groundLight, look.ambient);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -35; c.right = 35; c.top = 35; c.bottom = -35; c.near = 1; c.far = 200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    const col = (v: string) => ({ value: new THREE.Color(v) });
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: col(look.skyZenith), uHorizon: col(look.skyHorizon), uHaze: col(look.hazeColor),
        uCloud: col(look.cloudColor), uStorm: col(look.stormColor), uSunColor: col(look.sunColor),
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uCover: { value: look.cloudCover }, uStormHeight: { value: look.stormHeight }, uTime: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.skyMat);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // The chasm floor far below, lost in haze.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ color: '#7b6a58', roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -70;
    scene.add(floor);
    this.update(0);
  }

  /** Sun direction from look.sunElevation / sunAzimuth (azimuth 0 = from -Z). */
  sunDirection(out: THREE.Vector3): THREE.Vector3 {
    const el = THREE.MathUtils.degToRad(look.sunElevation);
    const az = THREE.MathUtils.degToRad(look.sunAzimuth);
    return out.set(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }

  /** Apply the live look values. Call once a frame. */
  update(time: number): void {
    this.sun.color.set(look.sunColor);
    this.sun.intensity = look.sunIntensity;
    this.hemi.color.set(look.skyLight);
    this.hemi.groundColor.set(look.groundLight);
    this.hemi.intensity = look.ambient;
    this.sunDirection(this.sunDir);
    const u = this.skyMat.uniforms;
    u.uZenith.value.set(look.skyZenith);
    u.uHorizon.value.set(look.skyHorizon);
    u.uHaze.value.set(look.hazeColor);
    u.uCloud.value.set(look.cloudColor);
    u.uStorm.value.set(look.stormColor);
    u.uSunColor.value.set(look.sunColor);
    u.uSunDir.value.copy(this.sunDir);
    u.uCover.value = look.cloudCover;
    u.uStormHeight.value = look.stormHeight;
    u.uTime.value = time;
    syncStyleUniforms(this.sun.color, this.sun.intensity);
  }

  /** Keep the shadow frustum centred on the player for crisp shadows. */
  follow(target: THREE.Vector3, eye?: THREE.Vector3): void {
    this.sun.position.copy(target).addScaledVector(this.sunDir, 80);
    this.sun.target.position.copy(target);
    if (eye) this.sky.position.copy(eye);
  }
}
