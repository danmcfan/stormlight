import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { tuning } from '../config';
import { clamp, damp, dampAngle, headingOf } from '../core/math';
import type { Physics } from '../core/physics';

const PITCH_MIN = -0.45;
const PITCH_MAX = 1.15;

/**
 * Over-the-shoulder orbit camera.
 *  - Free: mouse controls yaw/pitch around a smoothed pivot above the player.
 *  - Locked: yaw swings to keep the target framed behind the player.
 *  - Pulls in when terrain is between the pivot and the lens.
 */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Heading the camera looks along (same convention as the player). */
  yaw = 0;
  /** Elevation of the camera above the pivot, radians. */
  pitch = 0.22;
  private pivot = new THREE.Vector3();
  private currentDist: number;
  private shake = 0;
  private shakeTime = 0;
  private ray: RAPIER.Ray;

  constructor(private physics: Physics, private exclude: RAPIER.Collider, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(tuning.camera.fov, aspect, 0.1, 2000);
    this.currentDist = tuning.camera.distance;
    this.ray = new physics.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }

  /** Camera collision ignores character capsules (horde mode). */
  ignoreCharacters = false;

  snapTo(playerPos: THREE.Vector3, yaw: number): void {
    this.yaw = yaw;
    this.pivot.copy(playerPos).setY(playerPos.y + tuning.camera.pivotHeight);
  }

  addShake(amount: number): void {
    this.shake = Math.min(0.25, this.shake + amount);
  }

  look(dx: number, dy: number, wheel: number, locked: boolean): void {
    const c = tuning.camera;
    if (!locked) {
      this.yaw -= dx * c.sensitivity;
      this.pitch = clamp(this.pitch + dy * c.sensitivity, PITCH_MIN, PITCH_MAX);
    }
    if (wheel) c.distance = clamp(c.distance + wheel * 0.6, c.minDistance, c.maxDistance);
  }

  update(dt: number, playerPos: THREE.Vector3, lockTarget: THREE.Vector3 | null): void {
    const c = tuning.camera;
    if (this.camera.fov !== c.fov) { this.camera.fov = c.fov; this.camera.updateProjectionMatrix(); }

    // Smoothed pivot: absorbs footstep jitter and step-ups.
    const pivotTarget = new THREE.Vector3(playerPos.x, playerPos.y + c.pivotHeight, playerPos.z);
    this.pivot.x = damp(this.pivot.x, pivotTarget.x, c.pivotDamping, dt);
    this.pivot.y = damp(this.pivot.y, pivotTarget.y, c.pivotDamping * 0.6, dt);
    this.pivot.z = damp(this.pivot.z, pivotTarget.z, c.pivotDamping, dt);

    if (lockTarget) {
      const dx = lockTarget.x - playerPos.x, dz = lockTarget.z - playerPos.z;
      this.yaw = dampAngle(this.yaw, headingOf(dx, dz), c.lockYawDamping, dt);
      // Tilt down a little more when the target is close so both stay in frame.
      const dist = Math.hypot(dx, dz);
      const want = c.lockPitch + clamp((6 - dist) * 0.04, 0, 0.2) - clamp((lockTarget.y - playerPos.y) * 0.05, -0.2, 0.2);
      this.pitch = damp(this.pitch, want, 5, dt);
    }

    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx; // camera right
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const shoulder = c.shoulderOffset;
    const origin = new THREE.Vector3(this.pivot.x + rx * shoulder, this.pivot.y, this.pivot.z + rz * shoulder);
    const dir = new THREE.Vector3(-fx * cp, sp, -fz * cp); // from pivot toward lens

    // Keep the lens out of rocks and cliffs.
    let wanted = c.distance;
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    // In a crowd, bodies behind you mustn't yank the lens in: rocks and cliffs only.
    const flags = this.ignoreCharacters ? this.physics.R.QueryFilterFlags.EXCLUDE_KINEMATIC : undefined;
    const hit = this.physics.world.castRay(this.ray, wanted + 0.3, true, flags, undefined, this.exclude);
    if (hit) wanted = Math.max(0.8, hit.timeOfImpact - 0.3);
    // Snap in fast, ease out slowly.
    this.currentDist = wanted < this.currentDist ? wanted : damp(this.currentDist, wanted, 4, dt);

    const pos = origin.clone().addScaledVector(dir, this.currentDist);

    // Shake: decaying jitter.
    this.shakeTime += dt;
    this.shake = damp(this.shake, 0, 9, dt);
    if (this.shake > 0.0005) {
      pos.y += Math.sin(this.shakeTime * 61) * this.shake;
      pos.x += Math.sin(this.shakeTime * 47 + 1.3) * this.shake * 0.5;
    }
    this.camera.position.copy(pos);

    const look = origin.clone().addScaledVector(new THREE.Vector3(fx, 0, fz), 4);
    if (lockTarget) {
      const mid = new THREE.Vector3().lerpVectors(origin, lockTarget, 0.5);
      look.lerp(mid, 0.6);
    }
    this.camera.lookAt(look);
  }
}
