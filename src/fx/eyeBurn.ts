import * as THREE from 'three';

const MAX = 320;
const EMIT_TIME = 0.9; // seconds each wisp keeps trailing smoke
const PUFF_EVERY = 0.05;

/**
 * "Eyes burn": when a Shardblade kills, the victim's eyes burn out. Two thin
 * dark wisps of smoke rise from the eyes while the body falls. One pooled
 * Points draw for every kill on screen; per-particle size and alpha in a tiny
 * shader.
 */
export class EyeBurn {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private next = 0;
  private emitters: { head: THREE.Vector3; ground: THREE.Vector3; side: THREE.Vector3; t: number; acc: number }[] = [];

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; varying float vA; uniform float scale;
        void main() {
          vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d) * 4.0;
          if (r > 1.0) discard;
          float a = vA * (1.0 - r) * (1.0 - r);
          gl_FragColor = vec4(0.06, 0.05, 0.05, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
  }

  /** Keep point size consistent with the viewport height. */
  setViewportHeight(px: number, fovDeg: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = px / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * @param feet     the victim's feet position at the moment of death
   * @param facing   its heading (bodies fall backwards, away from it)
   * @param height   standing eye height
   */
  emit(feet: THREE.Vector3, facing: number, height: number): void {
    if (this.emitters.length > 24) this.emitters.shift();
    const fx = Math.sin(facing), fz = Math.cos(facing);
    this.emitters.push({
      head: new THREE.Vector3(feet.x + fx * 0.12, feet.y + height, feet.z + fz * 0.12),
      // The death fall tips the body back: the head ends up behind, near the ground.
      ground: new THREE.Vector3(feet.x - fx * 1.5, feet.y + 0.35, feet.z - fz * 1.5),
      side: new THREE.Vector3(fz * 0.055, 0, -fx * 0.055),
      t: 0, acc: PUFF_EVERY,
    });
  }

  update(dt: number): void {
    const head = _h;
    for (let e = this.emitters.length - 1; e >= 0; e--) {
      const em = this.emitters[e];
      em.t += dt;
      if (em.t > EMIT_TIME) { this.emitters.splice(e, 1); continue; }
      const k = Math.min(1, em.t / 0.6);
      const ease = 1 - Math.pow(1 - k, 3);
      head.lerpVectors(em.head, em.ground, ease);
      em.acc += dt;
      while (em.acc >= PUFF_EVERY) {
        em.acc -= PUFF_EVERY;
        const fade = 1 - em.t / EMIT_TIME;
        for (const s of [-1, 1]) this.spawn(head.x + em.side.x * s, head.y, head.z + em.side.z * s, fade);
      }
    }
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += dt * 0.18;
      this.alpha[i] = Math.sin(Math.min(1, t * 3) * Math.PI * 0.5) * (1 - t) * 0.75;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }

  private spawn(x: number, y: number, z: number, strength: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([(Math.random() - 0.5) * 0.12, 0.45 + Math.random() * 0.25, (Math.random() - 0.5) * 0.12], i * 3);
    this.size[i] = 0.05 + 0.03 * strength;
    this.maxLife[i] = this.life[i] = 0.9 + Math.random() * 0.4;
  }
}

const _h = new THREE.Vector3();
