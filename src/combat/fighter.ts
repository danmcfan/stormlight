import { moves, moveTotal, type Move, type Moveset, type Stance } from './moves';

export type FighterState =
  | 'free' | 'attack' | 'dodge' | 'block' | 'blockstun'
  | 'hitstun' | 'stagger' | 'parried' | 'switch' | 'dead';

/** What the controller (player input or AI) wants this tick. */
export interface Intent {
  light: boolean;
  heavy: boolean;
  heavyHeld: boolean;
  dodge: boolean;
  block: boolean;
  switchStance: boolean;
  /** Plate shove (crowd control); only movesets with a `shove` move use it. */
  shove?: boolean;
}

export const noIntent: Intent = { light: false, heavy: false, heavyHeld: false, dodge: false, block: false, switchStance: false, shove: false };

export interface FighterStats {
  maxHp: number;
  maxStamina: number;
  maxPoise: number;
  /** Stamina regained per second once the regen delay has passed. */
  staminaRegen: number;
  damageScale: number;
  /** Wearing Shardplate: survives Shardblade strikes. */
  shardplate: boolean;
}

/** Tunables shared by every fighter (live-editable from the tuning panel). */
export interface CombatRules {
  /** Frames after raising the guard during which a block is a parry. */
  parryWindow: number;
  /** Frames an input is remembered while busy. */
  inputBuffer: number;
  hitstunLight: number;
  hitstunHeavy: number;
  staggerFrames: number;
  parriedFrames: number;
  blockstunFrames: number;
  dodgeFrames: number;
  /** Invulnerable frames [from, to) of a dodge. */
  dodgeIFrames: [number, number];
  dodgeDistance: number;
  dodgeStamina: number;
  /** Damage multiplier for hits on a staggered / parried fighter. */
  riposteMult: number;
}

export const DEFAULT_RULES: CombatRules = {
  parryWindow: 9,
  inputBuffer: 14,
  hitstunLight: 20,
  hitstunHeavy: 30,
  staggerFrames: 60,
  parriedFrames: 70,
  blockstunFrames: 14,
  dodgeFrames: 26,
  dodgeIFrames: [2, 15],
  dodgeDistance: 3.4,
  dodgeStamina: 20,
  riposteMult: 1.6,
};

export type FighterEvent =
  | { type: 'attackStart'; move: Move }
  | { type: 'activeStart'; move: Move }
  | { type: 'dodgeStart' }
  | { type: 'stanceSwitched'; stance: Stance };

export type HitOutcome = 'ignored' | 'hit' | 'block' | 'parry' | 'guardBreak' | 'kill';

type Action = 'light' | 'heavy' | 'dodge' | 'shove';

const SWITCH_FRAMES = 14;
const STAMINA_REGEN_DELAY = 36;
const POISE_RESET_DELAY = 120;

/**
 * Combat state machine for one fighter, in 60 Hz frames.
 * Knows nothing about rendering or physics: the owning entity reads
 * `rootSpeed()` / `canLocomote()` to move, and `currentPose` for the blade.
 */
export class Fighter {
  state: FighterState = 'free';
  /** Frames since entering the state (for attacks: the move's own clock, paused while charging). */
  frame = 0;
  move: Move | null = null;
  stance: Stance = 'wind';
  hp: number;
  stamina: number;
  poise: number;
  chargeFrames = 0;
  private charging = false;
  private buffer: { action: Action; ttl: number } | null = null;
  private stunFrames = 0;
  private regenDelay = 0;
  private sincePoiseHit = 999;
  /** When false, a freshly raised guard is only a block, never a parry (AI skill knob). */
  parryEnabled = true;
  /** Increments with every attack started (lets observers react once per swing). */
  attackSerial = 0;
  /** Ids already hit by the current swing. */
  readonly hitIds = new Set<number>();

  constructor(readonly stats: FighterStats, readonly moveset: Moveset, public rules: CombatRules = DEFAULT_RULES) {
    this.hp = stats.maxHp;
    this.stamina = stats.maxStamina;
    this.poise = stats.maxPoise;
  }

  // --- Queries ------------------------------------------------------------------

  get alive(): boolean { return this.state !== 'dead'; }

  /** Free movement allowed (walking, strafing, blocking-while-walking). */
  canLocomote(): boolean { return this.state === 'free' || this.state === 'block'; }

  isActive(): boolean {
    const m = this.move;
    return this.state === 'attack' && !!m && this.frame >= m.windup && this.frame < m.windup + m.active;
  }

  invulnerable(): boolean {
    const [a, b] = this.rules.dodgeIFrames;
    return this.state === 'dodge' && this.frame >= a && this.frame < b;
  }

  hyperArmor(): boolean {
    const h = this.move?.hyperArmor;
    return this.state === 'attack' && !!h && this.frame >= h[0] && this.frame < h[1];
  }

