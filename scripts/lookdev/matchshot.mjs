// Match shot: render the game from where the style reference was painted and
// put it side by side with the painting.
//
//   npx vite --port 5199 &
//   node scripts/lookdev/matchshot.mjs <out-name> [quality] [url]
//
// Writes art/renders/look-dev/<out-name>.png (game frame) and
// <out-name>-vs-ref.jpg (style reference left, game right).
//
// Options (environment):
//   LOOK='{"chasmFog":0}'   look overrides for A/B tests
//   MASK=1                  also write <out-name>-mask.png: terrain tops green,
//                           walls red, everything else as rendered (for
//                           scripts/lookdev/measure.py)
//   POSE='{"pos":[x,y,z],"look":[x,y,z],"fov":50}'  another camera instead of
//                           the match shot (e.g. a cliff close-up); no -vs-ref
//   DIR=art/renders/look-dev  output folder
import { createRequire } from 'node:module';
// Playwright is preinstalled globally in the dev container, not a project dependency.
const { chromium } = createRequire(import.meta.url)('playwright');
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const name = process.argv[2] ?? 'matchshot';
const quality = process.argv[3] ?? 'high';
const url = process.argv[4] ?? 'http://localhost:5199/';
// Optional look overrides for A/B tests, e.g. LOOK='{"chasmFog":0}'.
const overrides = JSON.parse(process.env.LOOK ?? '{}');
const dir = process.env.DIR ?? 'art/renders/look-dev';
const pose = process.env.POSE ? JSON.parse(process.env.POSE) : null;
const ref = 'art/source/plateau-noon/nb21-v2/plateau-noon.jpg';
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1376, height: 768 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.game?.setMatchShot, null, { timeout: 120000 });
await page.evaluate(([q, o, p]) => {
  const g = window.game;
  Object.assign(g.look, o);
  g.setQuality?.(q);
  g.setMatchShot(true);
  if (p) {
    g.poseMatchShot = () => {
      const cam = g.cam.camera;
      cam.position.set(...p.pos);
      cam.lookAt(...p.look);
      if (p.fov && cam.fov !== p.fov) { cam.fov = p.fov; cam.updateProjectionMatrix(); }
      g.env.follow(cam.position.clone().lerp(new cam.position.constructor(...p.look), 0.5), cam.position);
    };
  }
  // Only the 3D view: hide the title, HUD and panels.
  for (const el of document.body.children) if (el.id !== 'game') el.style.setProperty('display', 'none', 'important');
}, [quality, overrides, pose]);
await page.waitForTimeout(2500);
const png = `${dir}/${name}.png`;
await page.locator('#game').screenshot({ path: png, timeout: 300000 });
if (process.env.MASK) {
  await page.evaluate(() => window.setTerrainDebug(true));
  await page.waitForTimeout(800);
  await page.locator('#game').screenshot({ path: `${dir}/${name}-mask.png`, timeout: 300000 });
}
await browser.close();
if (pose) { console.log(png); process.exit(0); }
execFileSync('convert', [ref, '-resize', 'x768', png, '-resize', 'x768', '+append', '-quality', '88', `${dir}/${name}-vs-ref.jpg`]);
console.log(`${dir}/${name}-vs-ref.jpg`);
