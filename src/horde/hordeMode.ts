import * as THREE from 'three';
import { tuning, type Tuning } from '../config';
import type { CombatRules, FighterEvent } from '../combat/fighter';
import { parshendiMoveset } from '../combat/moves';
import { headingOf } from '../core/math';
import type { Physics } from '../core/physics';
import { Combatant, type ControlInput } from '../entities/combatant';
import { BladeTrail } from '../fx/trail';
import { CrowdInstancer } from '../render/crowdInstancer';
import { mergeStaticMeshes } from '../render/crowdMerge';
import type { Battlefield } from '../world/battlefield';
import { killFeel, type KillFeel } from './killFeel';
import { Pair, WarriorBrain } from './pairAI';
import { hrand, hrange, seedHorde } from './rng';
import { allocateTokens } from './tokens';
import { waveSize } from './waves';

export interface HordeContext {
  physics: Physics;
  scene: THREE.Scene;
  rules: CombatRules;
  field: Battlefield;
  player: Combatant;
  movement: () => Tuning['movement'];
  /** Route a warrior's fighter events (swing sounds etc.) through the game. */
  onEvents: (c: Combatant, events: FighterEvent[]) => void;
  /** A warrior started a swing: telegraph it. */
  onTelegraph: (c: Combatant, heavy: boolean) => void;
  onWave: (wave: number, cleared: boolean) => void;
  /** A warrior went over the edge. */
  onPlummet: (c: Combatant) => void;
}

interface Climb { t: number; from: THREE.Vector3; lip: THREE.Vector3; to: THREE.Vector3; heading: number }

interface Warrior {
  c: Combatant;
  brain: WarriorBrain;
  trail: BladeTrail;
  pair: Pair<Warrior> | null;
  inUse: boolean;
  climb: Climb | null;
  /** Walk here first (bridge arrivals), then join the fight. */
  waypoint: THREE.Vector3 | null;
  far: boolean;
  lastSerial: number;
  counted: boolean;
  // Crowd instancing (see render/crowdInstancer.ts).
  root: THREE.Object3D;
  meshes: THREE.Mesh[];
  flash: number;
  show: boolean;
  /** Seconds the blade trail stays drawn after a swing. */
  trailT: number;
}

export interface HordeStats {
  wave: number;
  kills: number;
  falls: number;
  streak: number;
  bestStreak: number;
  time: number;
  /** Warriors still to come or alive this wave. */
  remaining: number;
}

const PARK = new THREE.Vector3(0, -400, 0);
const CLIMB_TIME = 1.1;
const CORPSE_TIME = 4;
const FALL_DEATH_Y = -3;

const warriorStats = () => ({ maxHp: 40, maxStamina: 60, maxPoise: 25, staminaRegen: 25, damageScale: 1, shardplate: false });

/**
 * Horde mode: waves of Parshendi warriors arrive on the assault plateau (over
 * the bridge, or climbing up out of the chasms) and fight in pairs, sharing a
 * few attack tokens so only 2–3 swing at once.
 */
export class HordeMode {
  active = false;
  /** The Shardbearer has fallen: the run is over. */
  ended = false;
  readonly stats: HordeStats = { wave: 0, kills: 0, falls: 0, streak: 0, bestStreak: 0, time: 0, remaining: 0 };
  /** Warriors in the scene (alive, climbing or corpses): hit tests, lock-on, warnings. */
  readonly foes: Combatant[] = [];
  private pool: Warrior[] = [];
  private pairs: Pair<Warrior>[] = [];
  private pending = 0;
  private spawnTimer = 0;
  private breakTimer = 0;
  private recentKills: number[] = [];
  private swingKills = new Map<number, number>();
  private pairTimer = 0;
  private volleyTimer = 0;
  /** Volleys launched this run (debug readout). */
  volleys = 0;
  private byCombatant = new Map<Combatant, Warrior>();
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere(new THREE.Vector3(), 2.2);
  /** Warriors currently allowed to swing (tokens in use), for the debug readout. */
  tokensInUse = 0;

  private crowd = new CrowdInstancer(64);

