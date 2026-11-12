import { noIntent } from '../combat/fighter';
import { angleDiff, headingOf } from '../core/math';
import type { Combatant, ControlInput } from '../entities/combatant';
import type { Tuning } from '../config';

type HordeParams = Tuning['horde'];

/** What a warrior's pair has told it to do. */
export type Order = 'hold' | 'feint' | 'strike' | 'retreat';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * One Parshendi warrior's brain. The pair decides *what* (hold a flanking
 * slot, feint, strike, fall back); the brain works out *how*, producing the
 * same ControlInput the keyboard does so warriors fight under the player's
 * rules. Thinking is budgeted: `think()` runs a dozen times a second per
 * warrior, staggered; `steerTick()` runs every sim tick and is cheap.
 */
export class WarriorBrain {
  order: Order = 'hold';
  /** Slot to stand in for 'hold' / 'retreat', world XZ. */
  slotX = 0;
  slotZ = 0;
  /** Seconds before a 'strike' commits (lets the partner's feint land first). */
  strikeDelay = 0;
  heavy = false;
  berserk = false;
  /** Swing started for the current 'strike' / follow-up. */
  attacked = false;
  /** Strike finished (or was interrupted): the pair can release the token. */
  done = false;
  private orderT = 0;
  private comboWanted = false;
  private comboSent = false;
  private seenSwing = -1;
  private dodgeNow = false;
  private pressLight = false;
  private pressHeavy = false;
  /** Separation push from neighbours, set by the horde each think. */
  sepX = 0;
  sepZ = 0;
  /** Accumulated time since the last think (staggered start). */
  thinkAcc = Math.random();
  readonly out: ControlInput = { ...noIntent, moveX: 0, moveY: 0, sprint: false, walk: false, cameraYaw: 0, targetHeading: null };
  private wantFace = false;
  private wantSprint = false;

  setOrder(o: Order): void {
    if (o === this.order) return;
    this.order = o;
    this.orderT = 0;
    if (o === 'strike' || o === 'feint') { this.attacked = false; this.done = false; this.comboSent = false; }
  }

  /** Decide steering and actions (budgeted). */
  think(dt: number, self: Combatant, player: Combatant, p: HordeParams): void {
    const f = self.fighter;
    this.orderT += dt;
    const dx = player.position.x - self.position.x, dz = player.position.z - self.position.z;
    const dist = Math.hypot(dx, dz) || 1e-3;
    const tx = dx / dist, tz = dz / dist;
    let wx = 0, wz = 0, mag = 1;
    this.wantSprint = false;
    this.wantFace = dist < 10;
    this.out.block = false;

    if (!player.alive) { this.order = 'retreat'; }

    // A Shardblade winding up next to you: some warriors flinch away.
    const pf = player.fighter;
    if (pf.state === 'attack' && pf.move && pf.frame < pf.move.windup && dist < 3.2 && pf.attackSerial !== this.seenSwing) {
      this.seenSwing = pf.attackSerial;
      if (f.state === 'free' && !(this.order === 'strike' && this.attacked) && Math.random() < p.fearDodge * (this.berserk ? 0.3 : 1)) this.dodgeNow = true;
    }

    switch (this.order) {
      case 'hold':
      case 'retreat': {
        const sx = this.slotX - self.position.x, sz = this.slotZ - self.position.z;
        const sd = Math.hypot(sx, sz);
        if (sd > 0.6) { wx = sx / sd; wz = sz / sd; mag = Math.min(1, sd / 2.5 + 0.3); }
        else mag = 0;
        // Don't cut straight past the Shardbearer to reach a slot: bend round.
        if (dist < p.closeRadius - 0.5) { wx -= tx * 1.2; wz -= tz * 1.2; mag = 1; }
        this.wantSprint = sd > 12;
        this.wantFace = dist < 9 && sd < 5;
        break;
      }
      case 'feint': {
        // Step in hard with the axe raised as if to strike, then hold just
        // out of reach: you turn to answer it while its partner commits.
        const want = 3.1;
        if (this.orderT < p.feintLead + 0.5) {
          if (dist > want) { wx = tx; wz = tz; }
          else { wx = -tx * 0.4; wz = -tz * 0.4; }
          this.out.block = dist < 4.5; // weapon up: reads as a strike coming
        } else { wx = -tx; wz = -tz; mag = 0.7; }
        this.wantFace = true;
        break;
      }
      case 'strike': {
        if (f.state === 'attack') {
          // Mid-swing: maybe chain the backhand.
          const m = f.move;
          if (m && this.comboWanted && !this.comboSent && m.chain && f.frame >= m.chainOpen - 6) { this.pressLight = true; this.comboSent = true; }
          mag = 0;
        } else if (this.attacked) {
          if (f.state === 'free') this.done = true;
          wx = -tx; wz = -tz; mag = 0.6;
        } else {
          // Respect the Blade: hover just outside reach until there's an
          // opening (it's swinging at someone else, recovering, or turned
          // away), then commit from lunge range. Berserkers just come.
          const off = Math.abs(angleDiff(headingOf(-dx, -dz), player.facing));
          const pm = pf.move;
          const swinging = pf.state === 'attack' && !!pm && pf.frame < pm.windup + pm.active;
          const threatened = swinging && off < 1.1 && dist < 4.4;
          const busy = (pf.state === 'attack' && !!pm && (pf.frame >= pm.windup + pm.active || off > 1.1))
            || pf.state === 'hitstun' || pf.state === 'stagger' || pf.state === 'parried' || pf.state === 'blockstun';
          const opening = this.berserk || off > 1.3 || busy || this.orderT > this.strikeDelay + 2.6;
          const range = this.heavy ? 3.1 : 2.9;
          const waiting = this.orderT < this.strikeDelay;
          if (threatened && !this.berserk) {
            wx = -tx; wz = -tz; mag = 0.9;
          } else if (waiting || !opening) {
            const sx = this.slotX - self.position.x, sz = this.slotZ - self.position.z;
            const sd = Math.hypot(sx, sz);
            if (sd > 0.5) { wx = sx / sd; wz = sz / sd; mag = Math.min(1, sd / 2 + 0.3); } else mag = 0;
            if (dist < range + 0.2) { wx -= tx; wz -= tz; mag = 0.8; }
          } else if (dist > range) {
            wx = tx; wz = tz;
            this.wantSprint = this.berserk || dist > 5;
            this.wantFace = dist < 4.5;
          } else if (f.state === 'free' || f.state === 'block') {
            if (this.heavy) this.pressHeavy = true; else this.pressLight = true;
            this.comboWanted = !this.heavy && Math.random() < (this.berserk ? 0.8 : 0.45);
            this.attacked = true;
            mag = 0;
          }
        }
        if (this.orderT > this.strikeDelay + 5 || (this.attacked && f.state !== 'attack' && f.state !== 'free')) this.done = true;
        break;
      }
    }

    wx += this.sepX; wz += this.sepZ;
    const len = Math.hypot(wx, wz);
    if (len > 1e-3) { wx /= len; wz /= len; } else mag = 0;
    // Controller axes with cameraYaw 0: world x = -moveX, world z = moveY.
    this.out.moveX = -wx * mag;
    this.out.moveY = wz * mag;
  }

