import * as THREE from 'three';
import { damp, dampAngle, headingOf } from '../core/math';
import type { Physics } from '../core/physics';

const skinDark = new THREE.MeshStandardMaterial({ color: '#2a2020', roughness: 0.8, flatShading: true });
const skinRed = new THREE.MeshStandardMaterial({ color: '#7d2a22', roughness: 0.8, flatShading: true });
const carapace = new THREE.MeshStandardMaterial({ color: '#b2552c', roughness: 0.55, flatShading: true });
const axeMat = new THREE.MeshStandardMaterial({ color: '#5d5d62', metalness: 0.7, roughness: 0.4, flatShading: true });
const wood = new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 0.9 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

let nextId = 1;

/**
 * Placeholder Parshendi warrior in warform: marbled skin, carapace armour
 * growing from the body, a broad axe. Stands, breathes, and turns to watch
 * the Shardbearer when they come close. No combat yet.
 */
export class Parshendi {
  readonly id = nextId++;
  readonly root = new THREE.Group();
  /** Height of the chest above the feet — where the lock-on reticle sits. */
  readonly chestHeight = 1.35;
  private body = new THREE.Group();
  private heading: number;
  private time = Math.random() * 10;

  constructor(pos: THREE.Vector3, heading: number, physics: Physics) {
    this.heading = heading;
    this.root.position.copy(pos);
    this.root.add(this.body);
    const b = this.body;
    // Legs
    b.add(box(0.2, 0.9, 0.22, skinDark, 0.14, 0.45), box(0.2, 0.9, 0.22, skinRed, -0.14, 0.45));
    // Torso, marbled
    b.add(box(0.5, 0.65, 0.3, skinRed, 0, 1.22), box(0.28, 0.4, 0.31, skinDark, 0.1, 1.3));
    // Carapace: chest plate, shoulders, helm-like skull ridge
    b.add(box(0.54, 0.4, 0.12, carapace, 0, 1.32, 0.13));
    b.add(box(0.22, 0.14, 0.32, carapace, 0.34, 1.55), box(0.22, 0.14, 0.32, carapace, -0.34, 1.55));
    b.add(box(0.26, 0.28, 0.27, skinDark, 0, 1.73));
    b.add(box(0.3, 0.12, 0.32, carapace, 0, 1.9));
    // Arms
    b.add(box(0.16, 0.7, 0.16, skinDark, 0.36, 1.18), box(0.16, 0.7, 0.16, skinRed, -0.36, 1.18));
    // Axe in right hand
    const axe = new THREE.Group();
    axe.add(box(0.05, 1.3, 0.05, wood, 0, 0));
    axe.add(box(0.04, 0.3, 0.36, axeMat, 0, 0.55, 0.14));
    axe.position.set(-0.4, 0.95, 0.15);
    axe.rotation.x = 0.35;
    b.add(axe);
    this.root.rotation.y = heading;

    physics.world.createCollider(
      physics.R.ColliderDesc.capsule(0.55, 0.35).setTranslation(pos.x, pos.y + 0.9, pos.z),
    );
  }

  get position(): THREE.Vector3 { return this.root.position; }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.time += dt;
    const dx = playerPos.x - this.position.x, dz = playerPos.z - this.position.z;
    if (dx * dx + dz * dz < 18 * 18) this.heading = dampAngle(this.heading, headingOf(dx, dz), 3, dt);
    this.root.rotation.y = this.heading;
    this.body.position.y = damp(this.body.position.y, Math.sin(this.time * 2.1) * 0.015, 10, dt);
    this.body.rotation.z = Math.sin(this.time * 0.9) * 0.02;
  }
}