  constructor(private ctx: HordeContext) {
    ctx.scene.add(this.crowd.group);
  }

  /** Hit flash for a warrior (drawn through its instance colour). */
  flash(c: Combatant): void {
    const w = this.byCombatant.get(c);
    if (w) w.flash = 1;
  }

  // --- Run lifecycle ------------------------------------------------------------

  /** Fixed seed for repeatable runs (balance scripts, `?seed=`); null = a fresh one each run. */
  seed: number | null = null;

  start(): void {
    this.stop();
    seedHorde(this.seed ?? Math.floor(Math.random() * 2 ** 32));
    this.active = true;
    this.ended = false;
    Object.assign(this.stats, { wave: 0, kills: 0, falls: 0, streak: 0, bestStreak: 0, time: 0, remaining: 0 });
    this.recentKills.length = 0;
    this.swingKills.clear();
    this.volleyTimer = tuning.horde.volleyMin;
    this.volleys = 0;
    this.nextWave(1.5);
  }

  stop(): void {
    for (const w of this.pool) if (w.inUse) this.park(w);
    this.pairs.length = 0;
    this.foes.length = 0;
    this.pending = 0;
    this.active = false;
  }

  private nextWave(delay: number): void {
    this.stats.wave++;
    this.pending = waveSize(this.stats.wave, tuning.horde);
    this.stats.remaining = this.pending;
    this.spawnTimer = delay;
    this.breakTimer = 0;
    this.ctx.onWave(this.stats.wave, false);
  }

  // --- Simulation -----------------------------------------------------------------

  fixedUpdate(dt: number): void {
    if (!this.active) return;
    const h = tuning.horde;
    const player = this.ctx.player;
    if (player.alive) this.stats.time += dt;
    else this.ended = true;

    this.spawn(dt, h);

    // Pairs: spread their axes round the Shardbearer, then hand out tokens.
    this.pairTimer -= dt;
    if (this.pairTimer <= 0) { this.pairTimer = 0.5; this.spreadPairs(); }
    this.lastStand();
    this.volley(dt, h);
    const grant = allocateTokens(this.pairs.map((p) => ({ id: p.id, want: p.want, held: p.tokens, priority: p.priority() })), h.attackTokens);
    this.tokensInUse = 0;
    for (const p of this.pairs) {
      p.tokens = grant.get(p.id) ?? 0;
      this.tokensInUse += p.tokens;
      p.update(dt, player, h);
    }

    const think = 1 / Math.max(1, h.thinkRate);
    const dmg = h.warriorDamage * tuning.combat.enemyDamage;
    for (const w of this.pool) {
      if (!w.inUse) continue;
      const c = w.c;
      if (w.climb) { this.stepClimb(w, dt); continue; }
      c.fighter.stats.damageScale = dmg;
      if (!c.alive) {
        c.deadTime += dt;
        // Corpses stop simulating once they've settled; fallers keep falling.
        if (c.deadTime < 1.2 || !c.body.grounded) c.fixedStep(dt, IDLE);
        if (c.deadTime > CORPSE_TIME || c.position.y < -60) this.park(w);
        continue;
      }
      if (w.waypoint) {
        w.brain.slotX = w.waypoint.x; w.brain.slotZ = w.waypoint.z;
        w.brain.setOrder('hold');
        if (Math.hypot(c.position.x - w.waypoint.x, c.position.z - w.waypoint.z) < 1.5) w.waypoint = null;
      } else if (w.brain.order === 'hold' || w.brain.order === 'retreat' || (w.brain.order === 'strike' && !w.brain.attacked)) {
        this.clampSlot(w.brain);
      }
      w.brain.thinkAcc += dt;
      if (w.brain.thinkAcc >= think) {
        this.separation(w);
        w.brain.think(w.brain.thinkAcc, c, player, h);
        w.brain.thinkAcc = 0;
      }
      const intent = w.brain.steerTick(c, player);
      const ev = c.fixedStep(dt, intent);
      this.ctx.onEvents(c, ev);
      if (c.fighter.attackSerial !== w.lastSerial && c.fighter.state === 'attack' && c.fighter.move) {
        w.lastSerial = c.fighter.attackSerial;
        this.ctx.onTelegraph(c, c.fighter.move.kind === 'heavy');
      }
      if (c.position.y < FALL_DEATH_Y) {
        c.fighter.kill();
        c.body.setSolid(false);
        this.stats.falls++;
        this.ctx.onPlummet(c);
        this.registerKill(c, -1);
      }
    }

    // Wave over? Breathe, heal a little, then the next one.
    if (this.pending === 0 && this.stats.remaining === 0 && player.alive) {
      this.breakTimer += dt;
      if (this.breakTimer > 0.01 && this.breakTimer - dt <= 0.01) {
        this.ctx.onWave(this.stats.wave, true);
        const f = player.fighter;
        f.hp = Math.min(f.stats.maxHp, f.hp + f.stats.maxHp * h.healBetweenWaves);
      }
      if (this.breakTimer > h.waveBreak) this.nextWave(0.6);
    }
  }

