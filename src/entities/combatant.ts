import * as THREE from 'three';
import { bladeSegment, currentPose, newPose, type BladePose } from '../combat/bladePose';
import { Fighter, type CombatRules, type FighterEvent, type FighterStats, type Intent } from '../combat/fighter';
import type { Capsule } from '../combat/hits';
import type { Moveset, Stance } from '../combat/moves';
import { angleDiff, approachAngle, headingOf, wrapAngle } from '../core/math';
import type { Physics } from '../core/physics';
import { createLocoState, inputToWorld, planarSpeed, stepLocomotion, type LocoState } from '../player/locomotion';
import { HumanoidModel, type HumanoidKind } from '../render/humanoid';
import type { Tuning } from '../config';
import { CharacterBody } from './characterBody';

export interface CombatantOptions {
  name: string;
  team: 'player' | 'parshendi';
  kind: HumanoidKind;
  variant?: number;
  /** Modelled weapon to show instead of the placeholder (see render/assets.ts). */
  weaponModel?: THREE.Object3D;
  /** Modelled Shardplate pieces (kind 'plate' only; see render/assets.ts). */
  plateModel?: THREE.Object3D;
  scale: number;
  spawn: THREE.Vector3;
  heading: number;
  /** Starting stance (default Windstance). */
  stance?: Stance;
  stats: FighterStats;
  moveset: Moveset;
  rules: CombatRules;
  movement: () => Tuning['movement'];
  gravity: () => number;
}

/** Everything a controller (keyboard or AI) supplies each tick. */
export interface ControlInput extends Intent {
  moveX: number;
  moveY: number;
  sprint: boolean;
  walk: boolean;
  cameraYaw: number;
  /** Heading toward the current target, or null. */
  targetHeading: number | null;
  /**
   * Aim assist (unlocked only): heading a swing should turn toward, or null.
   * Used at the start of an attack and to keep tracking through its windup.
   */
  aimHeading?: number | null;
}

let nextId = 1;
const TRACK_RATE = 10; // rad/s turning toward the target during windups

/**
 * A fighter with a body: physics capsule + combat state machine + rigged
 * model. The player and every Parshendi are one of these.
 */
export class Combatant {
  readonly id = nextId++;
  readonly fighter: Fighter;
  readonly body: CharacterBody;
  readonly model: HumanoidModel;
  loco: LocoState;
  private prevFacing: number;
  private dodgeHeading = 0;
  /** Knockback velocity, decays quickly. */
  private kbx = 0;
  private kbz = 0;
  /** How fast knockback bleeds off (1/s); a shove lowers it so warriors slide. */
  private kbDecay = 9;
  /** World-space blade segment last tick and this tick (for swept hits). */
  readonly bladeA = new THREE.Vector3();
  readonly bladeB = new THREE.Vector3();
  readonly prevBladeA = new THREE.Vector3();
  readonly prevBladeB = new THREE.Vector3();
  private wasActive = false;
  private animDebt = 0;
  readonly pose: BladePose = newPose();
  /** Seconds since death (for respawn). */
  deadTime = 0;
  readonly chestHeight: number;

  constructor(physics: Physics, readonly opts: CombatantOptions) {
    this.fighter = new Fighter(opts.stats, opts.moveset, opts.rules);
    if (opts.stance) this.fighter.stance = opts.stance;
    this.body = new CharacterBody(physics, opts.spawn, 0.4 * opts.scale, 0.6 * opts.scale, opts.gravity);
    this.model = new HumanoidModel(opts.kind, opts.scale, opts.variant ?? 0, opts.weaponModel, opts.plateModel);
    this.loco = createLocoState(opts.heading);
    this.prevFacing = opts.heading;
    this.chestHeight = 1.4 * opts.scale;
  }

  get name(): string { return this.opts.name; }
  get team(): string { return this.opts.team; }
  get position(): THREE.Vector3 { return this.body.pos; }
  get facing(): number { return this.loco.facing; }
  get speed(): number { return planarSpeed(this.loco); }
  get alive(): boolean { return this.fighter.alive; }

  /** Body capsule used for incoming hits. */
  capsule(out: Capsule): Capsule {
    const p = this.body.pos, s = this.opts.scale;
    out.bottom.set(p.x, p.y + 0.25 * s, p.z);
    out.top.set(p.x, p.y + 1.85 * s, p.z);
    out.radius = 0.38 * s;
    return out;
  }

