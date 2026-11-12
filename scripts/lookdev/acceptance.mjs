// Look acceptance checks for the Shardplate in shade and for bloom.
//
//   npx vite --port 5199 &
//   node scripts/lookdev/acceptance.mjs [tag]
//
// 1. Plate in shade: renders the player from the side away from the sun and
//    from the sun side, with the fight frozen. A second render of the same
//    frame paints the Plate material flat white on black (trim, gems and the
//    dark under-layer excluded) as a mask. Reports mean HSV saturation of
//    Plate pixels in each view. Pass: shaded <= 0.30 and <= 1.3x lit.
// 2. Bloom: an idle front view rendered with and without bloom. A pixel is
//    "bloomed" if bloom raises it by more than 6/255 in any channel. Reports
//    the bloomed share of the frame (pass < 0.5%) and how far the halo spreads
//    round the chest gem, in multiples of the gem's own screen radius
//    (95th percentile of distance; pass <= ~2).
//
// Writes art/renders/look-dev/acceptance-<tag>-*.png and prints JSON.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const tag = process.argv[2] ?? 'now';
const url = process.argv[3] ?? 'http://localhost:5199/';
const dir = 'art/renders/look-dev';
mkdirSync(dir, { recursive: true });
const W = 1100, H = 700;
// Optional look overrides for A/B tests, e.g. LOOK='{"gradeAmount":0}'.
const overrides = JSON.parse(process.env.LOOK ?? '{}');
// PLATE_ONLY=1 skips the bloom check (faster bisecting).
const plateOnly = !!process.env.PLATE_ONLY;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto(url);
await page.waitForFunction(() => window.game?.setMatchShot, null, { timeout: 120000 });

// Freeze the fight (no sim, no animation time) and take over the camera.
await page.evaluate((o) => {
  const g = window.game;
  Object.assign(g.look, o);
  for (const el of document.body.children) if (el.id !== 'game') el.style.setProperty('display', 'none', 'important');
  g.setQuality('high');
  g.fixedUpdate = () => {};
  const render = g.render.bind(g);
  g.render = (_dt, _a, raw, sim) => render(0, 1, raw, sim);
  const THREE_V = g.player.position.constructor;
  window.__pose = null;
  const update = g.cam.update.bind(g.cam);
  g.cam.update = (...a) => {
    update(...a);
    const p = window.__pose;
    if (!p) return;
    g.cam.camera.position.set(...p.pos);
    g.cam.camera.lookAt(new THREE_V(...p.at));
  };
  // Hide the enemies so only the player is measured.
  for (const e of g.enemies) e.c.model.root.visible = false;
}, overrides);

/** Pose the camera round the player: `side` is a unit vector (x, z) from the player. */
async function pose(sideX, sideZ, dist, height, atHeight) {
  await page.evaluate(([sx, sz, d, h, ah]) => {
    const p = window.game.player.position;
    window.__pose = { pos: [p.x + sx * d, p.y + h, p.z + sz * d], at: [p.x, p.y + ah, p.z] };
  }, [sideX, sideZ, dist, height, atHeight]);
  await page.waitForTimeout(1500);
}

async function shot(name) {
  const file = `${dir}/acceptance-${tag}-${name}.png`;
  await page.locator('#game').screenshot({ path: file, timeout: 300000 });
  return file;
}

/** Decode a PNG to raw RGB with ImageMagick. */
function rgb(file) {
  return execFileSync('convert', [file, '-resize', `${W}x${H}!`, '-depth', '8', 'rgb:-'], { maxBuffer: 64 << 20 });
}

/**
 * Render a mask of the given material kind ('plate' or 'glow') in white on
 * black, straight to a render target (no post), and return W*H bytes.
 */
