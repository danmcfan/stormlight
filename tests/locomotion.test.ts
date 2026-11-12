import { describe, expect, it } from 'vitest';
import { createLocoState, inputToWorld, planarSpeed, stepLocomotion, type LocoInput } from '../src/player/locomotion';
import { defaultTuning } from '../src/config';

const m = defaultTuning.movement;
const dt = 1 / 60;
const base: LocoInput = { moveX: 0, moveY: 0, sprint: false, walk: false, cameraYaw: 0, lockHeading: null };

function run(input: LocoInput, steps: number, s = createLocoState()) {
  for (let i = 0; i < steps; i++) s = stepLocomotion(s, input, m, dt);
  return s;
}

describe('inputToWorld', () => {
  it('W with camera yaw 0 points +Z, D points to camera right (-X)', () => {
    const f = inputToWorld(0, 1, 0);
    expect(f.x).toBeCloseTo(0); expect(f.z).toBeCloseTo(1);
    const r = inputToWorld(1, 0, 0);
    expect(r.x).toBeCloseTo(-1); expect(r.z).toBeCloseTo(0);
  });
});

describe('free locomotion', () => {
  it('ramps up to jog speed rather than snapping', () => {
    const s1 = run({ ...base, moveY: 1 }, 1);
    expect(planarSpeed(s1)).toBeLessThan(0.5);
    const s2 = run({ ...base, moveY: 1 }, 120);
    expect(planarSpeed(s2)).toBeCloseTo(m.jogSpeed, 1);
  });

  it('sprint is faster than jog', () => {
    expect(planarSpeed(run({ ...base, moveY: 1, sprint: true }, 180))).toBeCloseTo(m.sprintSpeed, 1);
  });

  it('a 180° reversal at sprint plants (slows hard) before driving off', () => {
    let s = run({ ...base, moveY: 1, sprint: true }, 180);
    let minSpeed = Infinity;
    for (let i = 0; i < 300; i++) {
      s = stepLocomotion(s, { ...base, moveY: -1, sprint: true }, m, dt);
      minSpeed = Math.min(minSpeed, planarSpeed(s));
    }
    expect(minSpeed).toBeLessThan(m.sprintSpeed * 0.25);
    expect(s.vz).toBeLessThan(-m.sprintSpeed * 0.95);
  });

  it('coasts to a stop with no input', () => {
    const moving = run({ ...base, moveY: 1 }, 120);
    expect(planarSpeed(run(base, 120, moving))).toBe(0);
  });
});

describe('locked locomotion', () => {
  it('faces the target while strafing sideways', () => {
    const s = run({ ...base, moveX: 1, lockHeading: 0 }, 120, createLocoState(1.5));
    expect(s.facing).toBeCloseTo(0, 3);
    expect(s.vx).toBeCloseTo(-m.strafeSpeed, 1);
    expect(s.vz).toBeCloseTo(0, 3);
  });

  it('sprinting while locked runs freely toward the input', () => {
    const s = run({ ...base, moveX: 1, sprint: true, lockHeading: 0 }, 240);
    expect(s.facing).toBeCloseTo(-Math.PI / 2, 2);
  });
});
