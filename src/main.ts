import { Physics } from './core/physics';
import { tuning } from './config';
import { loadModels } from './render/assets';
import { Game, SIM_DT } from './game';
import { isTouchFirst } from './core/device';
import { TouchControls } from './ui/touchControls';

/**
 * Touch devices: no pointer lock. The title screen becomes "tap to begin",
 * on-screen controls appear, and Pause returns to the title. A hybrid laptop
 * switches to this mode the first time its screen is touched on the title.
 */
function setupTouch(game: Game, splash: HTMLElement): { enabled: boolean; pause: () => void } {
  const state = { enabled: false, pause: () => pause() };
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

/**
 * Title-screen mode buttons. They run before the splash's own click handler
 * (which takes the mouse / starts touch play), so choosing a mode and
 * starting are one click.
 */
function setupModes(game: Game): void {
  const horde = document.getElementById('mode-horde')!;
  const duel = document.getElementById('mode-duel')!;
  horde.addEventListener('click', () => { game.startHorde(); syncModeButtons(game); });
  duel.addEventListener('click', () => { game.startDuel(); syncModeButtons(game); });
  // A click anywhere else after a horde run ends starts a fresh run.
  document.getElementById('splash')!.addEventListener('click', (e) => {
    if (e.target === horde || e.target === duel) return;
    if (game.mode === 'horde' && game.horde.ended) { game.startHorde(); syncModeButtons(game); }
  });
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyN') setTimeout(() => syncModeButtons(game), 50); });
}

function syncModeButtons(game: Game): void {
  const horde = document.getElementById('mode-horde')!;
  const duel = document.getElementById('mode-duel')!;
  const inHorde = game.mode === 'horde';
  horde.textContent = inHorde ? 'Restart the horde' : 'Face the horde';
  // After a run ends the main button already says "Fight again".
  horde.classList.toggle('hidden', inHorde && game.horde.ended);
  duel.classList.toggle('hidden', !inHorde);
  const cta = document.querySelector('.cta');
  if (cta) cta.lastChild!.previousSibling!.textContent = inHorde && game.horde.ended ? 'Fight again' : inHorde ? 'Back into the horde' : 'Take up the Blade';
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const [physics, models] = await Promise.all([Physics.create(), loadModels()]);
  const game = new Game(canvas, physics, models);
  document.getElementById('loading')?.classList.add('hidden');

  const splash = document.getElementById('splash')!;
  setupModes(game);
  // ?seed=123 makes horde runs repeatable (balance testing).
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed !== null && !Number.isNaN(Number(seed))) game.horde.seed = Number(seed);
  const touch = setupTouch(game, splash);
  // A horde run ended: back to the title screen, which now shows the results.
  game.onHordeEnd = () => {
    if (touch.enabled) touch.pause();
    else if (document.pointerLockElement) document.exitPointerLock();
    syncModeButtons(game);
  };
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
    acc += dt * game.timeScale; // slow motion runs fewer sim steps
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

  if (import.meta.env.DEV) Object.assign(window as object, { game, tuning });
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Failed to start: ${err}`;
});
