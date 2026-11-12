import { noIntent } from '../combat/fighter';
import { hrand, hrange } from './rng';
import { FLANK, strikeDecision } from './strike';
import { angleDiff, headingOf } from '../core/math';
import type { Combatant, ControlInput } from '../entities/combatant';
import type { Tuning } from '../config';

type HordeParams = Tuning['horde'];

/** What a warrior's pair has told it to do. */
export type Order = 'hold' | 'feint' | 'strike' | 'retreat';

const rand = hrange;

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
  private pressQuick = false;
  /** Committed to this strike: no more hovering. */
  private committed = false;
  /** Use the quick flank cut. */
  private quick = false;
  /** Seconds left of a back-off step, and until another is allowed. */
  private backOffT = 0;
  backOffCooldown = 0;
  /** Part of a synchronised volley: commit at once. */
  volley = false;
  /** The other member of the pair (the brain punishes swings at it). */
  partner: Combatant | null = null;
  /** Separation push from neighbours, set by the horde each think. */
  sepX = 0;
  sepZ = 0;
  /** Accumulated time since the last think (staggered start). */
  thinkAcc = hrand();
  readonly out: ControlInput = { ...noIntent, moveX: 0, moveY: 0, sprint: false, walk: false, cameraYaw: 0, targetHeading: null };
  private wantFace = false;
  private wantSprint = false;

  setOrder(o: Order): void {
    if (o === this.order) return;
    this.order = o;
    this.orderT = 0;
    if (o === 'strike' || o === 'feint') { this.attacked = false; this.done = false; this.comboSent = false; this.committed = false; this.quick = false; this.backOffT = 0; }
    if (o !== 'strike') this.volley = false;
  }

  /** Decide steering and actions (budgeted). */
  think(dt: number, self: Combatant, player: Combatant, p: HordeParams): void {
    const f = self.fighter;
    this.orderT += dt;
    this.backOffCooldown -= dt;
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
      if (f.state === 'free' && !(this.order === 'strike' && this.attacked) && hrand() < p.fearDodge * (this.berserk ? 0.3 : 1)) this.dodgeNow = true;
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
          // Respect the Blade, but not forever: see strike.ts for the rules.
          const off = Math.abs(angleDiff(headingOf(-dx, -dz), player.facing));
          const pm = pf.move;
          const swinging = pf.state === 'attack' && !!pm && pf.frame < pm.windup + pm.active;
          const recovering = (pf.state === 'attack' && !!pm && pf.frame >= pm.windup + pm.active)
            || pf.state === 'hitstun' || pf.state === 'stagger' || pf.state === 'parried' || pf.state === 'blockstun';
          // Is his swing aimed at someone else (the partner, usually)?
          let atOther = off > FLANK;
          const mate = this.partner;
          if (swinging && mate?.alive) {
            const mo = Math.abs(angleDiff(headingOf(mate.position.x - player.position.x, mate.position.z - player.position.z), player.facing));
            if (mo < 0.9 && mate.position.distanceTo(player.position) < 4.6) atOther = true;
          }
          if (this.backOffT > 0) {
            this.backOffT -= dt;
            wx = -tx; wz = -tz; mag = 0.9;
          } else if (!this.committed) {
            const choice = strikeDecision({
              dist, facingOff: off, swinging, swingingAtOther: atOther, recovering,
              waited: this.orderT, delay: this.strikeDelay, patience: p.strikePatience,
              canBackOff: this.backOffCooldown <= 0, berserk: this.berserk, volley: this.volley,
            });
            if (choice.action === 'backOff') {
              this.backOffT = 0.45;
              this.backOffCooldown = p.backOffCooldown;
              wx = -tx; wz = -tz; mag = 0.9;
            } else if (choice.action === 'commit') {
              this.committed = true;
              this.quick = choice.quick && !this.heavy;
            } else {
              const sx = this.slotX - self.position.x, sz = this.slotZ - self.position.z;
              const sd = Math.hypot(sx, sz);
              if (sd > 0.5) { wx = sx / sd; wz = sz / sd; mag = Math.min(1, sd / 2 + 0.3); } else mag = 0;
              if (dist < 3.1) { wx -= tx; wz -= tz; mag = 0.8; }
            }
          }
          if (this.committed) {
            const range = this.heavy ? 3.1 : this.quick ? 3.0 : 2.9;
            if (dist > range) {
              wx = tx; wz = tz;
              this.wantSprint = true;
              this.wantFace = dist < 4.5;
            } else if (f.state === 'free' || f.state === 'block') {
              if (this.quick) this.pressQuick = true;
              else if (this.heavy) this.pressHeavy = true;
              else this.pressLight = true;
              this.comboWanted = !this.heavy && !this.quick && hrand() < (this.berserk ? 0.8 : 0.45);
              this.attacked = true;
              mag = 0;
            }
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
    o.shove = this.pressQuick; // a warrior's secondary move is the quick flank cut
    o.dodge = this.dodgeNow;
    if (this.dodgeNow) {
      // Step back away from the Shardbearer.
      const dx = self.position.x - player.position.x, dz = self.position.z - player.position.z;
      const d = Math.hypot(dx, dz) || 1;
      o.moveX = -dx / d; o.moveY = dz / d;
    }
    this.pressLight = this.pressHeavy = this.pressQuick = this.dodgeNow = false;
    o.sprint = this.wantSprint || this.berserk;
    o.targetHeading = this.wantFace && player.alive
      ? headingOf(player.position.x - self.position.x, player.position.z - self.position.z) : null;
    return o;
  }

  reset(): void {
    this.order = 'hold';
    this.orderT = 0;
    this.attacked = this.done = this.berserk = this.committed = this.quick = this.volley = false;
    this.pressLight = this.pressHeavy = this.pressQuick = this.dodgeNow = false;
    this.backOffT = this.backOffCooldown = 0;
    this.partner = null;
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
  axis = hrand() * Math.PI * 2;
  phase: PairPhase = 'gather';
  tokens = 0;
  /** Tokens wanted right now (read by the token allocator). */
  want = 0;
  waited = 0;
  cooldown = rand(0.5, 1.5);
  berserk = false;
  /** The Shardbearer is right on top of one of us. */
  chased = false;
  /** Which waiting ring (0 = innermost) the horde has put this pair on. */
  ring = 0;
  private engageT = 0;
  private striker: M | null = null;
  private feinter: M | null = null;
  private wobble = hrand() * 10;

  get alive(): M[] { return this.members.filter((m) => m.c.alive); }

  /** Token priority: waited longer, nearer, angrier first. */
  priority(): number {
    return this.waited + (this.berserk ? 3 : 0) + (this.chased ? 4 : 0);
  }

  /** Ready to be sent into a volley (waiting, off cooldown, no tokens yet). */
  canVolley(): boolean {
    return this.phase === 'gather' && this.cooldown <= 0 && this.tokens === 0 && this.alive.length > 0;
  }

  /** Commit now as half of a synchronised volley (holds one token). */
  startVolley(player: Combatant, p: HordeParams): void {
    this.tokens = 1;
    this.engage(this.alive, player, p, true);
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

    // Partners watch each other's backs.
    for (const m of alive) m.brain.partner = alive.find((o) => o !== m)?.c ?? null;
    // Come at a pair and it fights back now, cooldown or not.
    if (this.phase !== 'engage' && player.alive
        && alive.some((m) => Math.hypot(m.c.position.x - px, m.c.position.z - pz) < p.chasedRange)) {
      this.cooldown = Math.min(this.cooldown, 0);
      this.phase = 'gather';
      this.chased = true;
    } else this.chased = false;

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
        const ready = this.phase === 'gather' && this.cooldown <= 0 && player.alive && (near > 0 || this.waited > 3 || this.chased);
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
          fe.brain.heavy = hrand() < 0.3;
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

  private engage(alive: M[], player: Combatant, p: HordeParams, volley = false): void {
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
    s.heavy = hrand() < (this.berserk ? 0.45 : 0.3);
    s.strikeDelay = this.feinter && !volley ? p.feintLead : 0;
    s.volley = volley;
    if (volley) s.heavy = false; // volleys are quick, on the beat
    this.feinter?.brain.setOrder('feint');
    for (const m of sorted.slice(1, -1)) m.brain.setOrder('hold');
  }

  private rest(p: HordeParams): void {
    this.phase = 'rest';
    this.want = 0;
    this.cooldown = p.tokenCooldown * (this.berserk ? 0.35 : 1) * rand(0.8, 1.3);
    this.striker = this.feinter = null;
  }

  /** Fight with nothing held back: shorter rests, first call on tokens, no hovering. */
  goBerserk(): void {
    this.berserk = true;
    for (const m of this.alive) m.brain.berserk = true;
    this.cooldown = Math.min(this.cooldown, 0.3);
  }

  /** A partner fell: the survivor either goes berserk or is free to regroup. */
  onMemberDied(p: HordeParams): 'berserk' | 'regroup' | 'none' {
    const alive = this.alive;
    if (alive.length !== 1 || this.berserk) return 'none';
    if (hrand() < p.berserkChance) {
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