async function mask(kind) {
  const b64 = await page.evaluate(([kind, W, H]) => {
    const g = window.game;
    const r = g.renderer;
    // three's classes, borrowed from objects already in the page.
    const Basic = g.playerTrail.mesh.material.constructor; // MeshBasicMaterial
    const RT = g.post.composer.renderTarget1.constructor; // WebGLRenderTarget
    // Identify materials on the player: Plate = the material most pieces use;
    // glow = strong emissives (visor, gems).
    const counts = new Map();
    g.player.model.root.traverse((o) => { if (o.isMesh) counts.set(o.material, (counts.get(o.material) ?? 0) + 1); });
    const plate = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const isGlow = (m) => m.emissive && m.emissiveIntensity * Math.max(m.emissive.r, m.emissive.g, m.emissive.b) > 0.8;
    const target = (m) => (kind === 'plate' ? m === plate : isGlow(m));
    const white = new Basic({ color: 0xffffff });
    const black = new Basic({ color: 0x000000 });
    const saved = [];
    g.scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints) return;
      saved.push([o, o.material, o.visible]);
      if (o.isPoints) { o.visible = false; return; }
      o.material = o.isMesh && g.player.model.root.getObjectById(o.id) && target(o.material) ? white : black;
    });
    const bg = g.scene.background;
    g.scene.background = null;
    const size = { x: r.domElement.width, y: r.domElement.height };
    const rt = new RT(size.x, size.y);
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(g.scene, g.cam.camera);
    const buf = new Uint8Array(size.x * size.y * 4);
    r.readRenderTargetPixels(rt, 0, 0, size.x, size.y, buf);
    r.setRenderTarget(null);
    rt.dispose();
    for (const [o, m, v] of saved) { o.material = m; o.visible = v; }
    g.scene.background = bg;
    // Flip to top-down, one byte per pixel.
    const out = new Uint8Array(size.x * size.y);
    for (let y = 0; y < size.y; y++) for (let x = 0; x < size.x; x++) out[y * size.x + x] = buf[((size.y - 1 - y) * size.x + x) * 4];
    let s = '';
    for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(s);
  }, [kind, W, H]);
  return Buffer.from(b64, 'base64');
}

