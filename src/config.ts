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
  lockOn: {
    range: 24,
    breakRange: 32,
    /** Mouse pixels of sideways flick needed to change target. */
    switchThreshold: 55,
    switchCooldown: 0.3,
  },
};

export type Tuning = typeof tuning;
export const defaultTuning: Tuning = structuredClone(tuning);