  /** Every tick: fresh facing, and one-shot presses go out exactly once. */
  steerTick(self: Combatant, player: Combatant): ControlInput {
    const o = this.out;
    o.light = this.pressLight; o.heavy = this.pressHeavy; o.heavyHeld = this.pressHeavy;
    o.dodge = this.dodgeNow;
    if (this.dodgeNow) {
      // Step back away from the Shardbearer.
      const dx = self.position.x - player.position.x, dz = self.position.z - player.position.z;
      const d = Math.hypot(dx, dz) || 1;
      o.moveX = -dx / d; o.moveY = dz / d;
    }
    this.pressLight = this.pressHeavy = this.dodgeNow = false;
    o.sprint = this.wantSprint || this.berserk;
    o.targetHeading = this.wantFace && player.alive
      ? headingOf(player.position.x - self.position.x, player.position.z - self.position.z) : null;
    return o;
  }

  reset(): void {
    this.order = 'hold';
    this.orderT = 0;
    this.attacked = this.done = this.berserk = false;
    this.pressLight = this.pressHeavy = this.dodgeNow = false;
    this.sepX = this.sepZ = 0;
    this.out.block = false;
    this.out.moveX = this.out.moveY = 0;
  }
}

export interface PairMember {
  c: Combatant;
  brain: WarriorBrain;
}

type PairPhase = 'gather' | 'engage' | 'rest';

let nextPairId = 1;

/**
 * Two warriors (sometimes one, sometimes three after a regroup) who fight as
 * one: they take flanking slots either side of their axis around the
 * Shardbearer, ask the horde for attack tokens, and when granted, one draws
 * your eye with a feint while the other commits from the flank.
 */
export class Pair<M extends PairMember = PairMember> {
  readonly id = nextPairId++;
  members: M[] = [];
  /** Angle around the player (world polar, radians) this pair works from. */
  axis = Math.random() * Math.PI * 2;
  phase: PairPhase = 'gather';
  tokens = 0;
  /** Tokens wanted right now (read by the token allocator). */
  want = 0;
  waited = 0;
  cooldown = rand(0.5, 1.5);
  berserk = false;
  /** Which waiting ring (0 = innermost) the horde has put this pair on. */
  ring = 0;
  private engageT = 0;
  private striker: M | null = null;
  private feinter: M | null = null;
  private wobble = Math.random() * 10;

  get alive(): M[] { return this.members.filter((m) => m.c.alive); }

