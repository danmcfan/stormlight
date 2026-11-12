import { describe, expect, it } from 'vitest';
import { angleDiff, approachAngle, wrapAngle } from '../src/core/math';

describe('angles', () => {
  it('wraps into (-PI, PI]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(2 * Math.PI + 0.1)).toBeCloseTo(0.1);
  });

  it('takes the short way round', () => {
    expect(angleDiff(-3, 3)).toBeCloseTo(2 * Math.PI - 6);
    expect(approachAngle(3, -3, 0.1)).toBeCloseTo(3.1);
  });

  it('snaps when within reach', () => {
    expect(approachAngle(0, 0.05, 0.1)).toBeCloseTo(0.05);
  });
});
