/**
 * Synthesized placeholder sound effects (Web Audio, no asset files).
 * Each sound is a few oscillators / filtered noise bursts with envelopes:
 * enough to sell weight and timing until real audio arrives.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  volume = 0.7;
  muted = false;

  /** Audio can only start after a user gesture; call from click/keydown. */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
    } catch { return; }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private ready(gain: number): { ctx: AudioContext; out: GainNode; t: number } | null {
    const ctx = this.ctx;
    if (!ctx || this.muted || gain <= 0.001) return null;
    this.master.gain.value = this.volume;
    const out = ctx.createGain();
    out.gain.value = gain;
    out.connect(this.master);
    return { ctx, out, t: ctx.currentTime };
  }

  private tone(ctx: AudioContext, dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack = 0.004): void {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(ctx: AudioContext, dest: AudioNode, t: number, filter: BiquadFilterType, f0: number, f1: number, q: number, dur: number, peak: number, attack = 0.005): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Blade cutting the air. */
  swing(heavy: boolean, gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    if (heavy) this.burst(ctx, out, t, 'bandpass', 260, 1300, 1.1, 0.36, 0.55, 0.06);
    else this.burst(ctx, out, t, 'bandpass', 600, 2600, 1.4, 0.22, 0.45, 0.03);
  }

  /** Shardblade (or axe) connecting with a body. */
  hit(heavy: boolean, shardblade: boolean, gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    this.tone(ctx, out, t, 'sine', heavy ? 120 : 150, 42, heavy ? 0.32 : 0.2, 0.9);
    this.burst(ctx, out, t, 'lowpass', 1600, 300, 0.7, heavy ? 0.16 : 0.1, 0.7, 0.002);
    if (shardblade) {
      // A Shardblade "rings" faintly as it passes through.
      this.tone(ctx, out, t, 'sine', 2350, 1900, 0.35, 0.08, 0.01);
      this.tone(ctx, out, t, 'sine', 3520, 3100, 0.28, 0.05, 0.01);
    }
  }

  /** Steel on steel. */
  clang(gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    for (const [f, a] of [[1150, 0.22], [1720, 0.16], [2790, 0.1], [4050, 0.05]] as const) {
      this.tone(ctx, out, t, 'sine', f, f * 0.985, 0.55 + Math.random() * 0.2, a, 0.002);
    }
    this.burst(ctx, out, t, 'highpass', 3000, 2000, 0.7, 0.07, 0.5, 0.001);
  }

  parry(gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    for (const [f, a] of [[1760, 0.25], [2640, 0.18], [3520, 0.12], [5280, 0.06]] as const) {
      this.tone(ctx, out, t, 'sine', f, f * 1.01, 1.0, a, 0.002);
    }
    this.burst(ctx, out, t, 'highpass', 4000, 2500, 0.7, 0.09, 0.6, 0.001);
    this.tone(ctx, out, t, 'sine', 180, 60, 0.25, 0.5);
  }

  guardBreak(gain = 1): void {
    this.clang(gain);
    const r = this.ready(gain); if (!r) return;
    this.tone(r.ctx, r.out, r.t, 'triangle', 90, 35, 0.45, 0.8);
  }

  dodge(gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    this.burst(ctx, out, t, 'lowpass', 900, 250, 0.8, 0.26, 0.35, 0.03);
    this.tone(ctx, out, t + 0.05, 'sine', 80, 45, 0.15, 0.35);
  }

  step(gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    this.tone(ctx, out, t, 'sine', 75, 40, 0.11, 0.5);
    this.burst(ctx, out, t, 'lowpass', 500, 150, 0.6, 0.08, 0.25, 0.002);
  }

  stance(gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    this.tone(ctx, out, t, 'sine', 660, 660, 0.5, 0.12, 0.02);
    this.tone(ctx, out, t + 0.07, 'sine', 990, 990, 0.6, 0.1, 0.02);
  }

  fall(gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    this.tone(ctx, out, t + 0.35, 'sine', 70, 35, 0.4, 0.8);
    this.burst(ctx, out, t + 0.35, 'lowpass', 700, 150, 0.6, 0.3, 0.4, 0.01);
  }

  /** Off-screen attack warning: a short rising two-note grunt-horn. */
  warn(gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    this.tone(ctx, out, t, 'sawtooth', 140, 210, 0.16, 0.12, 0.01);
    this.burst(ctx, out, t, 'bandpass', 500, 900, 2.5, 0.14, 0.25, 0.01);
  }

  /** Plate barging into bodies. */
  shove(gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    this.tone(ctx, out, t, 'triangle', 95, 45, 0.22, 0.8);
    this.burst(ctx, out, t, 'lowpass', 1100, 200, 0.7, 0.14, 0.6, 0.003);
  }

  /** A body tumbling into the chasm: falling whoosh. */
  plummet(gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    this.burst(ctx, out, t, 'bandpass', 1400, 300, 1.2, 0.9, 0.35, 0.1);
  }

  /** Wave start (low drum) / wave cleared (bright chord). */
  wave(cleared: boolean, gain = 1): void {
    const r = this.ready(gain); if (!r) return;
    const { ctx, out, t } = r;
    if (cleared) {
      for (const [f, d] of [[440, 0], [554, 0.06], [659, 0.12], [880, 0.18]] as const) this.tone(ctx, out, t + d, 'sine', f, f, 1.2, 0.12, 0.02);
    } else {
      for (const d of [0, 0.32, 0.64]) this.tone(ctx, out, t + d, 'sine', 62, 38, 0.3, 0.9);
    }
  }
}
