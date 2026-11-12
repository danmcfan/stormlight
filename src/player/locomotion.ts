import { approach, approachAngle, angleDiff, clamp, headingOf } from '../core/math';
import type { Tuning } from '../config';

export interface LocoState {
  /** Body heading (see headingOf convention). */
  facing: number;
  /** Planar velocity, m/s. */
  vx: number;
  vz: number;
  /** Signed turn rate this step, rad/s (drives banking in the animation). */
  turnRate: number;
  /** Forward acceleration this step, m/s² (drives lean). */
  forwardAccel: number;
}

export interface LocoInput {
  /** Right axis in [-1, 1]. */
  moveX: number;
  /** Forward axis in [-1, 1]. */
  moveY: number;
  sprint: boolean;
  walk: boolean;
  cameraYaw: number;
  /** Heading toward the locked target, or null when free. */
  lockHeading: number | null;
}

export function createLocoState(facing = 0): LocoState {
  return { facing, vx: 0, vz: 0, turnRate: 0, forwardAccel: 0 };
}

export function planarSpeed(s: LocoState): number {
  return Math.hypot(s.vx, s.vz);
}

/** Camera-relative input → world-space direction (unnormalised) on the XZ plane. */
export function inputToWorld(moveX: number, moveY: number, cameraYaw: number): { x: number; z: number } {
  const fx = Math.sin(cameraYaw), fz = Math.cos(cameraYaw);
  // right = forward × up
  const rx = -fz, rz = fx;
  return { x: fx * moveY + rx * moveX, z: fz * moveY + rz * moveX };
}

/**
 * One fixed step of Shardbearer locomotion.
 *
 * Free movement: the body turns toward the input at a limited rate and
 * velocity follows the body, so sharp turns bleed speed — that's what makes
 * Plate feel heavy instead of floaty.
 *
 * Locked (and not sprinting): the body squares up to the target and velocity
 * steers directly toward the input direction, giving Souls-style strafing.
 */
export function stepLocomotion(prev: LocoState, input: LocoInput, m: Tuning['movement'], dt: number): LocoState {
  const s: LocoState = { ...prev };
  const mag = clamp(Math.hypot(input.moveX, input.moveY), 0, 1);
  const dir = inputToWorld(input.moveX, input.moveY, input.cameraYaw);
  const hasInput = mag > 0.01;
  const prevFacing = prev.facing;
  const prevForwardSpeed = prev.vx * Math.sin(prevFacing) + prev.vz * Math.cos(prevFacing);

  const locked = input.lockHeading !== null;
  const strafing = locked && !input.sprint;

  if (strafing) {
    s.facing = approachAngle(prev.facing, input.lockHeading!, m.turnRateLocked * dt);
    const maxSpeed = input.walk ? m.walkSpeed : m.strafeSpeed;
    const len = Math.hypot(dir.x, dir.z) || 1;
    const tx = hasInput ? (dir.x / len) * maxSpeed * mag : 0;
    const tz = hasInput ? (dir.z / len) * maxSpeed * mag : 0;
    const rate = (hasInput ? m.accel : m.decel) * dt;
    // Move the velocity vector toward the target vector by at most `rate`.
    const dx = tx - prev.vx, dz = tz - prev.vz;
    const d = Math.hypot(dx, dz);
    const k = d > rate ? rate / d : 1;
    s.vx = prev.vx + dx * k;
    s.vz = prev.vz + dz * k;
  } else {
    // Speed along the current facing (never negative — we don't moonwalk).
    let speed = Math.max(0, prevForwardSpeed);
    let targetSpeed = 0;
    let brake = 1;
    if (hasInput) {
      const desired = headingOf(dir.x, dir.z);
      const speedFrac = clamp((speed - m.jogSpeed) / Math.max(0.01, m.sprintSpeed - m.jogSpeed), 0, 1);
      const turnRate = m.turnRateJog + (m.turnRateSprint - m.turnRateJog) * speedFrac;
      s.facing = approachAngle(prev.facing, desired, turnRate * dt);
      const off = angleDiff(desired, s.facing);
      const align = Math.pow((1 + Math.cos(off)) / 2, m.turnSpeedPenalty);
      const maxSpeed = input.sprint ? m.sprintSpeed : input.walk ? m.walkSpeed : m.jogSpeed;
      targetSpeed = maxSpeed * mag * align;
      if (Math.abs(off) > Math.PI / 2) brake = m.pivotBrake;
    }
    const rate = (targetSpeed > speed ? m.accel : m.decel * brake) * dt;
    speed = approach(speed, targetSpeed, rate);
    s.vx = Math.sin(s.facing) * speed;
    s.vz = Math.cos(s.facing) * speed;
  }

  s.turnRate = angleDiff(s.facing, prevFacing) / dt;
  const forwardSpeed = s.vx * Math.sin(s.facing) + s.vz * Math.cos(s.facing);
  s.forwardAccel = (forwardSpeed - prevForwardSpeed) / dt;
  return s;
}