  /**
   * A warrior died. Returns how hard the kill should hit (for a Shardblade
   * kill by the player), or null for falls.
   * @param swingSerial  the player's attackSerial, or -1 if not a swing kill
   */
  registerKill(c: Combatant, swingSerial: number): KillFeel | null {
    const w = this.byCombatant.get(c);
    if (!w || w.counted) return null;
    w.counted = true;
    const s = this.stats;
    s.kills++;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.remaining = Math.max(0, s.remaining - 1);
    const pair = w.pair;
    if (pair) this.onPartnerLost(pair);

    const now = s.time;
    while (this.recentKills.length && now - this.recentKills[0] > tuning.horde.killWindow) this.recentKills.shift();
    const recent = this.recentKills.length;
    this.recentKills.push(now);
    if (swingSerial < 0) return null;
    const n = (this.swingKills.get(swingSerial) ?? 0) + 1;
    this.swingKills.set(swingSerial, n);
    if (this.swingKills.size > 8) this.swingKills.delete(this.swingKills.keys().next().value!);
    const h = tuning.horde;
    return killFeel(recent, n, this.pending === 0 && s.remaining === 0, {
      baseStop: h.killStop, window: h.killWindow, falloff: h.killFalloff, minScale: h.killMinScale, baseShake: h.killShake,
      multiStop: h.multiKillStop, multiSlowmo: h.multiKillSlowmo, waveSlowmo: h.waveEndSlowmo, slowmoScale: h.slowmoScale,
    });
  }

  /** The Shardbearer took a hit: the streak resets. */
  onPlayerHit(): void { this.stats.streak = 0; }

