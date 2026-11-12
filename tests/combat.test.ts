import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dirFromAngles, movePose } from '../src/combat/bladePose';
import { Fighter, noIntent, type Intent } from '../src/combat/fighter';
import { segmentDistance, sweptBladeHits } from '../src/combat/hits';
import { moves, moveTotal, parshendiMoveset, shardbearerMoveset } from '../src/combat/moves';

const stats = { maxHp: 100, maxStamina: 100, maxPoise: 50, staminaRegen: 40, damageScale: 1 };
const make = () => new Fighter(stats, shardbearerMoveset);
const press = (p: Partial<Intent>): Intent => ({ ...noIntent, ...p });
function run(f: Fighter, n: number, i: Intent = noIntent) { for (let k = 0; k < n; k++) f.tick(i); }

describe('move data', () => {
  for (const m of Object.values(moves)) {
    it(`${m.id}: keys span the whole move and never jump more than 170°`, () => {
      expect(m.keys[0].f).toBe(0);
      expect(m.keys[m.keys.length - 1].f).toBe(moveTotal(m));
      for (let i = 1; i < m.keys.length; i++) {
        const a = dirFromAngles(m.keys[i - 1].yaw, m.keys[i - 1].pitch);
        const b = dirFromAngles(m.keys[i].yaw, m.keys[i].pitch);
        expect(THREE.MathUtils.radToDeg(a.angleTo(b))).toBeLessThan(170);
        expect(m.keys[i].f).toBeGreaterThan(m.keys[i - 1].f);
      }
    });
  }
  it('every move starts and ends in its stance guard', () => {
    const g = shardbearerMoveset.guard.wind;
    const p = movePose(moves.wind_l1, 0);
    expect(p.dir.angleTo(dirFromAngles(g.yaw, g.pitch))).toBeLessThan(1e-6);
    const axe = parshendiMoveset.guard.wind;
    expect(movePose(moves.axe_l1, moveTotal(moves.axe_l1)).dir.angleTo(dirFromAngles(axe.yaw, axe.pitch))).toBeLessThan(1e-6);
  });
  it('a horizontal slash sweeps from the right to the left side', () => {
    const start = movePose(moves.wind_l1, moves.wind_l1.windup).dir.x;
    const end = movePose(moves.wind_l1, moves.wind_l1.windup + moves.wind_l1.active).dir.x;
    expect(start).toBeLessThan(-0.5); // right is -X in body space
    expect(end).toBeGreaterThan(0.5);
  });
});

describe('hit geometry', () => {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  it('segment distance', () => {
    expect(segmentDistance(v(-1, 0, 0), v(1, 0, 0), v(0, -1, 2), v(0, 1, 2))).toBeCloseTo(2);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(3, 0, 0), v(4, 0, 0))).toBeCloseTo(2);
  });
  it('a fast swing crossing a capsule between frames still hits', () => {
    const cap = { bottom: v(0, 0, 2), top: v(0, 2, 2), radius: 0.3 };
    const contact = new THREE.Vector3();
    // Blade jumps from fully left to fully right of the target in one tick.
    expect(sweptBladeHits(v(2, 1, 0), v(2, 1, 3), v(-2, 1, 0), v(-2, 1, 3), cap, 4, contact)).toBe(true);
    expect(sweptBladeHits(v(2, 1, 0), v(2, 1, 3), v(1, 1, 0), v(1, 1, 3), cap, 4, contact)).toBe(false);
  });
});