  /** 0..1 how much of the heavy's charge was used. */
  chargeFrac(): number {
    const c = this.move?.charge;
    return c ? Math.min(1, this.chargeFrames / c.max) : 0;
  }

  /** Is the attacker still turning to face its target? */
  tracking(): boolean {
    return this.state === 'attack' && !!this.move && (this.frame < this.move.track || this.charging);
  }

  /** Forward speed (m/s along facing, or along the dodge direction) from root motion. */
  rootSpeed(): number {
    if (this.state === 'dodge') {
      // Fast burst that eases out: integral over dodgeFrames = dodgeDistance.
      const n = this.rules.dodgeFrames * 0.75;
      if (this.frame >= n) return 0;
      const t = this.frame / n;
      return (this.rules.dodgeDistance * 2 * (1 - t)) / (n / 60);
    }
    if (this.state === 'attack' && this.move?.lunge && !this.charging) {
      const mult = 1 + ((this.move.charge?.lungeMult ?? 1) - 1) * this.chargeFrac();
      for (const [from, to, dist] of this.move.lunge) {
        if (this.frame >= from && this.frame < to) return ((dist * mult) / (to - from)) * 60;
      }
    }
    return 0;
  }

  // --- Simulation -----------------------------------------------------------------

  tick(intent: Intent): FighterEvent[] {
    const events: FighterEvent[] = [];
    if (this.state === 'dead') { this.frame++; return events; }

    if (intent.light) this.buffer = { action: 'light', ttl: this.rules.inputBuffer };
    else if (intent.heavy) this.buffer = { action: 'heavy', ttl: this.rules.inputBuffer };
    else if (intent.dodge) this.buffer = { action: 'dodge', ttl: this.rules.inputBuffer };
    else if (intent.shove && this.moveset.shove) this.buffer = { action: 'shove', ttl: this.rules.inputBuffer };

    switch (this.state) {
      case 'free':
      case 'block': {
        if (this.buffer && this.tryAction(this.buffer.action, events)) { this.buffer = null; break; }
        if (intent.switchStance) { this.enter('switch'); this.stunFrames = SWITCH_FRAMES; break; }
        if (intent.block && this.state !== 'block') this.enter('block');
        else if (!intent.block && this.state === 'block') this.enter('free');
        else this.frame++;
        break;
      }
      case 'attack': {
        const m = this.move!;
        if (this.charging && !intent.heavyHeld) this.charging = false;
        if (this.charging && m.charge && this.frame === m.charge.holdAt && this.chargeFrames < m.charge.max) {
          this.chargeFrames++;
        } else {
          // Past the hold point (or charge maxed): the swing is released.
          if (m.charge && this.frame >= m.charge.holdAt) this.charging = false;
          this.frame++;
          if (this.frame === m.windup) events.push({ type: 'activeStart', move: m });
        }
        if (this.frame >= moveTotal(m)) { this.enter('free'); break; }
        const b = this.buffer;
        if (b) {
          if (b.action === 'dodge' && this.frame >= m.dodgeCancel) {
            if (this.tryAction('dodge', events)) this.buffer = null;
          } else if (b.action !== 'dodge' && this.frame >= m.chainOpen) {
            const next = b.action === 'light' ? m.chain
              : b.action === 'shove' ? (m.shove ? undefined : this.moveset.shove)
              : (m.kind === 'light' && !m.shove ? this.moveset.heavy[this.stance] : undefined);
            if (next && this.startAttack(next, b.action === 'heavy', events)) this.buffer = null;
          }
        }
        break;
      }
      case 'dodge': {
        this.frame++;
        if (this.frame >= this.rules.dodgeFrames) { this.enter('free'); break; }
        // Late in the dodge an attack can come out of it.
        if (this.buffer && this.buffer.action !== 'dodge' && this.frame >= this.rules.dodgeFrames - 8) {
          if (this.tryAction(this.buffer.action, events)) this.buffer = null;
        }
        break;
      }
      case 'switch': {
        this.frame++;
        if (this.frame === Math.floor(SWITCH_FRAMES / 2)) {
          this.stance = this.stance === 'wind' ? 'stone' : 'wind';
          events.push({ type: 'stanceSwitched', stance: this.stance });
        }
        if (--this.stunFrames <= 0) this.enter('free');
        break;
      }
      default: {
        // hitstun, blockstun, stagger, parried: wait it out.
        this.frame++;
        if (--this.stunFrames <= 0) {
          const wasBlocking = this.state === 'blockstun';
          this.enter(intent.block ? 'block' : 'free');
          // Holding guard through block-stun keeps the guard up, but it is not a fresh parry.
          if (wasBlocking && (this.state as FighterState) === 'block') this.frame = this.rules.parryWindow;
        }
      }
    }

    if (this.buffer && --this.buffer.ttl <= 0) this.buffer = null;
    this.regen();
    return events;
  }