  private onPartnerLost(pair: Pair<Warrior>): void {
    const res = pair.onMemberDied(tuning.horde);
    if (res !== 'regroup') { if (!pair.alive.length) this.removePair(pair); return; }
    // The survivor seeks out another lone warrior, or tags onto a pair.
    const lone = pair.alive[0];
    const me = lone.c.position;
    let best: Pair<Warrior> | null = null, bestD = Infinity;
    for (const p of this.pairs) {
      if (p === pair) continue;
      const alive = p.alive;
      if (!alive.length || alive.length >= 3 || p.berserk) continue;
      const d = alive[0].c.position.distanceTo(me) + (alive.length === 1 ? 0 : 8);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return;
    pair.members = pair.members.filter((m) => m !== lone);
    best.members = best.members.filter((m) => m.c.alive);
    best.members.push(lone);
    lone.pair = best;
    lone.brain.berserk = false;
    best.regroup();
    this.removePair(pair);
  }

  private removePair(p: Pair<Warrior>): void {
    const i = this.pairs.indexOf(p);
    if (i >= 0) this.pairs.splice(i, 1);
  }

  /**
   * Keep pairs on separate sides of the Shardbearer, in rings: the nearest
   * few pairs wait on the inner ring, the rest further out. Within a ring,
   * pairs keep their order round the Shardbearer and spread out evenly.
   */
  private spreadPairs(): void {
    const pl = this.ctx.player.position;
    const per = Math.max(1, tuning.horde.pairsPerRing);
    const live = this.pairs.filter((p) => p.alive.length).map((p) => {
      let x = 0, z = 0;
      for (const m of p.alive) { x += m.c.position.x; z += m.c.position.z; }
      x = x / p.alive.length - pl.x; z = z / p.alive.length - pl.z;
      return { p, b: Math.atan2(z, x), d: Math.hypot(x, z) - (p.phase === 'engage' ? 100 : 0) };
    }).sort((a, b) => a.d - b.d);
    for (let r = 0; r * per < live.length; r++) {
      const ring = live.slice(r * per, (r + 1) * per).sort((a, b) => a.b - b.b);
      const step = (Math.PI * 2) / ring.length;
      ring.forEach(({ p, b }, i) => {
        p.ring = r;
        const target = ring[0].b + i * step + (r % 2) * step * 0.5;
        const d = Math.atan2(Math.sin(target - p.axis), Math.cos(target - p.axis));
        p.axis += d * 0.35;
        if (i === 0 && Math.abs(b - p.axis) > Math.PI) p.axis = b; // fresh arrivals
      });
    }
  }

  /** The wave's last two warriors stop waiting their turn and charge. */
  private lastStand(): void {
    if (this.pending > 0 || this.stats.remaining > 2) return;
    for (const p of this.pairs) if (p.alive.length && !p.berserk) p.goBerserk();
  }

  /**
   * Synchronised volleys: every few seconds, two waiting pairs on opposite
   * sides of the Shardbearer commit on the same beat (one token each), so
   * dodging out of the pincer and the shove matter.
   */
  private volley(dt: number, h: Tuning['horde']): void {
    this.volleyTimer -= dt;
    const player = this.ctx.player;
    if (this.volleyTimer > 0 || !player.alive) return;
    this.volleyTimer = hrange(h.volleyMin, Math.max(h.volleyMin, h.volleyMax));
    const held = this.pairs.reduce((n, p) => n + p.tokens, 0);
    if (h.attackTokens - held < 2) return;
    const pl = player.position;
    const ready = this.pairs.filter((p) => p.canVolley()).map((p) => {
      const m = p.alive[0].c.position;
      return { p, b: Math.atan2(m.z - pl.z, m.x - pl.x), d: Math.hypot(m.x - pl.x, m.z - pl.z) };
    }).filter((r) => r.d < 12);
    if (ready.length < 2) return;
    ready.sort((a, b) => b.p.priority() - a.p.priority());
    const a = ready[0];
    let best = null as typeof a | null, bestSep = (100 * Math.PI) / 180;
    for (const r of ready.slice(1)) {
      const sep = Math.abs(Math.atan2(Math.sin(r.b - a.b), Math.cos(r.b - a.b)));
      if (sep >= bestSep) { bestSep = sep; best = r; }
    }
    if (!best) return;
    a.p.startVolley(player, h);
    best.p.startVolley(player, h);
    this.volleys++;
  }

  /** Keep slots on solid ground: pull them in from the rim and out of rocks. */
  private clampSlot(b: WarriorBrain): void {
    const main = this.ctx.field.main;
    const cx = main.center.x, cz = main.center.z;
    const dx = b.slotX - cx, dz = b.slotZ - cz;
    const d = Math.hypot(dx, dz);
    const rim = main.radiusAtPolar(Math.atan2(dz, dx)) - 2.2;
    if (d > rim) { b.slotX = cx + (dx / d) * rim; b.slotZ = cz + (dz / d) * rim; }
  }

  /** Spread out from neighbours, and shy away from the rim. */
  private separation(w: Warrior): void {
    const p = w.c.position;
    let sx = 0, sz = 0;
    for (const o of this.pool) {
      if (o === w || !o.inUse || !o.c.alive || o.climb) continue;
      const dx = p.x - o.c.position.x, dz = p.z - o.c.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 2.6 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const k = (1.6 - d) / 1.6;
      sx += (dx / d) * k; sz += (dz / d) * k;
    }
    const main = this.ctx.field.main;
    const cx = p.x - main.center.x, cz = p.z - main.center.z;
    const r = Math.hypot(cx, cz);
    const rim = main.radiusAtPolar(Math.atan2(cz, cx));
    if (r > rim - 2.5 && r > 1e-3) { const k = (r - (rim - 2.5)) * 1.2; sx -= (cx / r) * k; sz -= (cz / r) * k; }
    w.brain.sepX = sx * 1.3; w.brain.sepZ = sz * 1.3;
  }

  // --- Arrivals ---------------------------------------------------------------------

  private spawn(dt: number, h: Tuning['horde']): void {
    if (this.pending <= 0 || !this.ctx.player.alive) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const alive = this.pool.reduce((n, w) => n + (w.inUse && w.c.alive ? 1 : 0), 0);
    if (alive + 2 > h.maxAlive) { this.spawnTimer = 0.3; return; }
    this.spawnTimer = h.spawnInterval;
    const count = Math.min(2, this.pending);
    this.pending -= count;
    const pair = new Pair<Warrior>();
    const pl = this.ctx.player.position;
    const f = this.ctx.field;
    // A third come over the bridge (unless you're standing on it); the rest
    // climb up out of the chasms.
    const bridge = hrand() < 0.3 && pl.distanceTo(f.bridgeNear) > 10;
    const rimAngle = bridge ? 0 : this.pickRimAngle();
    for (let i = 0; i < count; i++) {
      const w = this.take();
      w.pair = pair;
      pair.members.push(w);
      if (bridge) {
        const at = f.bridgeFar.clone();
        at.x += (i - 0.5) * 1.1; at.z -= i * 1.4;
        this.activate(w, at, 0);
        w.waypoint = f.bridgeNear.clone().setX((i - 0.5) * 1.6);
      } else {
        this.startClimb(w, rimAngle + (i - 0.5) * (2.4 / 44));
      }
    }
    pair.axis = Math.atan2(pair.members[0].c.position.z - pl.z, pair.members[0].c.position.x - pl.x);
    this.pairs.push(pair);
  }

  /** A rim bearing well away from the player, the bridge and any rocks. */
  private pickRimAngle(): number {
    const f = this.ctx.field, main = f.main, pl = this.ctx.player.position;
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = hrand() * Math.PI * 2;
      const r = main.radiusAtPolar(a) - 1.6;
      const x = main.center.x + Math.cos(a) * r, z = main.center.z + Math.sin(a) * r;
      if (Math.abs(x - f.bridgeNear.x) < 5 && Math.abs(z - f.bridgeNear.z) < 6) continue;
      if (f.rocks.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + 1.2)) continue;
      const d = Math.hypot(x - pl.x, z - pl.z);
      // Far enough to see them coming, close enough to matter.
      const score = -Math.abs(d - 20) + hrand() * 4;
      if (d > 11 && score > bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  private startClimb(w: Warrior, a: number): void {
    const main = this.ctx.field.main;
    const r = main.radiusAtPolar(a);
    const ox = Math.cos(a), oz = Math.sin(a);
    const at = (rr: number, y: number) => new THREE.Vector3(main.center.x + ox * rr, y, main.center.z + oz * rr);
    const heading = headingOf(-ox, -oz); // face inward
    w.climb = { t: 0, from: at(r + 0.5, -2.6), lip: at(r + 0.35, 0.05), to: at(r - 1.4, 0), heading };
    this.activate(w, w.climb.from, heading);
    w.c.body.setSolid(false);
  }

  private stepClimb(w: Warrior, dt: number): void {
    const cl = w.climb!;
    cl.t += dt;
    const k = Math.min(1, cl.t / CLIMB_TIME);
    // Haul up over the lip (first 70%), then step onto the plateau.
    const p = _p;
    if (k < 0.7) {
      const u = k / 0.7;
      p.lerpVectors(cl.from, cl.lip, 1 - (1 - u) * (1 - u));
    } else p.lerpVectors(cl.lip, cl.to, (k - 0.7) / 0.3);
    w.c.body.slideTo(p);
    if (k >= 1) {
      w.climb = null;
      w.c.body.setSolid(true);
    }
  }

  private take(): Warrior {
    let w = this.pool.find((x) => !x.inUse);
    if (!w) {
      const c = new Combatant(this.ctx.physics, {
        name: 'Parshendi Warrior', team: 'parshendi', kind: 'parshendi', scale: 0.94,
        spawn: PARK, heading: 0,
        stats: warriorStats(), moveset: parshendiMoveset, rules: this.ctx.rules,
        movement: this.ctx.movement, gravity: () => tuning.movement.gravity,
      });
      mergeStaticMeshes(c.model.root);
      w = {
        c, brain: new WarriorBrain(), trail: new BladeTrail(new THREE.Color('#5a4030'), 0.12), pair: null, inUse: false,
        climb: null, waypoint: null, far: false, lastSerial: 0, counted: false,
        root: c.model.root, meshes: this.crowd.register(c.model.root), flash: 0, show: false, trailT: 0,
      };
      this.ctx.scene.add(c.model.root, w.trail.mesh);
      this.pool.push(w);
      this.byCombatant.set(c, w);
    }
    return w;
  }

  private activate(w: Warrior, at: THREE.Vector3, heading: number): void {
    w.inUse = true;
    w.counted = false;
    w.waypoint = null;
    w.brain.reset();
    w.c.respawn(at, heading);
    w.lastSerial = w.c.fighter.attackSerial;
    w.c.model.root.visible = true;
    w.trail.clear();
    w.trail.mesh.visible = false;
    w.show = true;
    w.flash = 0;
    if (!this.foes.includes(w.c)) this.foes.push(w.c);
  }

  private park(w: Warrior): void {
    w.inUse = false;
    w.climb = null;
    w.pair = null;
    w.c.body.setSolid(false);
    w.c.body.teleport(PARK);
    w.c.model.root.visible = false;
    w.trail.mesh.visible = false;
    w.show = false;
    const i = this.foes.indexOf(w.c);
    if (i >= 0) this.foes.splice(i, 1);
  }

  // --- Rendering ------------------------------------------------------------------------

  /**
   * Animate warriors and hand their part matrices to the crowd instancer.
   * Off-screen ones skip their (IK-heavy) animation; distant ones animate
   * every other frame.
   */
  render(dt: number, alpha: number, movement: Tuning['movement'], camera: THREE.Camera, updateTrail: (t: BladeTrail, c: Combatant, dt: number) => void): void {
    if (!this.active) { this.crowd.update(this.pool); return; }
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const pl = this.ctx.player.position;
    const lod2 = tuning.horde.lodDistance ** 2;
    frameParity = !frameParity;
    let i = 0;
    for (const w of this.pool) {
      if (!w.inUse) continue;
      i++;
      const c = w.c;
      w.far = c.position.distanceToSquared(pl) > lod2;
      this.sphere.center.copy(c.position).setY(c.position.y + 1);
      const visible = this.frustum.intersectsSphere(this.sphere);
      const settled = !c.alive && c.deadTime > 1.3;
      const animate = visible && !settled && (!w.far || ((i & 1) === 0) === frameParity);
      c.render(dt, alpha, movement, animate);
      // Final world matrices for the instancer (the IK leaves forearms stale).
      if (!settled || w.flash > 0) c.model.root.updateMatrixWorld(true);
      w.flash = Math.max(0, w.flash - dt * 7);
      // Trails only while swinging (each one is a draw call).
      const swinging = c.alive && c.fighter.state === 'attack';
      w.trailT = swinging ? 0.3 : Math.max(0, w.trailT - dt);
      w.trail.mesh.visible = w.trailT > 0;
      if (w.trail.mesh.visible) updateTrail(w.trail, c, dt);
    }
    this.crowd.update(this.pool);
  }

  /** Counts for the debug readout. */
  counts(): { alive: number; pairs: number; pool: number } {
    let alive = 0;
    for (const w of this.pool) if (w.inUse && w.c.alive) alive++;
    return { alive, pairs: this.pairs.length, pool: this.pool.length };
  }
}

let frameParity = false;
const _p = new THREE.Vector3();
const IDLE: ControlInput = { light: false, heavy: false, heavyHeld: false, dodge: false, block: false, switchStance: false, moveX: 0, moveY: 0, sprint: false, walk: false, cameraYaw: 0, targetHeading: null };
