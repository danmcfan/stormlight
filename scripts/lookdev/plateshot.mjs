// The Plate's fixed close-up views, for judging how the Shardplate is painted.
//
//   npx vite --port 5199 &
//   node scripts/lookdev/plateshot.mjs <tag> [url]
//
// Freezes the fight, hides the enemies, sets quality high and places the camera
// round the player:
//   closeup  chest-height three-quarter from the front, framed like the concept
//            close-up (art/source/shardbearer-closeup/nb21-v2)
//   shade    the side away from the sun
//   back     from behind and above, the usual gameplay angle
// Writes art/renders/look-dev/plate-<tag>-<view>.png and plate-<tag>-vs-ref.jpg
// (the concept close-up left, the game's closeup right). LOOK='{...}' overrides
// look values, as in acceptance.mjs.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const tag = process.argv[2] ?? 'now';
const url = process.argv[3] ?? 'http://localhost:5199/';
const dir = 'art/renders/look-dev';
const REF = 'art/source/shardbearer-closeup/nb21-v2/shardbearer-closeup.jpg';
mkdirSync(dir, { recursive: true });
const W = 900, H = 900;
const overrides = JSON.parse(process.env.LOOK ?? '{}');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto(url);
await page.waitForFunction(() => window.game?.setMatchShot, null, { timeout: 120000 });

await page.evaluate((o) => {
  const g = window.game;
  Object.assign(g.look, o);
  for (const el of document.body.children) if (el.id !== 'game') el.style.setProperty('display', 'none', 'important');
  g.setQuality('high');
  g.fixedUpdate = () => {};
  const render = g.render.bind(g);
  g.render = (_dt, _a, raw, sim) => render(0, 1, raw, sim);
  const V = g.player.position.constructor;
  window.__pose = null;
  const update = g.cam.update.bind(g.cam);
  g.cam.update = (...a) => {
    update(...a);
    const p = window.__pose;
    if (!p) return;
    g.cam.camera.position.set(...p.pos);
    g.cam.camera.lookAt(new V(...p.at));
  };
  for (const e of g.enemies) e.c.model.root.visible = false;
}, overrides);

/** Camera round the player, in the player's own frame: right/forward are its axes. */
async function pose(right, forward, height, atHeight) {
  await page.evaluate(([r, f, h, ah]) => {
    const g = window.game;
    const root = g.player.model.root;
    root.updateMatrixWorld(true);
    const p = g.player.position;
    const e = root.matrixWorld.elements;          // columns: x (left), y, z (forward)
    const ax = [e[0], e[2]], az = [e[8], e[10]];
    const nx = Math.hypot(...ax) || 1, nz = Math.hypot(...az) || 1;
    // +x is the character's left, so "right" is -x.
    const x = p.x - r * ax[0] / nx + f * az[0] / nz;
    const z = p.z - r * ax[1] / nx + f * az[1] / nz;
    window.__pose = { pos: [x, p.y + h, z], at: [p.x, p.y + ah, p.z] };
  }, [right, forward, height, atHeight]);
  await page.waitForTimeout(1500);
}

async function shot(name) {
  const file = `${dir}/plate-${tag}-${name}.png`;
  await page.locator('#game').screenshot({ path: file, timeout: 300000 });
  return file;
}

await pose(0.55, 1.45, 1.85, 1.62);
const closeup = await shot('closeup');
const sun = await page.evaluate(() => {
  const g = window.game;
  let d = null;
  g.scene.traverse((o) => { if (o.isDirectionalLight && !d) d = o.position.clone().sub(o.target.position).normalize(); });
  return d ? [d.x, d.z] : [1, 0];
});
// Shade side: the camera on the far side from the sun, looking back at the player.
await page.evaluate(([sx, sz]) => {
  const p = window.game.player.position;
  const n = Math.hypot(sx, sz) || 1;
  window.__pose = { pos: [p.x - (sx / n) * 3.2, p.y + 1.7, p.z - (sz / n) * 3.2], at: [p.x, p.y + 1.3, p.z] };
}, sun);
await page.waitForTimeout(1500);
await shot('shade');
await pose(0.6, -4.2, 2.6, 1.3);
await shot('back');

execFileSync('convert', [REF, '-resize', `${W}x${H}!`, closeup, '-resize', `${W}x${H}!`, '+append', '-quality', '88',
  `${dir}/plate-${tag}-vs-ref.jpg`]);
console.log(JSON.stringify({ tag, files: ['closeup', 'shade', 'back', 'vs-ref'].map((v) => `${dir}/plate-${tag}-${v}`), errors }, null, 1));
await browser.close();