  private regen(): void {
    if (this.regenDelay > 0) this.regenDelay--;
    else if (this.state !== 'attack' && this.state !== 'dodge') {
      const rate = this.state === 'block' ? 0.35 : 1;
      this.stamina = Math.min(this.stats.maxStamina, this.stamina + (this.stats.staminaRegen * rate) / 60);
    }
    if (++this.sincePoiseHit > POISE_RESET_DELAY) this.poise = this.stats.maxPoise;
  }

  private enter(s: FighterState): void {
    this.state = s;
    this.frame = 0;
    if (s !== 'attack') { this.move = null; this.charging = false; this.chargeFrames = 0; }
  }

  private tryAction(a: Action, events: FighterEvent[]): boolean {
    if (a === 'dodge') {
      if (this.stamina <= 0) return false;
      this.spend(this.rules.dodgeStamina);
      this.enter('dodge');
      events.push({ type: 'dodgeStart' });
      return true;
    }
    const id = a === 'light' ? this.moveset.light[this.stance] : a === 'shove' ? this.moveset.shove : this.moveset.heavy[this.stance];
    if (!id) return false;
    return this.startAttack(id, a === 'heavy', events);
  }

  private startAttack(id: string, held: boolean, events: FighterEvent[]): boolean {
    const m = moves[id];
    if (!m || this.stamina <= 0) return false;
    this.spend(m.staminaCost);
    this.enter('attack');
    this.move = m;
    this.charging = held && !!m.charge;
    this.chargeFrames = 0;
    this.hitIds.clear();
    this.attackSerial++;
    events.push({ type: 'attackStart', move: m });
    return true;
  }

  private spend(n: number): void {
    this.stamina -= n; // may go negative: you can always start, but then you're spent
    this.regenDelay = STAMINA_REGEN_DELAY;
  }

  // --- Being hit --------------------------------------------------------------------

  /**
   * Resolve an incoming hit.
   * @param facingOff  angle between this fighter's facing and the direction to
   *                   the attacker (radians, 0 = attacker straight ahead)
   */
  receiveHit(attacker: Fighter, move: Move, facingOff: number): HitOutcome {
    if (!this.alive || this.invulnerable()) return 'ignored';
    // A Shardblade shears through flesh, armour and ordinary weapons alike:
    // without Plate, no guard or parry helps.
    if (attacker.moveset.weapon.shardblade && !this.stats.shardplate) {
      this.hp = 0;
      this.enter('dead');
      return 'kill';
    }
    const charge = 1 + ((move.charge?.damageMult ?? 1) - 1) * attacker.chargeFrac();
    const frontal = Math.abs(facingOff) < (75 * Math.PI) / 180;

    if (this.state === 'block' && frontal) {
      if (this.frame < this.rules.parryWindow && move.parryable && this.parryEnabled) {
        attacker.enter('parried');
        attacker.stunFrames = this.rules.parriedFrames;
        return 'parry';
      }
      this.stamina -= move.guardDamage * charge;
      this.regenDelay = STAMINA_REGEN_DELAY;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.enter('stagger');
        this.stunFrames = this.rules.staggerFrames;
        return 'guardBreak';
      }
      // A little damage bleeds through a guard.
      this.hp -= move.damage * charge * 0.1 * attacker.stats.damageScale;
      this.enter('blockstun');
      this.stunFrames = this.rules.blockstunFrames;
      return this.checkDeath() ? 'kill' : 'block';
    }

    const vulnerable = this.state === 'stagger' || this.state === 'parried';
    this.hp -= move.damage * charge * attacker.stats.damageScale * (vulnerable ? this.rules.riposteMult : 1);
    if (this.checkDeath()) return 'kill';

    this.poise -= move.poiseDamage * charge;
    this.sincePoiseHit = 0;
    if (this.poise <= 0) {
      this.poise = this.stats.maxPoise;
      this.enter('stagger');
      this.stunFrames = this.rules.staggerFrames;
    } else if (!this.hyperArmor() && !vulnerable) {
      this.enter('hitstun');
      this.stunFrames = move.kind === 'heavy' ? this.rules.hitstunHeavy : this.rules.hitstunLight;
    }
    return 'hit';
  }

  /**
   * Knocked off balance by a shove: no damage, but a stagger long enough to
   * be shoved again or cut down. Returns false if it didn't land.
   */
  receiveShove(frames: number): boolean {
    if (!this.alive || this.invulnerable()) return false;
    this.enter('stagger');
    this.stunFrames = frames;
    return true;
  }

  /** Dies outright (a fall into the chasm). */
  kill(): void {
    if (!this.alive) return;
    this.hp = 0;
    this.enter('dead');
  }

  private checkDeath(): boolean {
    if (this.hp > 0) return false;
    this.hp = 0;
    this.enter('dead');
    return true;
  }

  /** Back to full health, standing, ready. */
  reset(): void {
    this.hp = this.stats.maxHp;
    this.stamina = this.stats.maxStamina;
    this.poise = this.stats.maxPoise;
    this.buffer = null;
    this.enter('free');
  }
}
