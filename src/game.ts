import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { tuning } from './config';
import { ThirdPersonCamera } from './camera/thirdPersonCamera';
import { DEFAULT_RULES, noIntent, type CombatRules, type FighterEvent, type HitOutcome } from './combat/fighter';
import { sweptBladeHits, type Capsule } from './combat/hits';
import { LockOnSystem } from './combat/lockOnSystem';
import { parshendiMoveset, shardbearerMoveset, type Move } from './combat/moves';
import { isTouchFirst } from './core/device';
import { Input } from './core/input';
import { angleDiff, headingOf } from './core/math';
import { Physics } from './core/physics';
import { DebugTools } from './debug/debugTools';
import { HitboxView } from './debug/hitboxView';
import { PerfMonitor } from './debug/perfMonitor';
import { Combatant, type ControlInput } from './entities/combatant';
import { DuelAI } from './entities/duelAI';
import { EyeBurn } from './fx/eyeBurn';
import { Sfx } from './fx/sfx';
import { chooseAimTarget } from './horde/aimAssist';
import { HordeMode } from './horde/hordeMode';
import { inputToWorld } from './player/locomotion';
import { AttackWarnings } from './ui/attackWarnings';
import { HordeHud } from './ui/hordeHud';
import { Sparks } from './fx/sparks';
import { BladeTrail } from './fx/trail';
import { Hud } from './ui/hud';
import { buildBattlefield, type Battlefield } from './world/battlefield';
import { Environment } from './world/environment';
import type { Models } from './render/assets';

export const SIM_DT = 1 / 60;

const ENEMY_RESPAWN = 8; // seconds
const PLAYER_RESPAWN = 3.5;

/** Parshendi move a little slower than a Shardbearer in Plate. */
const enemyMovement = () => ({
  ...tuning.movement, walkSpeed: 1.8, jogSpeed: 4.4, sprintSpeed: 6, strafeSpeed: 2.6, accel: 11, decel: 16, turnRateLocked: 7,
});

interface Enemy {
  c: Combatant;
  /** Base damage multiplier before the tuning panel's enemy damage ×. */
  damage: number;
  ai: DuelAI;
  spawn: THREE.Vector3;
  heading: number;
  trail: BladeTrail;
}

const SPARK_STEEL = new THREE.Color('#ffd9a0');
const SPARK_PARRY = new THREE.Color('#cfefff');
const MOTE = new THREE.Color('#8fd6ff');
const BLOOD_PARSH = new THREE.Color('#ff9a5a');
const TELEGRAPH = new THREE.Color('#ffb25e');
const DUST = new THREE.Color('#b59a78');

