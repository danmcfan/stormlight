/**
 * Always-on-top frame-time monitor: current FPS, average and worst frame,
 * plus a scrolling bar graph of frame times so dips and hitches stand out.
 *
 * Bars are frame *time* (ms), not FPS: a single 50 ms hitch is obvious as a
 * tall red spike, while an FPS average would hide it.
 *   green  ≤ 17.5 ms (60 fps)
 *   yellow ≤ 34 ms   (30 fps)
 *   red    > 34 ms   (visible stutter)
 */
const SAMPLES = 180; // ~3 s at 60 fps
const GRAPH_MAX_MS = 50;
const W = 180, H = 56;

export class PerfMonitor {
  private el: HTMLDivElement;
  private label: HTMLDivElement;
  private ctx: CanvasRenderingContext2D;
  private frames = new Float32Array(SAMPLES);
  private cpu = new Float32Array(SAMPLES);
  private head = 0;
  private count = 0;
  private labelTimer = 0;
  private skipNext = false;
  visible = true;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'perf';
    this.label = document.createElement('div');
    this.label.className = 'perf-label';
    const canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.el.append(this.label, canvas);
    document.body.appendChild(this.el);
    // Coming back to a hidden tab produces one huge bogus frame; ignore it.
    document.addEventListener('visibilitychange', () => { this.skipNext = true; });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
  }

  /** frameMs: time since the previous frame. cpuMs: time spent in our update + render. */
  record(frameMs: number, cpuMs: number): void {
    if (this.skipNext || frameMs > 1000) { this.skipNext = false; return; }
    this.frames[this.head] = frameMs;
    this.cpu[this.head] = cpuMs;
    this.head = (this.head + 1) % SAMPLES;
    this.count = Math.min(this.count + 1, SAMPLES);
    if (!this.visible) return;
    this.draw();
    this.labelTimer += frameMs;
    if (this.labelTimer >= 250) { this.labelTimer = 0; this.updateLabel(); }
  }

  private at(buf: Float32Array, i: number): number {
    // i = 0 is the oldest sample in the window.
    return buf[(this.head - this.count + i + SAMPLES) % SAMPLES];
  }

  private updateLabel(): void {
    const n = this.count;
    if (!n) return;
    // FPS over the last ~0.5 s; average / worst / CPU over the whole window.
    let recent = 0, recentN = 0, sum = 0, worst = 0, cpuSum = 0, drops = 0;
    for (let i = 0; i < n; i++) {
      const f = this.at(this.frames, i);
      sum += f; cpuSum += this.at(this.cpu, i);
      if (f > worst) worst = f;
      if (f > 34) drops++;
      if (i >= n - 30) { recent += f; recentN++; }
    }
    const fps = recentN ? 1000 / (recent / recentN) : 0;
    this.label.innerHTML =
      `<b>${fps.toFixed(0)}</b> fps &nbsp;` +
      `avg ${(sum / n).toFixed(1)} · worst <span class="${worst > 34 ? 'bad' : worst > 17.5 ? 'warn' : ''}">${worst.toFixed(1)}</span> ms<br>` +
      `cpu ${(cpuSum / n).toFixed(1)} ms · drops ${drops}`;
  }

  private draw(): void {
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    const y = (ms: number) => H - (Math.min(ms, GRAPH_MAX_MS) / GRAPH_MAX_MS) * H;
    const bw = W / SAMPLES;
    const offset = SAMPLES - this.count; // fill from the right
    for (let i = 0; i < this.count; i++) {
      const f = this.at(this.frames, i);
      g.fillStyle = f <= 17.5 ? '#4ade80' : f <= 34 ? '#facc15' : '#f87171';
      const top = y(f);
      g.fillRect((offset + i) * bw, top, Math.max(1, bw), H - top);
      // CPU time overlaid darker: the part of each frame that's our own work.
      const c = this.at(this.cpu, i);
      g.fillStyle = 'rgba(15, 23, 42, 0.55)';
      const ct = y(c);
      g.fillRect((offset + i) * bw, ct, Math.max(1, bw), H - ct);
    }
    // Reference lines at 60 fps and 30 fps.
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, Math.round(y(16.7)), W, 1);
    g.fillStyle = 'rgba(248,113,113,0.45)';
    g.fillRect(0, Math.round(y(33.3)), W, 1);
    g.font = '9px ui-monospace, Menlo, Consolas, monospace';
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText('60', 2, y(16.7) - 2);
    g.fillText('30', 2, y(33.3) - 2);
  }
}
