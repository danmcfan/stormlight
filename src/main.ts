import { Physics } from './core/physics';
import { loadModels } from './render/assets';
import { Game, SIM_DT } from './game';
import { isTouchFirst } from './core/device';
import { TouchControls } from './ui/touchControls';

/**
 * Touch devices: no pointer lock. The title screen becomes "tap to begin",
 * on-screen controls appear, and Pause returns to the title. A hybrid laptop
 * switches to this mode the first time its screen is touched on the title.
 */
function setupTouch(game: Game, splash: HTMLElement): { enabled: boolean } {
  const state = { enabled: false };
  let controls: TouchControls | null = null;

  const enable = () => {
    if (state.enabled) return;
    state.enabled = true;
    document.documentElement.classList.add('touch');
    if (game.perf.visible) game.perf.toggle(); // frame timing off by default on touch
    controls = new TouchControls(game.input, {
      isLocked: () => !!game.lockOn.target,
      isMuted: () => game.sfx.muted,
      onPause: pause,
    });
  };

  let pausedAt = 0;
  const start = () => {
    // The click that follows the Pause tap lands on the title: don't resume on it.
    if (performance.now() - pausedAt < 450) return;
    game.sfx.unlock();
    game.input.touchPlaying = true;
    document.documentElement.classList.add('playing');
    splash.classList.add('hidden');
    controls?.show(true);
  };

  function pause(): void {
    pausedAt = performance.now();
    game.input.touchPlaying = false;
    document.documentElement.classList.remove('playing');
    controls?.show(false);
    splash.classList.remove('hidden');
  }

  document.getElementById('rotate-dismiss')?.addEventListener('click', () => {
    document.documentElement.classList.add('portrait-ok');
  });

  if (isTouchFirst()) enable();
  splash.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') enable(); });
  splash.addEventListener('click', () => { if (state.enabled) start(); });

  // Backgrounding the app (home swipe, notification) pauses like losing the mouse.
  document.addEventListener('visibilitychange', () => { if (document.hidden && game.input.touchPlaying) pause(); });
  window.addEventListener('blur', () => controls?.reset());

  // iOS: audio may only start inside a touchend / click handler.
  const unlock = () => game.sfx.unlock();
  window.addEventListener('touchend', unlock, { passive: true });
  window.addEventListener('click', unlock);

  // No pinch-zoom, double-tap zoom, rubber-banding or callouts during play.
  // (Scrolling inside the tuning panel is still allowed.)
  const inScrollable = (t: EventTarget | null) => t instanceof Element && !!t.closest('.lil-gui');
  document.addEventListener('touchmove', (e) => { if (!inScrollable(e.target)) e.preventDefault(); }, { passive: false });
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(g, (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => { if (state.enabled) e.preventDefault(); });
  return state;
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const [physics, models] = await Promise.all([Physics.create(), loadModels()]);
  const game = new Game(canvas, physics, models);
  document.getElementById('loading')?.classList.add('hidden');

  const splash = document.getElementById('splash')!;
  const touch = setupTouch(game, splash);
  splash.addEventListener('click', () => { if (!touch.enabled) game.input.requestPointerLock(); });
  canvas.addEventListener('click', () => { if (!touch.enabled && !game.input.pointerLocked) game.input.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => {
    if (touch.enabled) return;
    splash.classList.toggle('hidden', document.pointerLockElement === canvas);
  });

  // Fixed 60 Hz simulation, rendering at display rate with interpolation.
  // Combat frame data (later milestones) will count in these sim steps.
  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.1, rawDt);
    last = now;
    const simStart = performance.now();
    acc += dt;
    let steps = 0;
    while (acc >= SIM_DT && steps < 5) {
      game.fixedUpdate(SIM_DT);
      acc -= SIM_DT;
      steps++;
    }
    if (steps === 5) acc = 0;
    game.render(dt, acc / SIM_DT, rawDt, performance.now() - simStart);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Failed to start: ${err}`;
});
