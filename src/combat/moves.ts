/**
 * Attack data. Everything is in 60 Hz sim frames.
 *
 * A move runs windup → active → recovery. During the active frames the
 * weapon's blade segment is swept against opponents. The blade's position
 * comes from `keys`: sword directions (yaw/pitch in degrees, body space)
 * at given frames, interpolated along great-circle arcs. The same keys drive
 * the animation, so what you see is exactly what hits.
 *
 * The Shardbearer's sword moves each carry an anticipation key in the windup (the blade cocked
 * further back, the torso wound tighter) and an overswing key in the recovery. They sit outside
 * the active frames, which are the only frames the blade is tested against opponents, so they
 * make a swing read heavier without moving where or when it hits.
 *
 * Body-space angles: yaw 0 = straight ahead, positive yaw = to the LEFT,
 * negative = to the RIGHT. Pitch 90 = straight up, >90 = over the head
 * toward the back, negative = downward.
 */

export type Stance = 'wind' | 'stone';

export interface BladeKey {
  f: number;
  yaw: number;
  pitch: number;
  /** Hand distance from the chest pivot, metres (default 0.5). */
  reach?: number;
  /** Torso twist in degrees (visual weight; positive = shoulders turn left). */
  twist?: number;
}

export interface Move {
  id: string;
  name: string;
  kind: 'light' | 'heavy';
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  /** Damage to poise; breaking poise staggers. */
  poiseDamage: number;
  staminaCost: number;
  /** Stamina drained from a defender who blocks it. */
  guardDamage: number;
  /** Metres/second shove applied to whoever is hit. */
  knockback: number;
  /** Frames the whole world freezes on impact. */
  hitStop: number;
  /** Next light move in the combo. */
  chain?: string;
  /** Frame from which a buffered attack chains into the next move. */
  chainOpen: number;
  /** Frame from which a dodge can cancel the recovery. */
  dodgeCancel: number;
  /** Frames during which the attacker keeps turning to face the target. */
  track: number;
  /** Root motion: [fromFrame, toFrame, metres moved forward]. */
  lunge?: [number, number, number][];
  /** Frames [from, to) during which hits don't interrupt (hyper armor). */
  hyperArmor?: [number, number];
  parryable: boolean;
  /** Two hands on the hilt (visual). */
  twoHanded?: boolean;
  /** Heavy charge: hold the button to pause at `holdAt` for up to `max` frames. */
  charge?: { holdAt: number; max: number; damageMult: number; lungeMult: number };
  /** A shove: no blade hit; the game knocks back whoever is in front at the active frames. */
  shove?: boolean;
  keys: BladeKey[];
}

export interface Pose {
  yaw: number;
  pitch: number;
  reach: number;
  twist: number;
}

export interface WeaponDef {
  /** Distance from the hand where the damaging part starts / ends. */
  hitFrom: number;
  hitTo: number;
  /** A Shardblade: kills anyone not in Shardplate in one stroke, through any guard. */
  shardblade: boolean;
}

export interface Moveset {
  light: Record<Stance, string>;
  heavy: Record<Stance, string>;
  /**
   * Optional secondary move on the shove input: the Shardbearer's Plate shove,
   * a Parshendi warrior's quick flank cut.
   */
  shove?: string;
  guard: Record<Stance, Pose>;
  block: Pose;
  weapon: WeaponDef;
  twoHandedGuard: Record<Stance, boolean>;
}

