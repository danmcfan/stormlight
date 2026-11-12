// Renders public/icons/icon.svg to the PNG sizes iOS and Android want.
// Usage: node scripts/make-icons.mjs   (needs Playwright + Chromium)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// Playwright is preinstalled globally in the dev container, not a project dependency.
const { chromium } = createRequire(import.meta.url)('playwright');

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const targets = [
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  // Maskable: launchers crop to a circle/squircle, keep the art in the safe zone.
  { file: 'icon-maskable-512.png', size: 512, pad: 0.12 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  const inner = Math.round(t.size * (1 - t.pad * 2));
  await page.setContent(`<html><body style="margin:0;background:#0a0f17;display:flex;align-items:center;justify-content:center;width:${t.size}px;height:${t.size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: join(dir, t.file), omitBackground: false });
  console.log('wrote', t.file);
}
await browser.close();
