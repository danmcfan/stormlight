import { describe, expect, it } from 'vitest';
import { selectTarget, switchTarget, type LockCandidate } from '../src/combat/lockOn';

// Camera yaw 0 looks along +Z; screen-right is -X.
const ahead: LockCandidate = { id: 1, x: 0, z: 10 };
const right: LockCandidate = { id: 2, x: -6, z: 10 };
const farRight: LockCandidate = { id: 3, x: -12, z: 6 };
const left: LockCandidate = { id: 4, x: 6, z: 10 };
const behind: LockCandidate = { id: 5, x: 0, z: -5 };
const all = [ahead, right, farRight, left, behind];

describe('selectTarget', () => {
  it('prefers the target in the centre of view', () => {
    expect(selectTarget(0, 0, 0, all, 24)?.id).toBe(1);
  });
  it('ignores targets behind the camera and out of range', () => {
    expect(selectTarget(0, 0, 0, [behind], 24)).toBeNull();
    expect(selectTarget(0, 0, 0, [{ id: 9, x: 0, z: 40 }], 24)).toBeNull();
  });
});

describe('switchTarget', () => {
  it('steps right, then further right, then stays at the edge', () => {
    const a = switchTarget(0, 0, 0, ahead, all, 24, 1);
    expect(a.id).toBe(2);
    const b = switchTarget(0, 0, 0, a, all, 24, 1);
    expect(b.id).toBe(3);
    const c = switchTarget(0, 0, 0, b, all, 24, 1);
    expect(c.id).toBe(3); // nothing further right: keep the current target
  });
  it('steps left', () => {
    expect(switchTarget(0, 0, 0, ahead, all, 24, -1).id).toBe(4);
  });
});
