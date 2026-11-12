import { Physics } from './core/physics';
import { Game, SIM_DT } from './game';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const physics = await Physics.create();
  const game = new Game(canvas, physics);
  document.getElementById('loading')?.classList.add('hidden');

  const splash = document.getElementById('splash')!;
  splash.addEventListener('click', () => game.input.requestPointerLock());
  canvas.addEventListener('click', () => { if (!game.input.pointerLocked) game.input.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => {
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
