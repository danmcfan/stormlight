import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Physics } from '../core/physics';

/**
 * Kinematic capsule driven by Rapier's character controller. Shared by the
 * player and every Parshendi: you give it a planar velocity, it handles
 * collisions, slopes, steps, gravity and falling, and keeps the last two
 * positions for render interpolation.
 */
export class CharacterBody {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private centerY: number;
  vy = 0;
  grounded = false;
  readonly prevPos = new THREE.Vector3();
  readonly pos = new THREE.Vector3();
  /** Interpolated feet position for rendering. */
  readonly renderPos = new THREE.Vector3();

  constructor(physics: Physics, spawn: THREE.Vector3, readonly radius: number, readonly halfHeight: number, private gravity: () => number) {
    const R = physics.R;
    this.centerY = halfHeight + radius;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + this.centerY, spawn.z),
    );
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(halfHeight, radius), this.body);
    this.controller = physics.world.createCharacterController(0.02);
    this.controller.enableSnapToGround(0.4);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.pos.copy(spawn); this.prevPos.copy(spawn); this.renderPos.copy(spawn);
  }

  /**
   * Move with the given planar velocity. Returns the planar velocity actually
   * achieved (lower if something blocked us).
   */
  move(vx: number, vz: number, dt: number): { vx: number; vz: number } {
    this.prevPos.copy(this.pos);
    // While grounded, snap-to-ground keeps us planted; pushing down into the
    // floor as well makes the controller occasionally cancel the whole move.
    if (this.grounded && this.vy <= 0) this.vy = 0;
    else this.vy -= this.gravity() * dt;

    const desired = { x: vx * dt, y: this.vy * dt, z: vz * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const mv = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = 0;

    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    this.pos.set(next.x, next.y - this.centerY, next.z);

    const want = Math.hypot(desired.x, desired.z), got = Math.hypot(mv.x, mv.z);
    // Ignore tiny discrepancies from contact offsets.
    if (want > 1e-4 && got < want * 0.9) return { vx: mv.x / dt, vz: mv.z / dt };
    return { vx, vz };
  }

  teleport(p: THREE.Vector3): void {
    const c = { x: p.x, y: p.y + this.centerY, z: p.z };
    this.body.setTranslation(c, true);
    this.body.setNextKinematicTranslation(c);
    this.pos.copy(p); this.prevPos.copy(p); this.renderPos.copy(p);
    this.vy = 0;
  }

  /** Scripted move (e.g. climbing over a ledge): no collision, keeps interpolation. */
  slideTo(p: THREE.Vector3): void {
    this.prevPos.copy(this.pos);
    const c = { x: p.x, y: p.y + this.centerY, z: p.z };
    this.body.setNextKinematicTranslation(c);
    this.pos.copy(p);
    this.vy = 0;
    this.grounded = false;
  }

  /** Dead bodies shouldn't block anyone. */
  setSolid(solid: boolean): void {
    this.collider.setEnabled(solid);
  }

  interpolate(alpha: number): THREE.Vector3 {
    return this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);
  }
}
