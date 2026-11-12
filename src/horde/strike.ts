/**
 * When a warrior holding an attack token commits. Pure, so the rules of play
 * are testable with fixed inputs:
 *
 *  - Pairs punish swinging: while the Shardbearer swings at someone else
 *    (usually the partner), a warrior on his flank or behind commits at once,
 *    with the quick flank cut.
 *  - Openings: he is recovering / staggered, or turned away → commit.
 *  - A swing coming at this warrior: it may back off, but only once per
 *    cooldown; then it has to commit when its patience runs out, even into
 *    his guard.
 *  - Berserkers and volley strikers just come.
 */
export interface StrikeView {
  /** Metres to the Shardbearer. */
  dist: number;
  /** |angle| (radians) between his facing and the direction to this warrior; 0 = straight in front. */
  facingOff: number;
  /** He is winding up or mid-swing. */
  swinging: boolean;
  /** His swing is aimed at someone else (this warrior's partner, say). */
  swingingAtOther: boolean;
  /** He is recovering from a swing, staggered or in hit-stun. */
  recovering: boolean;
  /** Seconds since this warrior was ordered to strike. */
  waited: number;
  /** Feint lead: seconds before it may commit on its own initiative. */
  delay: number;
  /** Seconds after the lead before it must commit regardless. */
  patience: number;
  /** A retreat from a threatening swing is available (not on cooldown). */
  canBackOff: boolean;
  berserk: boolean;
  volley: boolean;
}

export type StrikeAction = 'hover' | 'backOff' | 'commit';

export interface StrikeChoice {
  action: StrikeAction;
  /** Use the quick flank cut (short windup) rather than the full swing. */
  quick: boolean;
}

/** Flank: far enough round his side that his swing isn't coming this way. */
export const FLANK = 1.0;
/** Turned away: an opening. */
const TURNED_AWAY = 1.3;
/** Close enough that a swing in this direction will land. */
const THREAT_RANGE = 4.4;

export function strikeDecision(v: StrikeView): StrikeChoice {
  const flank = v.facingOff > FLANK;
  if (v.berserk || v.volley) return { action: 'commit', quick: flank };
  // His swing is going somewhere else: the partner on the flank punishes it.
  if (v.swinging && v.swingingAtOther && flank) return { action: 'commit', quick: true };
  if (v.recovering) return { action: 'commit', quick: flank };
  const threatened = v.swinging && !flank && v.dist < THREAT_RANGE;
  if (threatened && v.canBackOff) return { action: 'backOff', quick: false };
  if (v.waited < v.delay) return { action: 'hover', quick: false };
  if (v.facingOff > TURNED_AWAY) return { action: 'commit', quick: true };
  if (v.waited >= v.delay + v.patience) return { action: 'commit', quick: flank };
  return { action: 'hover', quick: false };
}
