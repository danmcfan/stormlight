import GUI from 'lil-gui';
import { defaultTuning, tuning } from '../config';

export interface DebugInfo {
  state: string;
  speed: number;
  pos: { x: number; y: number; z: number };
  facingDeg: number;
  grounded: boolean;
  lock: string;
  walkToggle: boolean;
  combat: string;
  move: string;
  stamina: string;
  poise: string;
}

/** Debug readout plus a live tuning panel, both toggled with the ` key. */
export class DebugTools {
  private gui: GUI;
  private el: HTMLElement;
  private text: HTMLElement;
  visible = false;

  constructor(container: HTMLElement) {
    this.el = document.getElementById('debug')!;
    this.text = document.getElementById('debug-text')!;
    this.gui = new GUI({ title: 'Tuning', container });
    this.gui.domElement.classList.add('panel');
    const mv = this.gui.addFolder('Movement');
    mv.add(tuning.movement, 'walkSpeed', 0.5, 5, 0.1);
    mv.add(tuning.movement, 'jogSpeed', 2, 9, 0.1);
    mv.add(tuning.movement, 'sprintSpeed', 4, 14, 0.1);
    mv.add(tuning.movement, 'strafeSpeed', 1, 8, 0.1);
    mv.add(tuning.movement, 'accel', 2, 60, 0.5).name('accel (m/s²)');
    mv.add(tuning.movement, 'decel', 2, 60, 0.5).name('decel (m/s²)');
    mv.add(tuning.movement, 'turnRateJog', 1, 25, 0.1).name('turn rate jog');
    mv.add(tuning.movement, 'turnRateSprint', 0.5, 15, 0.1).name('turn rate sprint');
    mv.add(tuning.movement, 'turnRateLocked', 1, 25, 0.1).name('turn rate locked');
    mv.add(tuning.movement, 'turnSpeedPenalty', 0, 6, 0.1).name('turn speed penalty');
    mv.add(tuning.movement, 'pivotBrake', 1, 6, 0.1).name('pivot brake');
    mv.add(tuning.movement, 'gravity', 5, 60, 0.5);
    const cam = this.gui.addFolder('Camera');
    cam.add(tuning.camera, 'distance', 2, 12, 0.1).listen();
    cam.add(tuning.camera, 'pivotHeight', 1, 3, 0.05);
    cam.add(tuning.camera, 'shoulderOffset', -1.5, 1.5, 0.05);
    cam.add(tuning.camera, 'sensitivity', 0.0005, 0.006, 0.0001);
    cam.add(tuning.camera, 'pivotDamping', 2, 40, 0.5);
    cam.add(tuning.camera, 'fov', 40, 90, 1);
    cam.add(tuning.camera, 'lockYawDamping', 1, 20, 0.5);
    cam.add(tuning.camera, 'lockPitch', -0.2, 0.8, 0.01);
    cam.add(tuning.camera, 'footfallShake', 0, 0.12, 0.005);
    const cb = this.gui.addFolder('Combat');
    cb.add(tuning.combat, 'hitStopScale', 0, 3, 0.05).name('hit-stop ×');
    cb.add(tuning.combat, 'shakeScale', 0, 3, 0.05).name('shake ×');
    cb.add(tuning.combat, 'knockbackScale', 0, 3, 0.05).name('knockback ×');
    cb.add(tuning.combat, 'parryWindow', 0, 20, 1).name('parry window (frames)');
    cb.add(tuning.combat, 'playerDamage', 0.2, 5, 0.05).name('player damage ×');
    cb.add(tuning.combat, 'enemyDamage', 0, 5, 0.05).name('enemy damage ×');
    cb.add(tuning.combat, 'volume', 0, 1, 0.05);
    cb.add(tuning.combat, 'showHitboxes').name('show hitboxes');
    const ai = this.gui.addFolder('Duelist AI');
    ai.add(tuning.ai, 'aggression', 0, 1, 0.05);
    ai.add(tuning.ai, 'blockChance', 0, 1, 0.05).name('block chance');
    ai.add(tuning.ai, 'dodgeChance', 0, 1, 0.05).name('dodge chance');
    ai.add(tuning.ai, 'reaction', 0, 1, 0.01).name('reaction (s)');
    ai.add(tuning.ai, 'parryChance', 0, 1, 0.05).name('parry chance');
    mv.close(); cam.close();
    const lock = this.gui.addFolder('Lock-on');
    lock.add(tuning.lockOn, 'range', 5, 50, 1);
    lock.add(tuning.lockOn, 'breakRange', 5, 60, 1);
    lock.add(tuning.lockOn, 'switchThreshold', 5, 200, 1).name('flick threshold (px)');
    lock.add(tuning.lockOn, 'switchCooldown', 0, 1, 0.05);
    this.gui.add({ copy: () => this.copyJson() }, 'copy').name('Copy tuning JSON');
    this.gui.add({ reset: () => this.reset() }, 'reset').name('Reset to defaults');
    this.gui.hide();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
    if (this.visible) this.gui.show(); else this.gui.hide();
  }

  private async copyJson(): Promise<void> {
    const json = JSON.stringify(tuning, null, 2);
    try { await navigator.clipboard.writeText(json); } catch { console.log(json); }
  }

  private reset(): void {
    for (const k of Object.keys(defaultTuning) as (keyof typeof tuning)[]) Object.assign(tuning[k], structuredClone(defaultTuning[k]));
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  show(info: DebugInfo): void {
    if (!this.visible) return;
    const f = (n: number, d = 2) => n.toFixed(d).padStart(7);
    const row = (k: string, v: string) => `<span class="k">${k.padEnd(9)}</span>${v}`;
    this.text.innerHTML = [
      row('state', `${info.state}${info.walkToggle ? ' (walk)' : ''}`),
      row('speed', `${f(info.speed)} m/s`),
      row('pos', `${f(info.pos.x, 1)}${f(info.pos.y, 1)}${f(info.pos.z, 1)}`),
      row('facing', `${f(info.facingDeg, 0)}°`),
      row('grounded', String(info.grounded)),
      row('lock', info.lock),
      row('combat', info.combat),
      row('move', info.move),
      row('stamina', info.stamina),
      row('poise', info.poise),
    ].join('\n');
  }
}