export type GameMode = 'duel' | 'horde';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: Input;
  readonly player: Combatant;
  readonly cam: ThirdPersonCamera;
  readonly enemies: Enemy[] = [];
  readonly lockOn: LockOnSystem;
  readonly sfx = new Sfx();
  readonly rules: CombatRules = { ...DEFAULT_RULES };
  /** Lets automated tests drive combat without pointer lock. */
  allowInputWithoutLock = false;
  /** Duel (default) or horde. */
  mode: GameMode = 'duel';
  readonly horde: HordeMode;
  /** Called a moment after the Shardbearer falls in horde mode (show results). */
  onHordeEnd: (() => void) | null = null;
  private hordeHud = new HordeHud();
  private warnings = new AttackWarnings();
  private eyeBurn = new EyeBurn();
  private endTimer = 0;
  /** Slow motion: remaining real seconds and the time scale while it lasts. */
  private slowmoLeft = 0;
  private slowmoScale = 1;
  private assistTarget: Combatant | null = null;
  private assistSerial = -1;
  /** Player + current foes, rebuilt each tick for hit tests. */
  private fighters: Combatant[] = [];
  private duelFoes: Combatant[] = [];
  private env: Environment;
  // Right HUD column: frame timing on top, tuning panel below it.
  readonly perf = new PerfMonitor(document.getElementById('hud-right')!);
  private debug = new DebugTools(document.getElementById('hud-right')!);
  private hud = new Hud();
  private sparks = new Sparks();
  private playerTrail = new BladeTrail(new THREE.Color('#9fdcff'));
  private hitboxes: HitboxView;
  private field: Battlefield;
  private walkToggle = false;
  private hitStop = 0;
  private tmp = new THREE.Vector3();
  private cap: Capsule = { bottom: new THREE.Vector3(), top: new THREE.Vector3(), radius: 0 };
  private contact = new THREE.Vector3();
  private playerStats = { maxHp: 160, maxStamina: 100, maxPoise: 70, staminaRegen: 42, damageScale: 1, shardplate: true };

  constructor(canvas: HTMLCanvasElement, readonly physics: Physics, models: Models) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // Phones have 3x screens and a fraction of a desktop GPU: cap the pixel ratio.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchFirst() ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Soft reflections so metal Plate isn't pitch black away from the sun.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    this.input = new Input(canvas);
    this.debug.addModeButtons(() => this.startHorde(), () => this.startDuel());
    this.env = new Environment(this.scene);
    if (isTouchFirst()) this.env.sun.shadow.mapSize.set(1024, 1024);
    this.field = buildBattlefield(this.scene, physics);

    this.player = new Combatant(physics, {
      name: 'Shardbearer', team: 'player', kind: 'plate', scale: 1, weaponModel: models.shardblade, plateModel: models.shardplate,
      spawn: this.field.spawn, heading: this.field.spawnHeading,
      stats: this.playerStats, moveset: shardbearerMoveset, rules: this.rules,
      movement: () => tuning.movement, gravity: () => tuning.movement.gravity,
    });
    this.scene.add(this.player.model.root);
    this.player.model.onFootfall = (speed) => {
      const sprint = Math.max(0, (speed - tuning.movement.jogSpeed) / (tuning.movement.sprintSpeed - tuning.movement.jogSpeed));
      this.cam.addShake(tuning.camera.footfallShake * (0.25 + sprint));
      this.sfx.step(0.25 + sprint * 0.35);
    };

    const aiParams = () => tuning.ai;
    for (const spot of this.field.enemySpots) {
      // The duel is against a Parshendi Shardbearer: Plate and Blade, a long
      // fight. Ordinary warriors die to a single Shardblade stroke.
      const shardbearer = spot.role === 'duelist';
      const c = new Combatant(physics, shardbearer ? {
        name: 'Parshendi Shardbearer', team: 'parshendi', kind: 'plate', variant: 1, scale: 1, weaponModel: models.shardblade, plateModel: models.shardplate,
        spawn: spot.pos, heading: spot.heading, stance: 'stone',
        stats: { maxHp: 420, maxStamina: 100, maxPoise: 80, staminaRegen: 32, damageScale: 1, shardplate: true },
        moveset: shardbearerMoveset, rules: this.rules,
        movement: enemyMovement, gravity: () => tuning.movement.gravity,
      } : {
        name: 'Parshendi Warrior', team: 'parshendi', kind: 'parshendi', scale: 0.94,
        spawn: spot.pos, heading: spot.heading,
        stats: { maxHp: 40, maxStamina: 60, maxPoise: 25, staminaRegen: 25, damageScale: 1, shardplate: false },
        moveset: parshendiMoveset, rules: this.rules,
        movement: enemyMovement, gravity: () => tuning.movement.gravity,
      });
      const trail = new BladeTrail(new THREE.Color(shardbearer ? '#5f86a3' : '#5a4030'), shardbearer ? 0.16 : 0.12);
      this.enemies.push({ c, damage: shardbearer ? 0.7 : 1, ai: new DuelAI(aiParams, shardbearer), spawn: spot.pos.clone(), heading: spot.heading, trail });
      this.scene.add(c.model.root, trail.mesh);
    }

    this.scene.add(this.playerTrail.mesh, this.sparks.points, this.eyeBurn.points);
    this.duelFoes = this.enemies.map((e) => e.c);
    this.horde = new HordeMode({
      physics, scene: this.scene, rules: this.rules, field: this.field, player: this.player, movement: enemyMovement,
      onEvents: (c, ev) => this.handleEvents(c, ev),
      onTelegraph: (c, heavy) => {
        // A glint off the axe as it goes up: readable even in a crowd.
        this.tmp.copy(c.position).setY(c.position.y + c.chestHeight + 0.5);
        this.sparks.burst(this.tmp, heavy ? 10 : 6, TELEGRAPH, 1.4, heavy ? 0.5 : 0.35, 0, 1);
      },
      onWave: (n, cleared) => {
        if (cleared) this.hordeHud.announce(`Wave ${n} broken`, 'Stormlight knits your wounds', 3);
        else this.hordeHud.announce(`Wave ${n}`, n === 1 ? 'They fight in pairs' : 'More come up out of the chasms');
        this.sfx.wave(cleared, 0.8);
      },
      onPlummet: (c) => this.sfx.plummet(this.audibility(c)),
    });
    this.hitboxes = new HitboxView(48);
    this.scene.add(this.hitboxes.group);

    this.cam = new ThirdPersonCamera(physics, this.player.body.collider, 1);
    this.cam.snapTo(this.field.spawn, this.field.spawnHeading);
    this.lockOn = new LockOnSystem(this.scene, this.duelFoes);

    // Browsers only allow audio after a user gesture.
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    // iOS reports the new size a beat after rotating.
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    window.visualViewport?.addEventListener('resize', () => this.resize());
    // Make sure static colliders are in the query pipeline before the first camera ray.
    physics.world.step();
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.eyeBurn.setViewportHeight(h * this.renderer.getPixelRatio(), tuning.camera.fov);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------------------
  // Simulation (fixed 60 Hz)
  // ---------------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    const inp = this.input;
    if (inp.consumePress('KeyQ') || inp.consumePress('Mouse1')) this.lockOn.toggle(this.player.position, this.cam.yaw);
    if (inp.consumePress('KeyC')) this.walkToggle = !this.walkToggle;
    if (inp.consumePress('Backquote')) this.debug.toggle();
    if (inp.consumePress('KeyH')) document.getElementById('hint')?.classList.toggle('hidden');
    if (inp.consumePress('KeyF')) this.perf.toggle();
    if (inp.consumePress('KeyM')) this.sfx.muted = !this.sfx.muted;
    if (inp.consumePress('KeyN')) { if (this.mode === 'horde') this.startDuel(); else this.startHorde(); }
    this.sfx.volume = tuning.combat.volume;
    this.rules.parryWindow = tuning.combat.parryWindow;
    this.playerStats.damageScale = tuning.combat.playerDamage;
    for (const e of this.enemies) e.c.fighter.stats.damageScale = e.damage * tuning.combat.enemyDamage;

    // Hit-stop: the whole fight freezes for a few frames on impact. Inputs
    // stay latched, so presses made during the freeze still register.
    if (this.hitStop > 0) { this.hitStop--; return; }

    this.stepPlayer(dt);
    if (this.mode === 'duel') {
      for (const e of this.enemies) {
        const intent = e.ai.think(dt, e.c, this.player);
        this.handleEvents(e.c, e.c.fixedStep(dt, intent));
      }
    } else this.horde.fixedUpdate(dt);
    this.physics.world.step();
    this.resolveHits();
    this.updateDeaths(dt);
  }

  /** Current foes: the duel's Parshendi, or the horde. */
  foes(): readonly Combatant[] {
    return this.mode === 'horde' ? this.horde.foes : this.duelFoes;
  }

  /** Game-time multiplier for the main loop (slow motion). */
  get timeScale(): number {
    if (this.slowmoLeft <= 0) return 1;
    // Ease back to full speed over the last 0.2 s.
    return this.slowmoScale + (1 - this.slowmoScale) * Math.max(0, 1 - this.slowmoLeft / 0.2);
  }

  private slowmo(seconds: number, scale: number): void {
    if (seconds <= 0) return;
    this.slowmoLeft = Math.max(this.slowmoLeft, seconds);
    this.slowmoScale = Math.min(this.slowmoLeft > seconds ? this.slowmoScale : 1, scale);
  }

  // ---------------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------------

  /** Start (or restart) a horde run. */
  startHorde(): void {
    this.mode = 'horde';
    for (const e of this.enemies) {
      e.c.fighter.kill();
      e.c.body.setSolid(false);
      e.c.model.root.visible = false;
      e.trail.mesh.visible = false;
    }
    this.lockOn.enemies = this.horde.foes;
    this.lockOn.target = null;
    this.horde.start();
    this.endTimer = 0;
    this.respawnPlayer();
    this.hordeHud.show(true);
    HordeHud.showResults(null);
  }

  /** Back to the one-on-one duel, exactly as it was. */
  startDuel(): void {
    this.horde.stop();
    this.mode = 'duel';
    this.hordeHud.show(false);
    this.warnings.hide();
    this.lockOn.enemies = this.duelFoes;
    this.lockOn.target = null;
    for (const e of this.enemies) {
      e.c.respawn(e.spawn, e.heading);
      e.c.model.root.visible = true;
      e.trail.mesh.visible = true;
    }
    this.slowmoLeft = 0;
    this.respawnPlayer();
  }

  private stepPlayer(dt: number): void {
    const inp = this.input;
    const live = inp.live || this.allowInputWithoutLock;
    const light = inp.consumePress('Mouse0');
    const heavy = inp.consumePress('Mouse2');
    const axes = inp.moveAxes();
    const target = this.lockOn.target;
    const p = this.player.position;
    const aim = this.aimAssist(axes.x, axes.y, !!target);
    const ctrl: ControlInput = {
      ...noIntent,
      light: live && light,
      heavy: live && heavy,
      heavyHeld: inp.isHeld('Mouse2'),
      dodge: inp.consumePress('Space'),
      block: inp.isHeld('KeyE'),
      switchStance: inp.consumePress('Tab'),
      shove: live && inp.consumePress('KeyR'),
      aimHeading: aim ? headingOf(aim.position.x - p.x, aim.position.z - p.z) : null,
      moveX: axes.x,
      moveY: axes.y,
      sprint: inp.isHeld('ShiftLeft') || inp.isHeld('ShiftRight'),
      walk: this.walkToggle,
      cameraYaw: this.cam.yaw,
      targetHeading: target ? headingOf(target.position.x - p.x, target.position.z - p.z) : null,
    };
    if (!this.player.alive) Object.assign(ctrl, noIntent, { moveX: 0, moveY: 0 });
    const serial = this.player.fighter.attackSerial;
    this.handleEvents(this.player, this.player.fixedStep(dt, ctrl));
    if (this.player.fighter.attackSerial !== serial) { this.assistTarget = aim; this.assistSerial = this.player.fighter.attackSerial; }
    if (this.player.position.y < -45) this.respawnPlayer();
  }

  /**
   * Aim assist (horde, not locked on): the warrior a swing should turn toward,
   * inside a cone round the pushed direction (or facing, with no input).
   * Mid-swing it sticks with the target it picked, while that one lives.
   */
  private aimAssist(mx: number, my: number, locked: boolean): Combatant | null {
    const h = tuning.horde;
    const pl = this.player;
    if (this.mode !== 'horde' || locked || !h.aimAssist || !pl.alive) return null;
    const f = pl.fighter;
    const cur = this.assistTarget;
    if (f.state === 'attack' && f.attackSerial === this.assistSerial && cur?.alive) return cur;
    const dir = inputToWorld(mx, my, this.cam.yaw);
    const heading = Math.hypot(dir.x, dir.z) > 0.2 ? headingOf(dir.x, dir.z) : pl.facing;
    const foes = this.horde.foes;
    let best: Combatant | null = null;
    const pick = chooseAimTarget(pl.position.x, pl.position.z, heading,
      foes.filter((c) => c.alive).map((c) => ({ id: c.id, x: c.position.x, z: c.position.z })),
      { coneDeg: h.aimCone, range: h.aimRange, distanceWeight: 0.6 });
    if (pick) best = foes.find((c) => c.id === pick.id) ?? null;
    return best;
  }

  /** Plate shove: knock everyone in front back (and maybe off a ledge). */
  private shove(att: Combatant): void {
    const h = tuning.horde;
    let n = 0;
    for (const def of this.foes()) {
      if (!def.alive || def.team === att.team) continue;
      const dx = def.position.x - att.position.x, dz = def.position.z - att.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > h.shoveRange + 0.5) continue;
      const off = Math.abs(angleDiff(headingOf(dx, dz), att.facing));
      if (off > (h.shoveCone * Math.PI) / 180 && dist > 1) continue;
      if (def.fighter.stats.shardplate) {
        // Plate against Plate: a nudge, never a free stagger (duel balance).
        def.knockback(att.position.x, att.position.z, h.shoveForce * 0.2);
        continue;
      }
      if (!def.fighter.receiveShove(48)) continue;
      def.knockback(att.position.x, att.position.z, h.shoveForce * (1.15 - 0.3 * dist / h.shoveRange), h.shoveDecay);
      def.model.hitFlash();
      if (this.mode === 'horde') this.horde.flash(def);
      this.tmp.copy(def.position).setY(def.position.y + 0.3);
      this.sparks.burst(this.tmp, 8, DUST, 2.5, 0.5, 6, 0.5);
      n++;
    }
    if (n) {
      this.sfx.shove(1);
      this.cam.addShake(0.06 * tuning.combat.shakeScale);
      this.hitStop = Math.max(this.hitStop, Math.round(3 * tuning.combat.hitStopScale));
    }
  }

  private handleEvents(c: Combatant, events: FighterEvent[]): void {
    const isPlayer = c === this.player;
    const g = this.audibility(c);
    for (const e of events) {
      if (e.type === 'activeStart' && e.move.shove) this.shove(c);
      else if (e.type === 'activeStart') this.sfx.swing(e.move.kind === 'heavy', g);
      else if (e.type === 'dodgeStart') this.sfx.dodge(g * 0.8);
      else if (e.type === 'stanceSwitched' && isPlayer) this.sfx.stance(0.8);
    }
  }

  /** Quieter the further a sound is from the player. */
  private audibility(c: Combatant): number {
    return Math.max(0, 1 - c.position.distanceTo(this.player.position) / 35);
  }

  /** Sweep every active blade against its opponents' capsules. */
  private resolveHits(): void {
    const all = this.fighters;
    all.length = 0;
    all.push(this.player, ...this.foes());
    for (const att of all) {
      if (!att.alive || !att.fighter.isActive()) continue;
      const move = att.fighter.move!;
      if (move.shove) continue;
      for (const def of all) {
        if (def === att || def.team === att.team || !def.alive || att.fighter.hitIds.has(def.id)) continue;
        if (!sweptBladeHits(att.prevBladeA, att.prevBladeB, att.bladeA, att.bladeB, def.capsule(this.cap), 4, this.contact)) continue;
        att.fighter.hitIds.add(def.id);
        const toAttacker = headingOf(att.position.x - def.position.x, att.position.z - def.position.z);
        const outcome = def.fighter.receiveHit(att.fighter, move, angleDiff(toAttacker, def.facing));
        this.impact(att, def, move, outcome, this.contact);
        if (!att.fighter.isActive()) break; // parried: the swing is over
      }
    }
  }

  /** All the feedback for a blade connecting. */
  private impact(att: Combatant, def: Combatant, move: Move, outcome: HitOutcome, at: THREE.Vector3): void {
    if (outcome === 'ignored') return;
    const c = tuning.combat;
    const heavy = move.kind === 'heavy';
    const involvesPlayer = att === this.player || def === this.player;
    const g = this.audibility(def);
    const shake = (n: number) => { if (involvesPlayer) this.cam.addShake(n * c.shakeScale); };
    const stop = (n: number) => { this.hitStop = Math.max(this.hitStop, Math.round(n * c.hitStopScale)); };

    switch (outcome) {
      case 'hit':
      case 'kill': {
        let stopN = move.hitStop + (outcome === 'kill' ? 5 : 0);
        let shakeN = heavy ? 0.13 : 0.07;
        if (outcome === 'kill' && this.mode === 'horde' && def !== this.player) {
          // Crowd kills scale down; multi-kills and the wave's last kill scale up.
          const kf = this.horde.registerKill(def, att === this.player ? att.fighter.attackSerial : -1);
          if (kf) { stopN = kf.hitStop; shakeN = kf.shake; this.slowmo(kf.slowmo, kf.slowmoScale); }
        }
        if (outcome === 'hit' && def === this.player && this.mode === 'horde') this.horde.onPlayerHit();
        stop(stopN);
        shake(shakeN);
        def.knockback(att.position.x, att.position.z, move.knockback * c.knockbackScale * (outcome === 'kill' ? 1.6 : 1));
        def.model.hitFlash();
        if (this.mode === 'horde') this.horde.flash(def);
        const shard = att.opts.moveset.weapon.shardblade;
        this.sfx.hit(heavy, shard, g);
        // A Shardblade doesn't cut flesh: the soul burns, shedding light.
        if (shard) this.sparks.burst(at, heavy || outcome === 'kill' ? 26 : 16, MOTE, 2.6, 0.7, -0.6, 0.6);
        else this.sparks.burst(at, 10, BLOOD_PARSH, 3, 0.35, 9);
        if (def === this.player) this.hud.playerHurt(heavy ? 0.9 : 0.6);
        if (outcome === 'kill') this.sfx.fall(g);
        // Shardblade kills burn out the eyes: two dark wisps of smoke.
        if (outcome === 'kill' && shard && !def.fighter.stats.shardplate) this.eyeBurn.emit(def.position, def.facing, 1.62 * def.opts.scale);
        break;
      }
      case 'block':
        stop(3);
        shake(0.05);
        def.knockback(att.position.x, att.position.z, 1.6 * c.knockbackScale);
        this.sfx.clang(g);
        this.sparks.burst(at, 18, SPARK_STEEL, 5, 0.35, 12);
        break;
      case 'guardBreak':
        stop(7);
        shake(0.12);
        def.knockback(att.position.x, att.position.z, 3 * c.knockbackScale);
        this.sfx.guardBreak(g);
        this.sparks.burst(at, 30, SPARK_STEEL, 6, 0.45, 12);
        break;
      case 'parry':
        stop(10);
        shake(0.1);
        this.sfx.parry(g);
        this.sparks.burst(at, 40, SPARK_PARRY, 6.5, 0.55, 8);
        att.model.hitFlash();
        break;
    }
  }

  private updateDeaths(dt: number): void {
    if (this.mode === 'horde') {
      // No respawn in a horde run: the end screen follows the fall.
      if (this.horde.ended && (this.endTimer += dt) > 2.6 && this.endTimer - dt <= 2.6) {
        HordeHud.showResults(this.horde.stats);
        this.onHordeEnd?.();
      }
      return;
    }
    for (const e of this.enemies) {
      const c = e.c;
      if (c.alive) continue;
      if (c.deadTime === 0) c.body.setSolid(false);
      c.deadTime += dt;
      if (c.deadTime > ENEMY_RESPAWN) c.respawn(e.spawn, e.heading);
    }
    const p = this.player;
    if (!p.alive) {
      p.deadTime += dt;
      if (p.deadTime > PLAYER_RESPAWN) this.respawnPlayer();
    }
  }

  private respawnPlayer(): void {
    const hp = this.player.fighter.hp;
    const midRun = this.mode === 'horde' && this.player.alive && this.horde.active && this.horde.stats.time > 0;
    this.player.respawn(this.field.landing, 0);
    this.cam.snapTo(this.field.landing, 0);
    this.lockOn.target = null;
    this.assistTarget = null;
    if (this.mode === 'horde') {
      // Falling off mid-run puts you back at the landing, hurt.
      if (midRun) this.player.fighter.hp = Math.max(1, hp - this.player.fighter.stats.maxHp * 0.25);
      return;
    }
    // The duel restarts fresh too.
    for (const e of this.enemies) if (e.ai.aggressive) e.c.respawn(e.spawn, e.heading);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * @param dt     clamped frame delta used for animation (seconds)
   * @param alpha  fixed-step interpolation factor
   * @param rawDt  real time since the previous frame (seconds), for the perf monitor
   * @param simMs  time spent in this frame's fixed sim steps (ms)
   */
  render(dt: number, alpha: number, rawDt: number, simMs: number): void {
    const t0 = performance.now();
    // During hit-stop the world holds still: no interpolation drift, no anim time.
    const frozen = this.hitStop > 0;
    const adt = frozen ? 0 : dt;
    const a = frozen ? 1 : alpha;
    const m = this.input.takeMouse();
    const locked = !!this.lockOn.target;
    this.cam.look(m.dx, m.dy, m.wheel, locked);
    if (locked) this.lockOn.handleMouse(m.dx, dt, this.player.position, this.cam.yaw);

    // Slow motion slows animation and effects too (the camera stays real-time).
    const ts = this.timeScale;
    const sdt = adt * ts;
    if (this.slowmoLeft > 0) this.slowmoLeft -= rawDt;
    this.player.render(sdt, a, tuning.movement);
    this.updateTrail(this.playerTrail, this.player, sdt);
    const em = enemyMovement();
    if (this.mode === 'duel') {
      for (const e of this.enemies) {
        e.c.render(sdt, a, em);
        this.updateTrail(e.trail, e.c, sdt);
      }
    } else this.horde.render(sdt, a, em, this.cam.camera, this.trailFn);
    this.sparks.update(dt * ts);
    this.eyeBurn.update(dt * ts);
    if (tuning.combat.showHitboxes) this.hitboxes.update([this.player, ...this.foes()], true);
    else this.hitboxes.update([], false);
    const pr = this.player.body.renderPos;
    this.lockOn.update(dt, pr);
    this.cam.update(dt, pr, this.lockOn.focus(this.tmp));
    this.env.follow(pr);
    this.hud.update(dt, this.player, this.lockOn.target);
    if (this.mode === 'horde') {
      this.hordeHud.update(dt, this.horde.stats);
      const camera = this.cam.camera;
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      const fresh = this.warnings.update(this.cam.camera, this.horde.foes, this.player, tuning.horde.warnRange, true);
      if (fresh) this.sfx.warn(0.55);
    }

    this.renderer.render(this.scene, this.cam.camera);

    this.perf.record(rawDt * 1000, simMs + performance.now() - t0);
    this.showDebug(locked);
  }

  private trailFn = (t: BladeTrail, c: Combatant, dt: number) => this.updateTrail(t, c, dt);
  private trailTip = new THREE.Vector3();
  private trailBase = new THREE.Vector3();
  private updateTrail(trail: BladeTrail, c: Combatant, dt: number): void {
    const w = c.model.weapon;
    w.localToWorld(this.trailTip.copy(c.model.tipLocal));
    w.localToWorld(this.trailBase.copy(c.model.baseLocal));
    trail.update(dt, c.alive && c.fighter.isActive(), this.trailTip, this.trailBase);
  }

  private showDebug(locked: boolean): void {
    const pl = this.player, f = pl.fighter;
    const speed = pl.speed;
    const mv = f.move;
    this.debug.show({
      state: !pl.body.grounded ? 'falling' : speed < 0.1 ? 'idle' : speed > tuning.movement.jogSpeed + 0.2 ? 'sprint' : locked ? 'strafe' : 'move',
      speed,
      pos: pl.position,
      facingDeg: (pl.facing * 180) / Math.PI,
      grounded: pl.body.grounded,
      lock: this.lockOn.target ? `${this.lockOn.target.name} #${this.lockOn.target.id}` : '—',
      walkToggle: this.walkToggle,
      combat: `${f.state} (${f.stance})${f.isActive() ? ' ACTIVE' : ''}${f.invulnerable() ? ' i-frames' : ''}${f.hyperArmor() ? ' armor' : ''}`,
      move: mv ? `${mv.id} f${f.frame}/${mv.windup + mv.active + mv.recovery}${f.chargeFrames ? ` charge ${Math.round(f.chargeFrac() * 100)}%` : ''}` : '—',
      stamina: `${f.stamina.toFixed(0)} / ${f.stats.maxStamina}`,
      poise: `${f.poise.toFixed(0)} / ${f.stats.maxPoise}`,
      horde: this.mode === 'horde' ? (() => {
        const n = this.horde.counts();
        return `${n.alive} alive · ${n.pairs} pairs · tokens ${this.horde.tokensInUse}/${tuning.horde.attackTokens} · pool ${n.pool}`;
      })() : undefined,
    });
  }
}