export const moves: Record<string, Move> = {
  // ---------------------------------------------------------------------------
  // Windstance: flowing, quick, wide arcs. Low commitment, chains well.
  // ---------------------------------------------------------------------------
  wind_l1: {
    id: 'wind_l1', name: 'Windstance: sweeping cut', kind: 'light',
    windup: 9, active: 7, recovery: 18,
    damage: 18, poiseDamage: 18, staminaCost: 13, guardDamage: 18, knockback: 2.2, hitStop: 4,
    chain: 'wind_l2', chainOpen: 14, dodgeCancel: 18, track: 9,
    lunge: [[5, 15, 0.7]], parryable: true,
    keys: [
      { f: 0, yaw: -35, pitch: -25, reach: 0.55 },
      { f: 6, yaw: -140, pitch: 18, reach: 0.58, twist: -55 },
      { f: 9, yaw: -125, pitch: 8, reach: 0.6, twist: -40 },
      { f: 12, yaw: -15, pitch: 0, reach: 0.68, twist: 0 },
      { f: 16, yaw: 95, pitch: -12, reach: 0.62, twist: 38 },
      { f: 21, yaw: 118, pitch: -22, reach: 0.6, twist: 52 },
      { f: 34, yaw: -35, pitch: -25, reach: 0.55 },
    ],
  },
  wind_l2: {
    id: 'wind_l2', name: 'Windstance: return cut', kind: 'light',
    windup: 7, active: 7, recovery: 18,
    damage: 18, poiseDamage: 18, staminaCost: 13, guardDamage: 18, knockback: 2.2, hitStop: 4,
    chain: 'wind_l3', chainOpen: 12, dodgeCancel: 16, track: 7,
    lunge: [[4, 13, 0.6]], parryable: true,
    keys: [
      { f: 0, yaw: 95, pitch: -12, reach: 0.62, twist: 38 },
      { f: 4, yaw: 130, pitch: 26, reach: 0.58, twist: 52 },
      { f: 7, yaw: 118, pitch: 18, reach: 0.6, twist: 42 },
      { f: 10, yaw: 10, pitch: 4, reach: 0.68, twist: 0 },
      { f: 14, yaw: -100, pitch: -18, reach: 0.62, twist: -38 },
      { f: 19, yaw: -122, pitch: -25, reach: 0.6, twist: -52 },
      { f: 32, yaw: -35, pitch: -25, reach: 0.55 },
    ],
  },
  wind_l3: {
    id: 'wind_l3', name: 'Windstance: gale arc', kind: 'light',
    windup: 13, active: 10, recovery: 24,
    damage: 26, poiseDamage: 32, staminaCost: 18, guardDamage: 26, knockback: 4.5, hitStop: 6,
    chainOpen: 99, dodgeCancel: 30, track: 12,
    lunge: [[9, 22, 1.5]], parryable: true,
    keys: [
      { f: 0, yaw: -100, pitch: -18, reach: 0.62, twist: -38 },
      { f: 9, yaw: -160, pitch: 22, reach: 0.6, twist: -78 },
      { f: 13, yaw: -150, pitch: 12, reach: 0.62, twist: -65 },
      { f: 16, yaw: -55, pitch: 2, reach: 0.72, twist: -25 },
      { f: 19, yaw: 40, pitch: -4, reach: 0.72, twist: 30 },
      { f: 23, yaw: 135, pitch: -15, reach: 0.62, twist: 65 },
      { f: 29, yaw: 150, pitch: -24, reach: 0.6, twist: 75 },
      { f: 47, yaw: -35, pitch: -25, reach: 0.55 },
    ],
  },
  wind_h: {
    id: 'wind_h', name: 'Windstance: lunging thrust', kind: 'heavy',
    windup: 16, active: 7, recovery: 26,
    damage: 34, poiseDamage: 45, staminaCost: 26, guardDamage: 40, knockback: 6, hitStop: 7,
    chainOpen: 99, dodgeCancel: 34, track: 16,
    lunge: [[15, 23, 2.6]], parryable: true, twoHanded: true,
    charge: { holdAt: 14, max: 40, damageMult: 1.8, lungeMult: 1.6 },
    keys: [
      { f: 0, yaw: -35, pitch: -25, reach: 0.55 },
      { f: 9, yaw: -40, pitch: 12, reach: 0.2, twist: -45 },
      { f: 14, yaw: -28, pitch: 6, reach: 0.12, twist: -30 },
      { f: 16, yaw: -20, pitch: 4, reach: 0.2, twist: -25 },
      { f: 20, yaw: -3, pitch: 0, reach: 0.9, twist: 8 },
      { f: 23, yaw: -2, pitch: -2, reach: 0.92, twist: 10 },
      { f: 29, yaw: 5, pitch: -6, reach: 0.9, twist: 18 },
      { f: 49, yaw: -35, pitch: -25, reach: 0.55 },
    ],
  },

  // ---------------------------------------------------------------------------
  // Stonestance: planted and powerful. Slow, two-handed, hyper armor.
  // ---------------------------------------------------------------------------
  stone_l1: {
    id: 'stone_l1', name: 'Stonestance: cleave', kind: 'light',
    windup: 16, active: 8, recovery: 24,
    damage: 30, poiseDamage: 40, staminaCost: 18, guardDamage: 32, knockback: 3.5, hitStop: 6,
    chain: 'stone_l2', chainOpen: 26, dodgeCancel: 30, track: 14,
    lunge: [[12, 22, 0.8]], hyperArmor: [8, 24], parryable: true, twoHanded: true,
    keys: [
      { f: 0, yaw: -10, pitch: 40, reach: 0.42 },
      { f: 11, yaw: -30, pitch: 140, reach: 0.5, twist: -24 },
      { f: 16, yaw: -25, pitch: 125, reach: 0.5, twist: -15 },
      { f: 20, yaw: -6, pitch: 40, reach: 0.68, twist: 0 },
      { f: 24, yaw: 15, pitch: -45, reach: 0.62, twist: 10 },
      { f: 30, yaw: 22, pitch: -62, reach: 0.6, twist: 16 },
      { f: 48, yaw: -10, pitch: 40, reach: 0.42 },
    ],
  },
  stone_l2: {
    id: 'stone_l2', name: 'Stonestance: rising cut', kind: 'light',
    windup: 12, active: 8, recovery: 28,
    damage: 26, poiseDamage: 34, staminaCost: 18, guardDamage: 28, knockback: 3.5, hitStop: 6,
    chainOpen: 99, dodgeCancel: 30, track: 12,
    lunge: [[8, 18, 0.7]], hyperArmor: [6, 20], parryable: true, twoHanded: true,
    keys: [
      { f: 0, yaw: 15, pitch: -45, reach: 0.62, twist: 10 },
      { f: 8, yaw: 36, pitch: -62, reach: 0.55, twist: 32 },
      { f: 12, yaw: 30, pitch: -55, reach: 0.55, twist: 25 },
      { f: 16, yaw: 2, pitch: 10, reach: 0.7, twist: 0 },
      { f: 20, yaw: -25, pitch: 72, reach: 0.6, twist: -15 },
      { f: 26, yaw: -30, pitch: 88, reach: 0.58, twist: -22 },
      { f: 48, yaw: -10, pitch: 40, reach: 0.42 },
    ],
  },
  stone_h: {
    id: 'stone_h', name: 'Stonestance: sundering smash', kind: 'heavy',
    windup: 26, active: 8, recovery: 34,
    damage: 50, poiseDamage: 80, staminaCost: 32, guardDamage: 75, knockback: 7, hitStop: 9,
    chainOpen: 99, dodgeCancel: 44, track: 22,
    lunge: [[20, 30, 1.0]], hyperArmor: [6, 34], parryable: false, twoHanded: true,
    charge: { holdAt: 22, max: 50, damageMult: 1.7, lungeMult: 1.3 },
    keys: [
      { f: 0, yaw: -10, pitch: 40, reach: 0.42 },
      { f: 16, yaw: -6, pitch: 160, reach: 0.55, twist: -14 },
      { f: 22, yaw: -4, pitch: 150, reach: 0.55, twist: -10 },
      { f: 26, yaw: -2, pitch: 140, reach: 0.55, twist: -8 },
      { f: 30, yaw: 0, pitch: 55, reach: 0.75, twist: 0 },
      { f: 34, yaw: 2, pitch: -55, reach: 0.72, twist: 4 },
      { f: 42, yaw: 3, pitch: -70, reach: 0.7, twist: 8 },
      { f: 68, yaw: -10, pitch: 40, reach: 0.42 },
    ],
  },

  // Shardbearer shove: a shoulder-led barge with the Blade held across the
  // body. No cut; it knocks warriors back (and off ledges). Crowd control.
  plate_shove: {
    id: 'plate_shove', name: 'Plate shove', kind: 'light', shove: true,
    windup: 9, active: 6, recovery: 22,
    damage: 0, poiseDamage: 0, staminaCost: 16, guardDamage: 0, knockback: 0, hitStop: 3,
    chainOpen: 18, dodgeCancel: 15, track: 7,
    lunge: [[3, 15, 1.3]], hyperArmor: [0, 15], parryable: false,
    keys: [
      { f: 0, yaw: -35, pitch: -25, reach: 0.55 },
      { f: 9, yaw: 30, pitch: 35, reach: 0.3, twist: 35 },
      { f: 15, yaw: 10, pitch: 30, reach: 0.4, twist: 10 },
      { f: 37, yaw: -35, pitch: -25, reach: 0.55 },
    ],
  },

  // ---------------------------------------------------------------------------
  // Parshendi warform with an axe: long, readable telegraphs.
  // ---------------------------------------------------------------------------
  axe_l1: {
    id: 'axe_l1', name: 'Axe sweep', kind: 'light',
    windup: 22, active: 8, recovery: 26,
    damage: 14, poiseDamage: 22, staminaCost: 14, guardDamage: 22, knockback: 2.5, hitStop: 5,
    chain: 'axe_l2', chainOpen: 22, dodgeCancel: 40, track: 18,
    lunge: [[16, 28, 0.9]], parryable: true,
    keys: [
      { f: 0, yaw: -20, pitch: 15, reach: 0.45 },
      { f: 22, yaw: -125, pitch: 28, reach: 0.55, twist: -40 },
      { f: 26, yaw: -25, pitch: 6, reach: 0.65, twist: -5 },
      { f: 30, yaw: 70, pitch: -10, reach: 0.58, twist: 30 },
      { f: 56, yaw: -20, pitch: 15, reach: 0.45 },
    ],
  },
  axe_l2: {
    id: 'axe_l2', name: 'Axe backhand', kind: 'light',
    windup: 16, active: 8, recovery: 30,
    damage: 14, poiseDamage: 22, staminaCost: 14, guardDamage: 22, knockback: 2.5, hitStop: 5,
    chainOpen: 99, dodgeCancel: 40, track: 12,
    lunge: [[10, 22, 0.7]], parryable: true,
    keys: [
      { f: 0, yaw: 70, pitch: -10, reach: 0.58, twist: 30 },
      { f: 16, yaw: 105, pitch: 25, reach: 0.55, twist: 40 },
      { f: 20, yaw: 15, pitch: 6, reach: 0.65, twist: 5 },
      { f: 24, yaw: -80, pitch: -12, reach: 0.58, twist: -30 },
      { f: 54, yaw: -20, pitch: 15, reach: 0.45 },
    ],
  },
  // A quick flank cut: short windup, small lunge, less damage. The partner on
  // a Shardbearer's flank uses it to punish a swing at the other partner.
  axe_flank: {
    id: 'axe_flank', name: 'Axe flank cut', kind: 'light',
    windup: 14, active: 7, recovery: 28,
    damage: 11, poiseDamage: 18, staminaCost: 12, guardDamage: 18, knockback: 2, hitStop: 4,
    chainOpen: 99, dodgeCancel: 32, track: 12,
    lunge: [[8, 20, 1.1]], parryable: true,
    keys: [
      { f: 0, yaw: -20, pitch: 15, reach: 0.45 },
      { f: 14, yaw: -110, pitch: 22, reach: 0.55, twist: -35 },
      { f: 17, yaw: -20, pitch: 5, reach: 0.68, twist: -4 },
      { f: 21, yaw: 75, pitch: -8, reach: 0.6, twist: 30 },
      { f: 49, yaw: -20, pitch: 15, reach: 0.45 },
    ],
  },
  axe_h: {
    id: 'axe_h', name: 'Axe overhead', kind: 'heavy',
    windup: 34, active: 8, recovery: 34,
    damage: 24, poiseDamage: 45, staminaCost: 24, guardDamage: 45, knockback: 4.5, hitStop: 7,
    chainOpen: 99, dodgeCancel: 60, track: 26,
    lunge: [[28, 40, 1.1]], parryable: true, twoHanded: true,
    keys: [
      { f: 0, yaw: -20, pitch: 15, reach: 0.45 },
      { f: 34, yaw: -8, pitch: 135, reach: 0.5, twist: -10 },
      { f: 38, yaw: -3, pitch: 50, reach: 0.68, twist: 0 },
      { f: 42, yaw: 2, pitch: -45, reach: 0.65, twist: 5 },
      { f: 76, yaw: -20, pitch: 15, reach: 0.45 },
    ],
  },
};

