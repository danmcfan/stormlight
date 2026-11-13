/**
 * Screenshot the model viewer, for checking it works and for before/after art review.
 *
 *   node scripts/viewer/shot.mjs [--out art/renders/viewer] [--model shardplate.glb]
 *                                [--camera "x,y,z"] [--target "x,y,z"] [--piece name]
 *                                [--wait 1200] [--size 1400x900]
 *
 * Needs the viewer running (bun run view).
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = resolve(arg('out', 'art/renders/viewer'));
const model = arg('model', 'shardplate.glb');
const camera = arg('camera', null);
const target = arg('target', null);
const piece = arg('piece', null);
const wait = Number(arg('wait', 1500));
const [w, h] = arg('size', '1400x900').split('x').map(Number);
const url = arg('url', 'http://localhost:5178/model.html');
const tag = arg('tag', model.replace(/\.glb$/, ''));

await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
// Select the model, then wait for a frame with geometry in it.
await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('×'), {
  timeout: 30_000,
});
await page.selectOption('#model', model);
await page.waitForFunction(
  (m) => document.querySelector('#status')?.textContent?.startsWith(m),
  model,
  { timeout: 30_000 },
);

if (piece) {
  await page.evaluate((name) => {
    const app = window.__viewer;
    app.isolate(name);
    app.frameVisible();
  }, piece);
}
if (camera || target) {
  await page.evaluate(
    ({ camera, target }) => {
      const v = (s) => s.split(',').map(Number);
      // Exposed by main.ts for scripted shots.
      const app = window.__viewer;
      if (!app) throw new Error('window.__viewer missing');
      if (target) app.controls.target.set(...v(target));
      if (camera) app.camera.position.set(...v(camera));
      app.controls.update();
    },
    { camera, target },
  );
}
await page.waitForTimeout(wait);
await page.screenshot({ path: resolve(out, `${tag}.png`) });
console.log(`${out}/${tag}.png`);
if (errors.length) console.log('console errors:\n' + errors.join('\n'));

await browser.close();