function saturationStats(img, m) {
  let n = 0, sum = 0, v = 0;
  const rgbSum = [0, 0, 0];
  for (let i = 0; i < m.length; i++) {
    if (m[i] < 128) continue;
    const r = img[i * 3] / 255, g = img[i * 3 + 1] / 255, b = img[i * 3 + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sum += mx > 0 ? (mx - mn) / mx : 0;
    v += mx;
    rgbSum[0] += r; rgbSum[1] += g; rgbSum[2] += b;
    n++;
  }
  const hex = rgbSum.map((c) => Math.round((c / Math.max(n, 1)) * 255).toString(16).padStart(2, '0')).join('');
  return { pixels: n, meanSaturation: n ? +(sum / n).toFixed(3) : null, meanValue: n ? +(v / n).toFixed(3) : null, meanColour: `#${hex}` };
}

const result = { tag, errors };

// --- 1. Plate in shade vs lit --------------------------------------------------
const sun = await page.evaluate(() => {
  const g = window.game;
  const az = (g.look.sunAzimuth * Math.PI) / 180;
  return [-Math.sin(az), -Math.cos(az)]; // horizontal direction toward the sun
});
const views = {
  shaded: [-sun[0], -sun[1]], // camera on the side away from the sun
  lit: [sun[0], sun[1]],
};
for (const [name, [sx, sz]] of Object.entries(views)) {
  await pose(sx, sz, 3.4, 1.5, 1.2);
  const img = rgb(await shot(`plate-${name}`));
  const m = await mask('plate');
  result[`plate_${name}`] = saturationStats(img, m);
}
// The usual gameplay view: behind the player, facing the bridge and chasm.
await pose(0, -1, 4, 1.7, 1.3);
result.plate_back = saturationStats(rgb(await shot('plate-back')), await mask('plate'));
const s = result.plate_shaded.meanSaturation, l = result.plate_lit.meanSaturation;
result.plate_pass = s !== null && l !== null && s <= 0.3 && s <= 1.3 * l;
result.plate_ratio = l ? +(s / l).toFixed(2) : null;

if (plateOnly) { await browser.close(); console.log(JSON.stringify(result)); process.exit(0); }

// --- 2. Bloom round the chest gem -----------------------------------------------
await pose(0, 1, 2.6, 1.45, 1.4); // in front of the player (spawn heading faces +Z)
const withBloom = rgb(await shot('bloom-on'));
await page.evaluate(() => { window.__savedBloom = window.game.look.bloomStrength; window.game.look.bloomStrength = 0; });
await page.waitForTimeout(1500);
const noBloom = rgb(await shot('bloom-off'));
await page.evaluate(() => { window.game.look.bloomStrength = window.__savedBloom; });
const glow = await mask('glow');

// Glow blobs: split the glow mask into connected regions (gem, visor, ...).
const label = new Int32Array(W * H).fill(-1);
const blobs = [];
for (let i = 0; i < W * H; i++) {
  if (glow[i] < 128 || label[i] >= 0) continue;
  const id = blobs.length, stack = [i];
  let n = 0, cx = 0, cy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
  label[i] = id;
  while (stack.length) {
    const j = stack.pop(), x = j % W, y = (j / W) | 0;
    n++; cx += x; cy += y;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    for (const k of [j - 1, j + 1, j - W, j + W]) {
      if (k < 0 || k >= W * H || label[k] >= 0 || glow[k] < 128) continue;
      if (Math.abs((k % W) - x) > 1) continue;
      label[k] = id; stack.push(k);
    }
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  blobs.push({ n, cx: cx / n, cy: cy / n, r: Math.sqrt(n / Math.PI), aspect: Math.max(bw, bh) / Math.min(bw, bh) });
}
// The chest gem: the largest roughly round blob (the visor is a wide slit).
blobs.sort((a, b) => b.n - a.n);
const big = blobs.filter((b) => b.n >= 6);
const gem = big.find((b) => b.aspect <= 2.2);

let bloomed = 0;
const dists = [];
for (let i = 0; i < W * H; i++) {
  let d = 0;
  for (let c = 0; c < 3; c++) d = Math.max(d, withBloom[i * 3 + c] - noBloom[i * 3 + c]);
  if (d <= 6) continue;
  bloomed++;
  if (!gem) continue;
  const x = i % W, y = (i / W) | 0;
  // Attribute the pixel to its nearest glow blob; keep the gem's.
  let best = null, bd = Infinity;
  for (const b of big) { const dd = Math.hypot(x - b.cx, y - b.cy) - b.r; if (dd < bd) { bd = dd; best = b; } }
  if (best === gem) dists.push(Math.hypot(x - gem.cx, y - gem.cy));
}
dists.sort((a, b) => a - b);
const p95 = dists.length ? dists[Math.floor(dists.length * 0.95)] : 0;
result.bloom = {
  bloomedShare: +((bloomed / (W * H)) * 100).toFixed(3) + '%',
  gemRadiusPx: gem ? +gem.r.toFixed(1) : null,
  haloP95Px: +p95.toFixed(1),
  haloRadii: gem ? +(p95 / gem.r).toFixed(2) : null,
  glowBlobs: big.map((b) => ({ px: b.n, at: [Math.round(b.cx), Math.round(b.cy)], aspect: +b.aspect.toFixed(1) })),
};
result.bloom_pass = bloomed / (W * H) < 0.005 && (!gem || p95 / gem.r <= 2.2);

// Diff image for review: where bloom adds light.
execFileSync('convert', [`${dir}/acceptance-${tag}-bloom-on.png`, `${dir}/acceptance-${tag}-bloom-off.png`, '-compose', 'difference', '-composite', '-level', '0,10%', `${dir}/acceptance-${tag}-bloom-diff.png`]);

await browser.close();
console.log(JSON.stringify(result, null, 2));