export const shardbearerMoveset: Moveset = {
  light: { wind: 'wind_l1', stone: 'stone_l1' },
  heavy: { wind: 'wind_h', stone: 'stone_h' },
  shove: 'plate_shove',
  guard: {
    wind: { yaw: -35, pitch: -25, reach: 0.55, twist: 0 },
    stone: { yaw: -10, pitch: 40, reach: 0.42, twist: 0 },
  },
  block: { yaw: 70, pitch: 28, reach: 0.42, twist: 15 },
  // Shardblade: hilt at the hand, ~1.85 m of blade.
  weapon: { hitFrom: 0.2, hitTo: 1.95, shardblade: true },
  twoHandedGuard: { wind: false, stone: true },
};

export const parshendiMoveset: Moveset = {
  light: { wind: 'axe_l1', stone: 'axe_l1' },
  heavy: { wind: 'axe_h', stone: 'axe_h' },
  shove: 'axe_flank',
  guard: {
    wind: { yaw: -20, pitch: 15, reach: 0.45, twist: 0 },
    stone: { yaw: -20, pitch: 15, reach: 0.45, twist: 0 },
  },
  block: { yaw: 65, pitch: 30, reach: 0.42, twist: 12 },
  // Axe: the head is the dangerous part.
  weapon: { hitFrom: 0.75, hitTo: 1.3, shardblade: false },
  twoHandedGuard: { wind: false, stone: false },
};

export function moveTotal(m: Move): number {
  return m.windup + m.active + m.recovery;
}