  /** Token priority: waited longer, nearer, angrier first. */
  priority(): number {
    return this.waited + (this.berserk ? 3 : 0);
  }

  update(dt: number, player: Combatant, p: HordeParams): void {
    const alive = this.alive;
    this.cooldown -= dt;
    this.wobble += dt;
    if (!alive.length) { this.want = 0; return; }
    const px = player.position.x, pz = player.position.z;
    const flank = (p.flankAngle * Math.PI) / 180;
    const slot = (m: M, i: number, radius: number) => {
      const a = alive.length === 1 ? this.axis : this.axis + (i === 0 ? -flank : flank) * (alive.length === 3 && i === 2 ? 0 : 1);
      m.brain.slotX = px + Math.cos(a) * radius;
      m.brain.slotZ = pz + Math.sin(a) * radius;
    };

    switch (this.phase) {
      case 'gather':
      case 'rest': {
        // Circle at a distance; now and then shuffle in close and wait.
        const breathe = 0.5 + 0.5 * Math.sin(this.wobble * 0.9 + this.id);
        const r = p.closeRadius + (p.holdRadius - p.closeRadius) * (this.waited > 1.2 && this.ring === 0 ? breathe : 1) + this.ring * p.ringGap;
        let near = 0;
        alive.forEach((m, i) => {
          slot(m, i, r);
          m.brain.setOrder(this.phase === 'rest' ? 'retreat' : 'hold');
          if (Math.hypot(m.c.position.x - m.brain.slotX, m.c.position.z - m.brain.slotZ) < 3.5) near++;
        });
        if (this.phase === 'rest' && this.cooldown <= 0) this.phase = 'gather';
        const ready = this.phase === 'gather' && this.cooldown <= 0 && player.alive && (near > 0 || this.waited > 3);
        this.want = ready ? Math.min(2, alive.length) : 0;
        if (ready) this.waited += dt;
        if (ready && this.tokens > 0) this.engage(alive, player, p);
        break;
      }
      case 'engage': {
        this.engageT += dt;
        const s = this.striker, fe = this.feinter;
        // Striker waits on the flank just outside reach until the feint lands.
        if (s?.c.alive && !s.brain.attacked) slot(s, alive.indexOf(s), 3.4);
        // A second token turns the feint into a real follow-up.
        if (fe?.c.alive && fe.brain.order === 'feint' && this.tokens >= 2 && this.engageT > p.feintLead + 0.45) {
          fe.brain.setOrder('strike');
          fe.brain.heavy = Math.random() < 0.3;
          fe.brain.strikeDelay = 0;
        }
        const strikers = alive.filter((m) => m.brain.order === 'strike');
        const finished = strikers.every((m) => m.brain.done) && (!fe || !fe.c.alive || fe.brain.order !== 'feint' || this.engageT > p.feintLead + 1.4);
        if (finished || this.engageT > 6 || !player.alive) this.rest(p);
        else this.want = this.tokens; // keep what we hold
        break;
      }
    }
  }

  private engage(alive: M[], player: Combatant, p: HordeParams): void {
    this.phase = 'engage';
    this.engageT = 0;
    this.waited = 0;
    // The one more behind the Shardbearer strikes; the one he faces feints.
    const behind = (m: M) => Math.abs(angleDiff(headingOf(m.c.position.x - player.position.x, m.c.position.z - player.position.z), player.facing));
    const sorted = [...alive].sort((a, b) => behind(b) - behind(a));
    this.striker = sorted[0];
    this.feinter = sorted.length > 1 ? sorted[sorted.length - 1] : null;
    const s = this.striker.brain;
    s.setOrder('strike');
    s.heavy = Math.random() < (this.berserk ? 0.45 : 0.3);
    s.strikeDelay = this.feinter ? p.feintLead : 0;
    this.feinter?.brain.setOrder('feint');
    for (const m of sorted.slice(1, -1)) m.brain.setOrder('hold');
  }

  private rest(p: HordeParams): void {
    this.phase = 'rest';
    this.want = 0;
    this.cooldown = p.tokenCooldown * (this.berserk ? 0.35 : 1) * rand(0.8, 1.3);
    this.striker = this.feinter = null;
  }

  /** A partner fell: the survivor either goes berserk or is free to regroup. */
  onMemberDied(p: HordeParams): 'berserk' | 'regroup' | 'none' {
    const alive = this.alive;
    if (alive.length !== 1 || this.berserk) return 'none';
    if (Math.random() < p.berserkChance) {
      this.berserk = true;
      alive[0].brain.berserk = true;
      this.cooldown = Math.min(this.cooldown, 0.3);
      return 'berserk';
    }
    return 'regroup';
  }

  /** Reset to a fresh pair state (after members change). */
  regroup(): void {
    this.phase = 'gather';
    this.striker = this.feinter = null;
    this.cooldown = Math.max(this.cooldown, 0.6);
    for (const m of this.alive) m.brain.setOrder('hold');
  }
}
