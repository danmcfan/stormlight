import { noIntent } from '../combat/fighter';
import { headingOf } from '../core/math';
import type { Combatant, ControlInput } from './combatant';

export interface AIParams {
  /** 0..1: how quickly it decides to attack after circling. */
  aggression: number;
  /** 0..1: chance to raise its guard against a swing it sees coming. */
  blockChance: number;
  /** 0..1: chance to step back out of a swing instead. */
  dodgeChance: number;
  /** Seconds before it reacts to your windup. */
  reaction: number;
  /** 0..1: when it blocks, chance its timing is good enough to parry. */
  parryChance: number;
}

type Mode = 'idle' | 'approach' | 'circle' | 'press' | 'recover' | 'retreat' | 'guard';

const ENGAGE_RANGE = 16;
const STRIKE_RANGE = 2.6;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Parshendi duelist brain. Produces the same ControlInput the keyboard does,
 * so the AI fights under exactly the player's rules (stamina, recovery,
 * parry windows).
 */
export class DuelAI {
  mode: Mode = 'idle';
  private timer = 0;
  private circleDir = 1;
  private heavyNext = false;
  private comboWanted = false;
  private comboSent = false;
  /** Identity of the target's swing we last reacted to. */
  private seenSwing = -1;
  private reactIn = -1;
  private reactWith: 'block' | 'dodge' | null = null;

  constructor(readonly params: () => AIParams, readonly aggressive: boolean) {}

  think(dt: number, self: Combatant, target: Combatant): ControlInput {
    const out: ControlInput = { ...noIntent, moveX: 0, moveY: 0, sprint: false, walk: false, cameraYaw: 0, targetHeading: null };
    const f = self.fighter;
    const p = this.params();
    const dx = target.position.x - self.position.x, dz = target.position.z - self.position.z;
    const dist = Math.hypot(dx, dz);
    const toward = { x: dx / (dist || 1), z: dz / (dist || 1) };

    if (!target.alive || !f.alive || dist > ENGAGE_RANGE) { this.mode = 'idle'; return out; }
    out.targetHeading = headingOf(dx, dz);
    if (!this.aggressive) return out; // training warriors just watch you

    // World direction → controller axes (with cameraYaw 0: x = -moveX, z = moveY).
    const steer = (wx: number, wz: number, scale = 1) => { out.moveX = -wx * scale; out.moveY = wz * scale; };
    const side = { x: -toward.z * this.circleDir, z: toward.x * this.circleDir };

    // React to the player's windup: block or step back, after a human-ish delay.
    const tf = target.fighter;
    if (tf.state === 'attack' && tf.move && tf.frame < tf.move.windup && dist < 4 && tf.attackSerial !== this.seenSwing
        && this.mode !== 'press' && this.mode !== 'recover') {
      this.seenSwing = tf.attackSerial; // decide once per swing
      const r = Math.random();
      this.reactWith = r < p.blockChance ? 'block' : r < p.blockChance + p.dodgeChance ? 'dodge' : null;
      this.reactIn = this.reactWith ? p.reaction : -1;
    }
    if (this.reactIn >= 0) {
      this.reactIn -= dt;
      if (this.reactIn < 0) {
        if (this.reactWith === 'block') {
          this.mode = 'guard';
          this.timer = rand(0.6, 0.9);
          f.parryEnabled = Math.random() < p.parryChance;
        }
        else if (this.reactWith === 'dodge') { out.dodge = true; steer(-toward.x, -toward.z); this.mode = 'retreat'; this.timer = 0.4; }
      }
    }

    switch (this.mode) {
      case 'idle':
        this.mode = 'approach';
        break;
      case 'approach':
        steer(toward.x, toward.z);
        if (dist < STRIKE_RANGE + 0.3) this.enterCircle(p);
        break;
      case 'circle': {
        // Strafe around the player, holding a little outside striking range.
        const inOut = dist > 3.2 ? 0.7 : dist < 2.3 ? -0.6 : 0;
        steer(side.x * 0.8 + toward.x * inOut, side.z * 0.8 + toward.z * inOut);
        this.timer -= dt;
        if (this.timer <= 0) {
          if (f.stamina > 25) { this.mode = 'press'; this.timer = 1.6; this.heavyNext = Math.random() < 0.3; }
          else this.enterCircle(p);
        }
        if (dist > 5) this.mode = 'approach';
        break;
      }
      case 'press':
        // Close the gap, then commit.
        this.timer -= dt;
        if (dist > STRIKE_RANGE) steer(toward.x, toward.z);
        else if (f.state === 'free') {
          if (this.heavyNext) { out.heavy = true; out.heavyHeld = true; } else out.light = true;
          this.comboWanted = !this.heavyNext && Math.random() < 0.55;
          this.comboSent = false;
          this.mode = 'recover';
        }
        if (this.timer <= 0) this.enterCircle(p);
        break;
      case 'recover':
        if (f.state === 'attack' && f.move) {
          if (this.comboWanted && !this.comboSent && f.move.chain && f.frame >= f.move.chainOpen - 6) {
            out.light = true;
            this.comboSent = true;
          }
        } else if (f.state === 'free') {
          this.mode = 'retreat';
          this.timer = rand(0.4, 0.9);
        } else if (f.state !== 'attack') {
          this.enterCircle(p); // got interrupted
        }
        break;
      case 'retreat':
        steer(-toward.x * 0.8 + side.x * 0.4, -toward.z * 0.8 + side.z * 0.4);
        this.timer -= dt;
        if (this.timer <= 0) this.enterCircle(p);
        break;
      case 'guard':
        out.block = true;
        steer(-toward.x * 0.3 + side.x * 0.3, -toward.z * 0.3 + side.z * 0.3);
        this.timer -= dt;
        if (this.timer <= 0) this.enterCircle(p);
        break;
    }
    return out;
  }

  private enterCircle(p: AIParams): void {
    this.mode = 'circle';
    if (Math.random() < 0.35) this.circleDir *= -1;
    // Higher aggression = shorter circling before pressing in.
    this.timer = rand(0.5, 1.8) * (1.4 - p.aggression);
  }
}
