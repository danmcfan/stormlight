import type { HordeStats } from '../horde/hordeMode';

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Horde mode HUD: wave / kills / time / streak bar, wave banners, end results. */
export class HordeHud {
  private bar: HTMLElement;
  private wave: HTMLElement;
  private kills: HTMLElement;
  private time: HTMLElement;
  private streak: HTMLElement;
  private banner: HTMLElement;
  private bannerTitle: HTMLElement;
  private bannerSub: HTMLElement;
  private bannerT = 0;
  private lastKey = '';

  constructor() {
    this.bar = document.createElement('section');
    this.bar.className = 'panel horde-bar hidden';
    this.bar.innerHTML =
      '<div><label>Wave</label><b data-k="wave">1</b></div>' +
      '<div><label>Kills</label><b data-k="kills">0</b></div>' +
      '<div><label>Time</label><b data-k="time">0:00</b></div>' +
      '<div class="streak"><label>Streak</label><b data-k="streak">0</b></div>';
    const q = (k: string) => this.bar.querySelector(`[data-k="${k}"]`) as HTMLElement;
    this.wave = q('wave'); this.kills = q('kills'); this.time = q('time'); this.streak = q('streak');
    document.body.appendChild(this.bar);

    this.banner = document.createElement('div');
    this.banner.className = 'wave-banner hidden';
    this.banner.innerHTML = '<div class="ornament" aria-hidden="true"><span></span><i></i><span></span></div><h2></h2><p></p>';
    this.bannerTitle = this.banner.querySelector('h2')!;
    this.bannerSub = this.banner.querySelector('p')!;
    document.body.appendChild(this.banner);
  }

  show(on: boolean): void {
    this.bar.classList.toggle('hidden', !on);
    if (!on) { this.banner.classList.add('hidden'); this.bannerT = 0; }
  }

  announce(title: string, sub: string, seconds = 2.4): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.classList.remove('hidden');
    // Restart the CSS fade-in.
    this.banner.classList.remove('in');
    void this.banner.offsetWidth;
    this.banner.classList.add('in');
    this.bannerT = seconds;
  }

  update(dt: number, s: HordeStats): void {
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.banner.classList.add('hidden');
    const key = `${s.wave}|${s.kills}|${Math.floor(s.time)}|${s.streak}`;
    if (key === this.lastKey) return; // touch the DOM only when something changed
    this.lastKey = key;
    this.wave.textContent = String(s.wave);
    this.kills.textContent = String(s.kills);
    this.time.textContent = fmtTime(s.time);
    this.streak.textContent = String(s.streak);
    this.streak.parentElement!.classList.toggle('hot', s.streak >= 10);
  }

  /** Fill the title screen's results card. */
  static showResults(s: HordeStats | null): void {
    const el = document.getElementById('results');
    if (!el) return;
    el.classList.toggle('hidden', !s);
    if (!s) return;
    el.innerHTML =
      '<h2 class="panel-title">The horde</h2>' +
      `<dl><dt>Wave reached</dt><dd>${s.wave}</dd>` +
      `<dt>Kills</dt><dd>${s.kills}</dd>` +
      `<dt>Into the chasm</dt><dd>${s.falls}</dd>` +
      `<dt>Longest streak</dt><dd>${s.bestStreak}</dd>` +
      `<dt>Time</dt><dd>${fmtTime(s.time)}</dd></dl>`;
  }
}
