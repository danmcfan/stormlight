/**
 * Every number that affects game feel lives here so it can be tuned live
 * from the debug panel (press `). Use "Copy tuning JSON" to save a good set.
 */
export const tuning = {
  movement: {
    walkSpeed: 2.2,
    jogSpeed: 5.4,
    sprintSpeed: 9.0,
    strafeSpeed: 3.8,
    /** m/s² when speeding up — low values make Plate feel heavy. */
    accel: 13,
    /** m/s² when slowing down. */
    decel: 18,
    /** rad/s the body can turn while jogging. */
    turnRateJog: 8.5,
    /** rad/s while sprinting — a Shardbearer at full tilt can't corner. */
    turnRateSprint: 3.2,
    /** rad/s turning to face a locked target. */
    turnRateLocked: 9,
    /** How hard sharp turns bleed speed (higher = heavier). */
    turnSpeedPenalty: 2,
    /** Extra braking when reversing direction (>90°): plant, pivot, drive off. */
    pivotBrake: 2.5,
    gravity: 28,
  },
  camera: {
    distance: 5.2,
    minDistance: 2.6,
    maxDistance: 10,
    pivotHeight: 1.75,
    shoulderOffset: 0.55,
    sensitivity: 0.0022,
    pivotDamping: 16,
    fov: 62,
    /** How fast the camera swings round to frame a locked target. */
    lockYawDamping: 7,
    lockPitch: 0.26,
    /** Camera kick on heavy sprint footfalls. */
    footfallShake: 0.035,
  },
  combat: {
    /** Multiplies every move's freeze-on-impact frames. */
    hitStopScale: 1,
    shakeScale: 1,
    knockbackScale: 1,
    /** Frames after raising the guard that count as a parry. */
    parryWindow: 9,
    playerDamage: 1,
    enemyDamage: 1,
    showHitboxes: false,
    volume: 0.7,
  },
  ai: {
    aggression: 0.55,
    blockChance: 0.35,
    dodgeChance: 0.12,
    /** Seconds before the duelist reacts to your windup. */
    reaction: 0.22,
    /** When it blocks, chance the block is a parry. */
    parryChance: 0.2,
  },
  lockOn: {
    range: 24,
    breakRange: 32,
    /** Mouse pixels of sideways flick needed to change target. */
    switchThreshold: 55,
    switchCooldown: 0.3,
  },
  horde: {
    /** Warriors in wave 1, added per wave, and the cap (all rounded to pairs). */
    waveStart: 4,
    waveGrowth: 6,
    waveMax: 38,
    /** Most warriors on the plateau at once; the rest of a wave waits to arrive. */
    maxAlive: 40,
    /** Seconds between each arriving pair. */
    spawnInterval: 0.9,
    /** Breather between waves (seconds). */
    waveBreak: 5,
    /** Fraction of max health restored between waves. */
    healBetweenWaves: 0.35,
    /** Warrior hit damage × (on top of the enemy damage × above). */
    warriorDamage: 1,
    /** Attack tokens: how many warriors may swing at you at once. */
    attackTokens: 3,
    /** Seconds a pair rests after using its tokens before asking again. */
    tokenCooldown: 1.6,
    /** Radius the waiting warriors circle at, and how close they shuffle in. */
    holdRadius: 6.5,
    closeRadius: 4.6,
    /** Degrees either side of a pair's axis each partner flanks from. */
    flankAngle: 55,
    /** Seconds between the feint and the partner's committed strike. */
    feintLead: 0.35,
    /** Chance a warrior whose partner dies turns berserk (else regroups). */
    berserkChance: 0.5,
    /** Chance a warrior steps back from your windup when close. */
    fearDodge: 0.12,
    /** AI decisions run this many times a second per warrior (staggered). */
    thinkRate: 12,
    /** Warriors further than this skip blade/animation work on alternate frames. */
    lodDistance: 22,
    /** Aim assist when not locked on: cone half-angle (°), range (m). */
    aimAssist: true,
    aimCone: 55,
    aimRange: 5,
    /** Shove (R / Shove button): speed given to warriors hit (m/s) and how slowly it decays. */
    shoveForce: 15,
    shoveDecay: 3.2,
    shoveRange: 2.6,
    shoveCone: 70,
    /** Kill feel in a crowd. */
    killStop: 11,
    killWindow: 1.2,
    killFalloff: 0.8,
    killMinScale: 0.15,
    killShake: 0.09,
    multiKillStop: 6,
    multiKillSlowmo: 0.45,
    waveEndSlowmo: 1.1,
    slowmoScale: 0.3,
    /** Off-screen warning: warriors winding up within this range. */
    warnRange: 9,
  },
  touch: {
    /** Radians of camera turn per CSS pixel of look drag (separate from mouse). */
    lookSensitivity: 0.0062,
    /** Vertical look relative to horizontal. */
    pitchScale: 0.75,
    /** Joystick throw in CSS pixels for a full push. */
    stickRadius: 58,
    /** Push past this fraction of the ring to sprint. */
    sprintPush: 1.3,
  },
};

export type Tuning = typeof tuning;
export const defaultTuning: Tuning = structuredClone(tuning);
