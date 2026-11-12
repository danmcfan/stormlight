import type { Combatant } from '../entities/combatant';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

/** A bar with a delayed "damage taken" ghost behind the live fill (Souls-style). */
class Bar {
  private fill: HTMLElement;
  private ghost: HTMLElement;
  private shown = 1;
  private ghostVal = 1;
  private hold = 0;

  constructor(parent: HTMLElement, cls: string) {
    const track = el('div', `bar ${cls}`, parent);
    this.ghost = el('div', 'bar-ghost', track);
    this.fill = el('div', 'bar-fill', track);
  }

  set(frac: number, dt: number): void {
    frac = Math.max(0, Math.min(1, frac));
    if (frac < this.shown) this.hold = 0.6; // freeze the ghost briefly after damage
    this.shown = frac;
    if (frac > this.ghostVal) this.ghostVal = frac;
    else if ((this.hold -= dt) <= 0) this.ghostVal = Math.max(frac, this.ghostVal - dt * 0.6);
    this.fill.style.transform = `scaleX(${frac})`;
    this.ghost.style.transform = `scaleX(${this.ghostVal})`;
  }
}

/** Player vitals, stance, locked-target bars, hurt flash and the fallen screen. */
export class Hud {
  private hp: Bar;
  private stamina: Bar;
  private stanceWind: HTMLElement;
  private stanceStone: HTMLElement;
  private target: HTMLElement;
  private targetName: HTMLElement;
  private targetHp: Bar;
  private targetPoise: Bar;
  private hurt: HTMLElement;
  private fallen: HTMLElement;
  private hurtLevel = 0;

  constructor() {
    const vitals = el('section', 'panel vitals', document.body);
    const stance = el('div', 'stance', vitals);
    this.stanceWind = el('span', 'stance-opt', stance, '<i></i>Windstance');
    el('span', 'stance-key', stance, '<kbd>Tab</kbd>');
    this.stanceStone = el('span', 'stance-opt', stance, 'Stonestance<i></i>');
    const rows = el('div', 'vital-rows', vitals);
    el('label', 'vital-label', rows, 'Health');
    this.hp = new Bar(rows, 'bar-hp');
    el('label', 'vital-label', rows, 'Stamina');
    this.stamina = new Bar(rows, 'bar-stamina');

    this.target = el('section', 'panel target hidden', document.body);
    this.targetName = el('h2', 'target-name', this.target);
    this.targetHp = new Bar(this.target, 'bar-hp');
    this.targetPoise = new Bar(this.target, 'bar-poise');

    this.hurt = el('div', 'hurt', document.body);
    this.fallen = el('div', 'fallen hidden', document.body,
      '<div class="ornament" aria-hidden="true"><span></span><i></i><span></span></div><h2>You have fallen</h2><p>Life before death.</p>');
  }

  playerHurt(amount: number): void {
    this.hurtLevel = Math.min(1, this.hurtLevel + amount);
  }

  update(dt: number, player: Combatant, target: Combatant | null): void {
    const f = player.fighter;
    this.hp.set(f.hp / f.stats.maxHp, dt);
    this.stamina.set(f.stamina / f.stats.maxStamina, dt);
    this.stanceWind.classList.toggle('active', f.stance === 'wind');
    this.stanceStone.classList.toggle('active', f.stance === 'stone');

    const show = !!target && target.alive;
    this.target.classList.toggle('hidden', !show);
    if (show && target) {
      this.targetName.textContent = target.name;
      this.targetHp.set(target.fighter.hp / target.fighter.stats.maxHp, dt);
      this.targetPoise.set(target.fighter.poise / target.fighter.stats.maxPoise, dt);
    }

    this.hurtLevel = Math.max(0, this.hurtLevel - dt * 1.8);
    this.hurt.style.opacity = String(this.hurtLevel);
    this.fallen.classList.toggle('hidden', player.alive);
  }
}
