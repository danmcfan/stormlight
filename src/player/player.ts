import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { tuning } from '../config';
import { wrapAngle, angleDiff } from '../core/math';
import type { Physics } from '../core/physics';
import { createLocoState, planarSpeed, stepLocomotion, type LocoInput, type LocoState } from './locomotion';
import { PlayerModel } from './playerModel';

const HALF_HEIGHT = 0.6;
const RADIUS = 0.42;
/** Capsule centre above the feet. */
const CENTER_Y = HALF_HEIGHT + RADIUS;

export class Player {
  readonly model = new PlayerModel();
  loco: LocoState;
  vy = 0;
  grounded = false;
  /** Feet position at the last two sim steps, for render interpolation. */
  private prevPos = new THREE.Vector3();
  private curPos = new THREE.Vector3();
  private prevFacing = 0;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  /** Interpolated feet position, updated each render frame. */
  readonly renderPos = new THREE.Vector3();

  constructor(physics: Physics, private spawn: THREE.Vector3, private spawnHeading: number) {
    const R = physics.R;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + CENTER_Y, spawn.z),
    );
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);
    this.controller = physics.world.createCharacterController(0.02);
    this.controller.enableSnapToGround(0.4);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.loco = createLocoState(spawnHeading);
    this.curPos.copy(spawn); this.prevPos.copy(spawn); this.renderPos.copy(spawn);
    this.prevFacing = spawnHeading;
  }

  get position(): THREE.Vector3 { return this.curPos; }
  get speed(): number { return planarSpeed(this.loco); }

  fixedUpdate(dt: number, input: LocoInput): void {
    this.prevPos.copy(this.curPos);
    this.prevFacing = this.loco.facing;
    this.loco = stepLocomotion(this.loco, input, tuning.movement, dt);

    // While grounded, snap-to-ground keeps us planted; pushing down into the
    // floor as well makes the controller occasionally cancel the whole move.
    if (this.grounded && this.vy <= 0) this.vy = 0;
    else this.vy -= tuning.movement.gravity * dt;

    const desired = { x: this.loco.vx * dt, y: this.vy * dt, z: this.loco.vz * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const mv = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    // If something stopped us, keep only the velocity we actually achieved
    // (so we slide along walls instead of "running" into them at full speed).
    // Tiny discrepancies from contact offsets are ignored.
    const want = Math.hypot(desired.x, desired.z);
    const got = Math.hypot(mv.x, mv.z);
    if (want > 1e-4 && got < want * 0.9) {
      this.loco = { ...this.loco, vx: mv.x / dt, vz: mv.z / dt };
    }
    if (this.grounded && this.vy < 0) this.vy = 0;

    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    this.curPos.set(next.x, next.y - CENTER_Y, next.z);

    if (this.curPos.y < -45) this.respawn();
  }

  respawn(): void {
    const s = this.spawn;
    this.body.setTranslation({ x: s.x, y: s.y + CENTER_Y, z: s.z }, true);
    this.body.setNextKinematicTranslation({ x: s.x, y: s.y + CENTER_Y, z: s.z });
    this.curPos.copy(s); this.prevPos.copy(s);
    this.loco = createLocoState(this.spawnHeading);
    this.prevFacing = this.spawnHeading;
    this.vy = 0;
  }

  /** Called each render frame with the fixed-step interpolation factor. */
  render(dt: number, alpha: number): void {
    this.renderPos.lerpVectors(this.prevPos, this.curPos, alpha);
    this.model.root.position.copy(this.renderPos);
    this.model.root.rotation.y = wrapAngle(this.prevFacing + angleDiff(this.loco.facing, this.prevFacing) * alpha);
    this.model.update(dt, {
      speed: this.speed,
      jogSpeed: tuning.movement.jogSpeed,
      sprintSpeed: tuning.movement.sprintSpeed,
      forwardAccel: this.loco.forwardAccel,
      turnRate: this.loco.turnRate,
      grounded: this.grounded,
    });
  }
}
