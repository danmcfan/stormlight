// Motion strips: eight frames across each of the Shardbearer's main motions, for judging
// animation (weight, clipping between Plate pieces, how the arms and armour move) the way
// still shots judge the look.
//
//   npx vite --port 5199 &
//   node scripts/lookdev/motionstrip.mjs <tag> [url]
//
// Strips: run (side), sprint (side), light attack (front three-quarter and side), heavy attack
// (front three-quarter), guard raise (front three-quarter). Time is stepped by hand at 60 Hz,
// as scripts/ingame_shots.cjs does. Writes art/renders/motion/<tag>-<strip>.jpg (one row of
// frames, each labelled with its sim frame) and <tag>-sheet.jpg (all rows).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const tag = process.argv[2] ?? 'now';
const url = process.argv[3] ?? 'http://localhost:5199/';
const dir = 'art/renders/motion';
mkdirSync(`${dir}/.frames`, { recursive: true });
const W = 420, H = 520;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.setDefaultTimeout(300000);
await page.goto(url);
await page.waitForFunction(() => window.game?.player, null, { timeout: 180000 });
await page.addStyleTag({ content: `
  body > *:not(canvas#game) { display: none !important; }
  canvas#game { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; }` });
await page.evaluate(async () => { window.__moves = (await import('/src/combat/moves.ts')).moves; });

await page.evaluate(() => {
  const g = window.game;
  const proto = Object.getPrototypeOf(g);
  const fixed = proto.fixedUpdate.bind(g);
  const render = proto.render.bind(g);
  g.allowInputWithoutLock = true;
  g.fixedUpdate = () => {};
  g.render = () => {};
  g.setQuality('high');
  for (const e of g.enemies) e.c.model.root.visible = false;
  let cam = null;
  const camUpdate = g.cam.update.bind(g.cam);
  g.cam.update = (dt, p, l) => {
    camUpdate(dt, p, l);
    if (!cam) return;
    const r = g.player.model.root;
    const f = cam.facing + (cam.az * Math.PI) / 180;
    const p0 = r.position;
    g.cam.camera.position.set(p0.x + Math.sin(f) * cam.dist, p0.y + cam.height, p0.z + Math.cos(f) * cam.dist);
    g.cam.camera.lookAt(p0.x, p0.y + cam.lookY, p0.z);
    g.cam.camera.fov = 50;
    g.cam.camera.updateProjectionMatrix();
  };
  const follow = g.env.follow.bind(g.env);
  g.env.follow = () => follow(g.player.model.root.position);
  window.__m = {
    step(n) { for (let i = 0; i < n; i++) { fixed(1 / 60); render(1 / 60, 1, 1 / 60, 0); } },
    cam(az, dist = 3.6, height = 1.35, lookY = 1.2) { cam = { az, dist, height, lookY, facing: g.player.model.root.rotation.y }; },
    reset() {
      g.input.releaseVirtual();
      g.input.pressed.clear();
      g.hitStop = 0;
      g.lockOn.target = null;
      g.player.respawn(g.field.spawn, g.field.spawnHeading);
      g.cam.snapTo(g.field.spawn, g.field.spawnHeading);
      this.step(45);
    },
    frame() { const f = g.player.fighter; return f.move ? `${f.move.id} f${f.frame}` : `${f.state} ${g.player.speed.toFixed(1)} m/s`; },
  };
});

async function grab(strip, i) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const label = await page.evaluate(() => window.__m.frame());
  const file = `${dir}/.frames/${tag}-${strip}-${i}.png`;
  await page.locator('#game').screenshot({ path: file });
  execFileSync('magick', [file, '-gravity', 'south', '-background', '#222', '-fill', 'white', '-splice', '0x22',
    '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-pointsize', '15', '-annotate', '+0+3', label, file]);
  return file;
}

/** Run `setup`, then grab 8 frames `every` sim frames apart. */
async function strip(name, setup, every) {
  await page.evaluate(setup);
  const files = [];
  for (let i = 0; i < 8; i++) {
    files.push(await grab(name, i));
    await page.evaluate((n) => window.__m.step(n), every);
  }
  await page.evaluate(() => { window.game.input.releaseVirtual(); });
  const out = `${dir}/${tag}-${name}.jpg`;
  execFileSync('magick', [...files, '+append', '-quality', '85', out]);
  console.log(`  ${name}: ${out}`);
  return out;
}

const run = (az) => `(() => { const m = window.__m, g = window.game; m.reset(); g.cam.yaw = Math.PI;
  g.input.virtualDown('KeyW'); m.step(60); m.cam(${az}); m.step(1); })()`;
const sprint = `(() => { const m = window.__m, g = window.game; m.reset(); g.cam.yaw = Math.PI;
  g.input.virtualDown('KeyW'); g.input.virtualDown('ShiftLeft'); m.step(80); m.cam(90); m.step(1); })()`;
const attack = (btn, kind, az) => `(() => { const m = window.__m, g = window.game; m.reset(); m.cam(${az}, 4.2, 1.45, 1.25);
  const id = g.player.fighter.moveset.${kind}[g.player.fighter.stance];
  g.input.virtualTap('${btn}'); m.step(1); })()`;
const guard = `(() => { const m = window.__m, g = window.game; m.reset(); m.cam(-35, 3.8); g.input.virtualDown('KeyE'); m.step(1); })()`;

const rows = [
  await strip('run-side', run(90), 4),
  await strip('sprint-side', sprint, 3),
  await strip('light-front', attack('Mouse0', 'light', -35), 4),
  await strip('light-side', attack('Mouse0', 'light', 90), 4),
  await strip('heavy-front', attack('Mouse2', 'heavy', -35), 6),
  await strip('guard-front', guard, 3),
];
execFileSync('magick', [...rows, '-append', '-quality', '85', `${dir}/${tag}-sheet.jpg`]);
execFileSync('rm', ['-rf', `${dir}/.frames`]);
console.log(JSON.stringify({ tag, sheet: `${dir}/${tag}-sheet.jpg`, errors }, null, 1));
await browser.close();
