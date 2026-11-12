import * as THREE from 'three';

const MAX = 400;

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** Pooled additive particles: sparks off steel, stormlight motes off cuts. */
export class Sparks {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private base = new Float32Array(MAX * 3);
  private grav = new Float32Array(MAX);
  private next = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.11, map: dotTexture(), vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
  }

  /**
   * @param speed  initial speed (m/s)
   * @param gravity  0 for floating motes, ~12 for falling sparks
   */
  burst(at: THREE.Vector3, count: number, color: THREE.Color, speed: number, life: number, gravity: number, upBias = 0.3): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const s = speed * (0.35 + Math.random() * 0.65);
      this.vel.set([r * Math.cos(th) * s, (u + upBias) * s, r * Math.sin(th) * s], i * 3);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.base.set([color.r, color.g, color.b], i * 3);
      this.maxLife[i] = this.life[i] = life * (0.5 + Math.random() * 0.5);
      this.grav[i] = gravity;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-2.5 * dt);
      for (let a = 0; a < 3; a++) {
        this.vel[i * 3 + a] *= drag;
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
        this.col[i * 3 + a] = this.base[i * 3 + a] * k;
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}