describe('fighter', () => {
  it('light attack runs windup → active → recovery → free', () => {
    const f = make();
    f.tick(press({ light: true }));
    expect(f.state).toBe('attack');
    expect(f.move!.id).toBe('wind_l1');
    run(f, moves.wind_l1.windup - 1);
    expect(f.isActive()).toBe(false);
    f.tick(noIntent);
    expect(f.isActive()).toBe(true);
    run(f, moveTotal(moves.wind_l1));
    expect(f.state).toBe('free');
  });

  it('a buffered light chains into the next combo move, but not before chainOpen', () => {
    const f = make();
    f.tick(press({ light: true }));
    run(f, 3);
    f.tick(press({ light: true })); // early press is buffered
    expect(f.move!.id).toBe('wind_l1');
    run(f, moves.wind_l1.chainOpen);
    expect(f.move!.id).toBe('wind_l2');
  });

  it('an input pressed too early expires from the buffer', () => {
    const f = make();
    f.stance = 'stone';
    f.tick(press({ light: true }));
    f.tick(press({ light: true })); // frame 1; chainOpen is 26, buffer only 14 frames
    run(f, moveTotal(moves.stone_l1));
    expect(f.state).toBe('free');
  });

  it('heavy charge holds the swing until release', () => {
    const f = make();
    const h = moves.wind_h;
    f.tick(press({ heavy: true, heavyHeld: true }));
    run(f, h.charge!.holdAt + 20, press({ heavyHeld: true }));
    expect(f.frame).toBe(h.charge!.holdAt);
    expect(f.chargeFrac()).toBeGreaterThan(0.4);
    f.tick(noIntent);
    expect(f.frame).toBe(h.charge!.holdAt + 1);
  });

  it('stamina is spent and regenerates after a delay', () => {
    const f = make();
    f.tick(press({ light: true }));
    expect(f.stamina).toBe(100 - moves.wind_l1.staminaCost);
    run(f, 200);
    expect(f.stamina).toBe(100);
  });

  it('cannot attack with no stamina left', () => {
    const f = make();
    f.stamina = 0;
    f.tick(press({ light: true }));
    expect(f.state).toBe('free');
  });

  it('dodge has invulnerability frames', () => {
    const att = make(), def = make();
    def.tick(press({ dodge: true }));
    run(def, 4);
    expect(def.invulnerable()).toBe(true);
    expect(def.receiveHit(att, moves.wind_l1, 0)).toBe('ignored');
  });

  it('a block raised just in time parries and staggers the attacker', () => {
    const att = make(), def = make();
    att.tick(press({ light: true }));
    def.tick(press({ block: true }));
    expect(def.receiveHit(att, moves.wind_l1, 0)).toBe('parry');
    expect(att.state).toBe('parried');
  });

  it('a held block absorbs with stamina; running out breaks the guard', () => {
    const att = make(), def = make();
    def.tick(press({ block: true }));
    run(def, 20, press({ block: true }));
    expect(def.receiveHit(att, moves.wind_l1, 0)).toBe('block');
    expect(def.stamina).toBeLessThan(100);
    def.stamina = 5;
    run(def, 20, press({ block: true }));
    def.stamina = 5;
    expect(def.receiveHit(att, moves.wind_l1, 0)).toBe('guardBreak');
    expect(def.state).toBe('stagger');
  });

  it('a block from behind does nothing', () => {
    const att = make(), def = make();
    def.tick(press({ block: true }));
    run(def, 20, press({ block: true }));
    expect(def.receiveHit(att, moves.wind_l1, Math.PI)).toBe('hit');
  });

  it('enough poise damage staggers; hyper armor ignores hitstun', () => {
    const att = make(), def = make();
    expect(def.receiveHit(att, moves.wind_l1, 0)).toBe('hit');
    expect(def.state).toBe('hitstun');
    def.reset();
    def.receiveHit(att, moves.stone_h, 0);
    expect(def.state).toBe('stagger');

    const armored = make();
    armored.stance = 'stone';
    armored.tick(press({ light: true }));
    run(armored, 10);
    expect(armored.hyperArmor()).toBe(true);
    armored.receiveHit(att, moves.wind_l1, 0);
    expect(armored.state).toBe('attack');
  });

  it('dies at zero health', () => {
    const att = make(), def = make();
    def.hp = 5;
    expect(def.receiveHit(att, moves.wind_l1, 0)).toBe('kill');
    expect(def.alive).toBe(false);
  });

  it('switches stance', () => {
    const f = make();
    f.tick(press({ switchStance: true }));
    run(f, 20);
    expect(f.stance).toBe('stone');
    f.tick(press({ light: true }));
    expect(f.move!.id).toBe('stone_l1');
  });

  it('dodge root motion covers the dodge distance', () => {
    const f = make();
    f.tick(press({ dodge: true }));
    let dist = 0;
    for (let i = 0; i < 40; i++) { dist += f.rootSpeed() / 60; f.tick(noIntent); }
    expect(dist).toBeCloseTo(f.rules.dodgeDistance, 0);
  });
});
