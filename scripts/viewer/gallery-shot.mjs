/**
 * Screenshot the art gallery, to check it works.
 *
 *   node scripts/viewer/gallery-shot.mjs [--out art/renders/gallery.png] [--size 1600x1200]
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = resolve(arg('out', '/tmp/gallery.png'));
const [w, h] = arg('size', '1600x1200').split('x').map(Number);
const scroll = Number(arg('scroll', 0));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(arg('url', 'http://localhost:5178/gallery.html'), { waitUntil: 'load' });
await page.waitForFunction(() => /images|failed/.test(document.querySelector('#status')?.textContent ?? ''), {
  timeout: 30_000,
});
if (scroll) await page.evaluate((y) => window.scrollTo(0, y), scroll);
await page.waitForTimeout(1200);
await page.screenshot({ path: out, fullPage: !scroll });
console.log(out, await page.evaluate(() => document.querySelector('#status').textContent));
if (errors.length) console.log('console errors:\n' + errors.slice(0, 8).join('\n'));
await browser.close();
