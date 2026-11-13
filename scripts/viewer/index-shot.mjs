/**
 * Screenshot the art-pass landing page, to check it works.
 *
 *   node scripts/viewer/index-shot.mjs [--out art/renders/index.png] [--size 1300x900]
 *
 * Note: pages here hold an open EventSource for live reload, so this waits for 'load' and a
 * fixed settle rather than 'networkidle', which never arrives.
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = resolve(arg('out', '/tmp/index.png'));
const [w, h] = arg('size', '1300x900').split('x').map(Number);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(arg('url', 'http://localhost:5178/'), { waitUntil: 'load' });
await page.waitForFunction(() => !/loading/.test(document.querySelector('#scores')?.textContent ?? 'loading'), {
  timeout: 20_000,
});
await page.waitForTimeout(600);
await page.screenshot({ path: out, fullPage: true });
console.log(out);
if (errors.length) console.log('console errors:\n' + errors.slice(0, 6).join('\n'));
await browser.close();