  fixedStep(dt: number, input: ControlInput): FighterEvent[] {
    const f = this.fighter;
    this.prevFacing = this.loco.facing;
    const events = f.tick(input);
    const inputDir = inputToWorld(input.moveX, input.moveY, input.cameraYaw);
    const hasInput = Math.hypot(inputDir.x, inputDir.z) > 0.01;

    for (const e of events) {
      if (e.type === 'attackStart' && input.targetHeading === null) {
        // Unlocked: attacks go where you're pushing the stick, Souls-style,
        // bent toward the best target there when aim assist found one.
        if (input.aimHeading != null) this.loco = { ...this.loco, facing: input.aimHeading };
        else if (hasInput) this.loco = { ...this.loco, facing: headingOf(inputDir.x, inputDir.z) };
      }
      if (e.type === 'dodgeStart') {
        this.dodgeHeading = hasInput ? headingOf(inputDir.x, inputDir.z) : wrapAngle(this.loco.facing + Math.PI);
        if (input.targetHeading === null) this.loco = { ...this.loco, facing: hasInput ? this.dodgeHeading : this.loco.facing };
      }
    }

    let vx: number, vz: number;
    if (f.canLocomote()) {
      const blocking = f.state === 'block';
      this.loco = stepLocomotion(this.loco, {
        moveX: input.moveX, moveY: input.moveY,
        sprint: input.sprint && !blocking,
        walk: input.walk || blocking,
        cameraYaw: input.cameraYaw,
        lockHeading: input.targetHeading,
      }, this.opts.movement(), dt);
      vx = this.loco.vx; vz = this.loco.vz;
    } else {
      // Root motion from the move / dodge; turn toward the target during windups.
      let facing = this.loco.facing;
      const track = input.targetHeading ?? input.aimHeading ?? null;
      if (f.tracking() && track !== null) facing = approachAngle(facing, track, TRACK_RATE * dt);
      const rs = f.rootSpeed();
      const h = f.state === 'dodge' ? this.dodgeHeading : facing;
      vx = Math.sin(h) * rs; vz = Math.cos(h) * rs;
      this.loco = { facing, vx, vz, turnRate: angleDiff(facing, this.prevFacing) / dt, forwardAccel: 0 };
    }

    vx += this.kbx; vz += this.kbz;
    const k = Math.exp(-this.kbDecay * dt);
    this.kbx *= k; this.kbz *= k;
    if (this.kbDecay !== 9 && Math.hypot(this.kbx, this.kbz) < 0.5) this.kbDecay = 9;
    const got = this.body.move(vx, vz, dt);
    if (f.canLocomote()) this.loco = { ...this.loco, vx: got.vx, vz: got.vz };

    this.updateBlade();
    return events;
  }

  /** Recompute the world-space blade, keeping last tick's for the sweep. */
  private updateBlade(): void {
    const f = this.fighter;
    currentPose(f, this.opts.moveset, this.pose);
    const active = f.isActive();
    if (active && this.wasActive) { this.prevBladeA.copy(this.bladeA); this.prevBladeB.copy(this.bladeB); }
    const w = this.opts.moveset.weapon;
    bladeSegment(this.pose, this.body.pos, this.loco.facing, w.hitFrom, w.hitTo, this.opts.scale, this.bladeA, this.bladeB);
    if (active && !this.wasActive) { this.prevBladeA.copy(this.bladeA); this.prevBladeB.copy(this.bladeB); }
    this.wasActive = active;
  }

  /** @param decay  how fast it bleeds off (1/s); lower slides further (distance ≈ speed / decay). */
  knockback(fromX: number, fromZ: number, speed: number, decay?: number): void {
    const dx = this.body.pos.x - fromX, dz = this.body.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    if (decay !== undefined) this.kbDecay = decay;
    this.kbx += (dx / d) * speed;
    this.kbz += (dz / d) * speed;
  }

  respawn(at: THREE.Vector3, heading: number): void {
    this.fighter.reset();
    this.body.teleport(at);
    this.body.setSolid(true);
    this.loco = createLocoState(heading);
    this.prevFacing = heading;
    this.kbx = this.kbz = 0;
    this.kbDecay = 9;
    this.deadTime = 0;
    this.model.reset();
    this.updateBlade();
  }

  /**
   * @param animate  false skips the (IK-heavy) animation this frame; the time
   *                 is banked and caught up on the next animated frame
   */
  render(dt: number, alpha: number, movement: Tuning['movement'], animate = true): void {
    const p = this.body.interpolate(alpha);
    this.model.root.position.copy(p);
    this.model.root.rotation.y = wrapAngle(this.prevFacing + angleDiff(this.loco.facing, this.prevFacing) * alpha);
    if (!animate) { this.animDebt = Math.min(0.25, this.animDebt + dt); return; }
    dt += this.animDebt;
    this.animDebt = 0;
    this.model.update(dt, {
      speed: this.speed,
      jogSpeed: movement.jogSpeed,
      sprintSpeed: movement.sprintSpeed,
      forwardAccel: this.loco.forwardAccel,
      turnRate: this.loco.turnRate,
      grounded: this.body.grounded,
      combat: this.fighter.state,
      active: this.fighter.isActive(),
    }, this.pose);
  }
}
