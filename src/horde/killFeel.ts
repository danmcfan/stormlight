/**
 * How hard a kill hits: hit-stop frames, camera shake and slow motion.
 *
 * One kill alone gets the full duel freeze. Rapid kills in a crowd scale the
 * freeze and shake down so mowing through a horde never stutters; a multi-kill
 * in one swing, or the last kill of a wave, earns a bigger moment instead.
 */
export interface KillFeelParams {
  /** Hit-stop frames for a lone kill (the duel's move.hitStop + 5 is ~11). */
  baseStop: number;
  /** Seconds a kill counts as "recent" for the crowd scaling. */
  window: number;
  /** Each recent kill divides the freeze by (1 + falloff × n). */
  falloff: number;
  /** The freeze never drops below this fraction. */
  minScale: number;
  baseShake: number;
  /** Extra hit-stop frames for the second+ kill of one swing. */
  multiStop: number;
  /** Slow-mo for a multi-kill: duration (real seconds) and time scale. */
  multiSlowmo: number;
  /** Slow-mo for the last kill of a wave. */
  waveSlowmo: number;
  slowmoScale: number;
}

export interface KillFeel {
  hitStop: number;
  shake: number;
  /** Real seconds of slow motion (0 = none). */
  slowmo: number;
  slowmoScale: number;
}

/**
 * @param recentKills  kills in the last `window` seconds before this one
 * @param swingKills   kills this swing has made, including this one
 * @param lastOfWave   this kill ends the wave
 */
export function killFeel(recentKills: number, swingKills: number, lastOfWave: boolean, p: KillFeelParams): KillFeel {
  const scale = Math.max(p.minScale, 1 / (1 + p.falloff * Math.max(0, recentKills)));
  let hitStop = p.baseStop * scale;
  let shake = p.baseShake * (0.5 + 0.5 * scale);
  let slowmo = 0;
  if (swingKills >= 2) {
    // Only the second kill of a swing triggers the moment; later ones ride it.
    if (swingKills === 2) { hitStop = Math.max(hitStop, p.baseStop + p.multiStop); slowmo = p.multiSlowmo; }
    else hitStop = Math.min(hitStop, 2);
    shake = p.baseShake * 1.4;
  }
  if (lastOfWave) {
    hitStop = Math.max(hitStop, p.baseStop + p.multiStop);
    slowmo = Math.max(slowmo, p.waveSlowmo);
    shake = p.baseShake * 1.6;
  }
  return { hitStop: Math.round(hitStop), shake, slowmo, slowmoScale: slowmo > 0 ? p.slowmoScale : 1 };
}
