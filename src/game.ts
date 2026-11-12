import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { tuning } from './config';
import { ThirdPersonCamera } from './camera/thirdPersonCamera';
import { LockOnSystem } from './combat/lockOnSystem';
import { Input } from './core/input';
import { headingOf } from './core/math';
import { Physics } from './core/physics';
import { DebugTools } from './debug/debugTools';
import { PerfMonitor } from './debug/perfMonitor';
import { Parshendi } from './enemies/parshendi';
import { Player } from './player/player';
import { buildBattlefield } from './world/battlefield';
import { Environment } from './world/environment';

export const SIM_DT = 1 / 60;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: Input;
  readonly player: Player;
  readonly cam: ThirdPersonCamera;
  readonly enemies: Parshendi[] = [];
  readonly lockOn: LockOnSystem;
  private env: Environment;
  // Right HUD column: frame timing on top, tuning panel below it.
  readonly perf = new PerfMonitor(document.getElementById('hud-right')!);
  private debug = new DebugTools(document.getElementById('hud-right')!);
  private walkToggle = false;
  private tmp = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, readonly physics: Physics) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    this.env = new Environment(this.scene);
    const field = buildBattlefield(this.scene, physics);

    for (const spot of field.enemySpots) {
      const e = new Parshendi(spot.pos, spot.heading, physics);
      this.enemies.push(e);
      this.scene.add(e.root);
    }

    this.player = new Player(physics, field.spawn, field.spawnHeading);
    this.scene.add(this.player.model.root);
    this.player.model.onFootfall = (speed) => {
      const sprint = Math.max(0, (speed - tuning.movement.jogSpeed) / (tuning.movement.sprintSpeed - tuning.movement.jogSpeed));
      this.cam.addShake(tuning.camera.footfallShake * (0.25 + sprint));
    };

    this.cam = new ThirdPersonCamera(physics, this.player.collider, 1);
    this.cam.snapTo(field.spawn, field.spawnHeading);
    this.lockOn = new LockOnSystem(this.scene, this.enemies);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    // Make sure static colliders are in the query pipeline before the first camera ray.
    physics.world.step();
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  }

  fixedUpdate(dt: number): void {
    const inp = this.input;
    if (inp.consumePress('KeyQ') || inp.consumePress('Mouse1')) this.lockOn.toggle(this.player.position, this.cam.yaw);
    if (inp.consumePress('KeyC')) this.walkToggle = !this.walkToggle;
    if (inp.consumePress('Backquote')) this.debug.toggle();
    if (inp.consumePress('KeyH')) document.getElementById('hint')?.classList.toggle('hidden');
    if (inp.consumePress('KeyF')) this.perf.toggle();

    const axes = inp.moveAxes();
    const target = this.lockOn.target;
    const lockHeading = target
      ? headingOf(target.position.x - this.player.position.x, target.position.z - this.player.position.z)
      : null;
    this.player.fixedUpdate(dt, {
      moveX: axes.x,
      moveY: axes.y,
      sprint: inp.isHeld('ShiftLeft') || inp.isHeld('ShiftRight'),
      walk: this.walkToggle,
      cameraYaw: this.cam.yaw,
      lockHeading,
    });
    this.physics.world.step();
  }

  /**
   * @param dt     clamped frame delta used for animation (seconds)
   * @param alpha  fixed-step interpolation factor
   * @param rawDt  real time since the previous frame (seconds), for the perf monitor
   * @param simMs  time spent in this frame's fixed sim steps (ms)
   */
  render(dt: number, alpha: number, rawDt: number, simMs: number): void {
    const t0 = performance.now();
    const m = this.input.takeMouse();
    const locked = !!this.lockOn.target;
    this.cam.look(m.dx, m.dy, m.wheel, locked);
    if (locked) this.lockOn.handleMouse(m.dx, dt, this.player.position, this.cam.yaw);

    this.player.render(dt, alpha);
    for (const e of this.enemies) e.update(dt, this.player.renderPos);
    this.lockOn.update(dt, this.player.renderPos);
    this.cam.update(dt, this.player.renderPos, this.lockOn.focus(this.tmp));
    this.env.follow(this.player.renderPos);

    this.renderer.render(this.scene, this.cam.camera);

    this.perf.record(rawDt * 1000, simMs + performance.now() - t0);
    const speed = this.player.speed;
    const p = this.player.position;
    this.debug.show({
      state: !this.player.grounded ? 'falling' : speed < 0.1 ? 'idle' : speed > tuning.movement.jogSpeed + 0.2 ? 'sprint' : locked ? 'strafe' : 'move',
      speed,
      pos: p,
      facingDeg: (this.player.loco.facing * 180) / Math.PI,
      grounded: this.player.grounded,
      lock: this.lockOn.target ? `Parshendi #${this.lockOn.target.id}` : '—',
      walkToggle: this.walkToggle,
    });
  }
}
