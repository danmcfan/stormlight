#!/usr/bin/env node
/**
 * In-game screenshots of the Shardplate characters for art review.
 *
 * Usage (from the repo root):
 *   node scripts/ingame_shots.cjs [--out art/renders/ingame] [--only idle-front,guard]
 *
 *   --out   output directory (default art/renders/ingame, relative to the cwd)
 *   --only  comma-separated shot names to take (default: all). Names:
 *           idle-front idle-side idle-34 guard light-1 light-2 light-3 heavy
 *           sprint enemy-34 game-cam
 *
 * Writes one PNG per shot (<name>.png, 640x720) plus sheet.png, a labelled
 * contact sheet of every shot taken, and prints the files written.
 *
 * How it works
 *  - Starts the Vite dev server itself (`npx vite --port <free> --strictPort`),
 *    waits for it, and kills it at the end (also on error).
 *  - Opens the game in headless Chromium (Playwright, software WebGL via
 *    SwiftShader), waits for `window.game` (exposed by src/main.ts in dev),
 *    hides every DOM overlay so only the WebGL canvas shows, and sets
 *    `game.allowInputWithoutLock = true` (no pointer lock / title gate needed).
 *  - Takes over time: `game.fixedUpdate` / `game.render` are replaced on the
 *    instance with no-ops so main.ts's rAF loop does nothing; the originals
 *    (from Game.prototype) are stepped manually: one fixed 60 Hz sim step then
 *    one render call per frame, with the renderer's draw suppressed on all but
 *    the last frame of a batch (so animation smoothing sees real 1/60 s steps
 *    but only the captured frame pays for a software-GL draw).
 *  - Drives the player through `game.input.virtualTap/virtualDown/virtualUp`:
 *    Mouse0 = light attack (combo), Mouse2 = heavy, KeyE = block/guard,
 *    KeyW = forward, ShiftLeft = sprint (see Game.stepPlayer).
 *  - Framing: the game's own camera object (`game.cam.camera`) is overridden
 *    right after ThirdPersonCamera.update each render, so the shot goes through
 *    the game's normal render path (including any post-processing) but from a
 *    camera placed around the subject (`combatant.model.root`). The sun's
 *    shadow frustum is re-centred on the subject too. `game-cam` leaves the
 *    camera alone and shows what the player sees.
 *  - The player is respawned at the start point before every pose, so poses
 *    don't bleed into each other. The enemy Shardbearer (variant 1, bronze
 *    Plate with helm_crest, the `aggressive` duelist) stands ~36 m away near the
 *    bridge landing, out of its engage range, so it just idles in Stonestance.
 *  - The contact sheet is drawn on a 2D canvas in a second browser page.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const W = 640, H = 720;

const ALL_SHOTS = [
  'idle-front', 'idle-side', 'idle-34', 'guard', 'light-1', 'light-2', 'light-3',
  'heavy', 'sprint', 'enemy-34', 'game-cam',
];

function parseArgs(argv) {
  const out = { out: path.join(ROOT, 'art/renders/ingame'), only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--out') out.out = path.resolve(process.cwd(), val());
    else if (a.startsWith('--out=')) out.out = path.resolve(process.cwd(), a.slice(6));
    else if (a === '--only') out.only = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--only=')) out.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
    else throw new Error(`unknown argument: ${a}`);
  }
  if (out.only) {
    const bad = out.only.filter((s) => !ALL_SHOTS.includes(s));
    if (bad.length) throw new Error(`unknown shot(s): ${bad.join(', ')} (known: ${ALL_SHOTS.join(', ')})`);
  }
  return out;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode && res.statusCode < 500); });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

async function startVite() {
  const port = await freePort();
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const url = `http://127.0.0.1:${port}/`;
  const t0 = Date.now();
  while (!(await httpOk(url))) {
    if (exited) throw new Error(`vite exited early:\n${log}`);
    if (Date.now() - t0 > 60000) throw new Error(`vite did not respond within 60 s:\n${log}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  const stop = () => {
    if (exited) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
  };
  return { url, stop };
}

// ---------------------------------------------------------------------------
// In-page harness (stringified into the page)
// ---------------------------------------------------------------------------

function installHarness() {
  const g = window.game;
  const proto = Object.getPrototypeOf(g);
  const DT = 1 / 60;
  const Hn = {};
  window.__shots = Hn;

  g.allowInputWithoutLock = true;
  // Freeze main.ts's rAF loop: it calls these instance properties.
  const fixed = proto.fixedUpdate.bind(g);
  const render = proto.render.bind(g);
  g.fixedUpdate = () => {};
  g.render = () => {};

  // Suppress the actual GPU draw for intermediate frames.
  let skipDraw = false;
  const r = g.renderer;
  const draw = r.render;
  r.render = function (...a) { if (skipDraw) return; return draw.apply(this, a); };

  // Camera override applied right after the game camera's own update.
  let override = null;
  const camUpdate = g.cam.update.bind(g.cam);
  g.cam.update = (dt, p, l) => {
    camUpdate(dt, p, l);
    if (!override) return;
    const o = override();
    const c = g.cam.camera;
    c.position.set(o.pos[0], o.pos[1], o.pos[2]);
    c.up.set(0, 1, 0);
    c.lookAt(o.look[0], o.look[1], o.look[2]);
    c.fov = o.fov;
    c.updateProjectionMatrix();
  };
  // Shadow frustum follows the subject instead of the player.
  let followOverride = null;
  const follow = g.env.follow.bind(g.env);
  g.env.follow = (t) => follow(followOverride ? followOverride() : t);

  Hn.step = (n, drawLast = true) => {
    for (let i = 0; i < n; i++) {
      fixed(DT);
      skipDraw = !(drawLast && i === n - 1);
      render(DT, 1, DT, 0);
      skipDraw = false;
    }
  };
  /** Step until pred() is true (checked after each sim step), then draw. */
  Hn.stepUntil = (predSrc, max = 240, drawAtEnd = true) => {
    const pred = new Function('g', `return (${predSrc});`);
    for (let i = 0; i < max; i++) {
      fixed(DT);
      skipDraw = true;
      render(DT, 1, DT, 0);
      skipDraw = false;
      if (pred(g)) { if (drawAtEnd) Hn.redraw(); return i + 1; }
    }
    throw new Error(`condition not reached in ${max} steps: ${predSrc}`);
  };
  /** Re-run the render path without advancing anything (dt 0). */
  Hn.redraw = () => render(0, 1, 0, 0);

  const enemy = () => g.enemies.find((e) => e.c.opts.variant === 1 && e.c.opts.kind === 'plate').c;
  const subjectOf = (who) => (who === 'enemy' ? enemy() : g.player);

  /**
   * Orbit camera around a subject: az = degrees from the subject's facing
   * (0 = in front, 90 = its left side, -90 = right), dist metres, height /
   * lookY above its feet.
   */
  Hn.setCam = (spec) => {
    if (!spec) { override = null; followOverride = null; return; }
    const s = { who: 'player', az: 0, dist: 3.2, height: 1.4, lookY: 1.25, fov: 55, fixedFacing: null, ...spec };
    override = () => {
      const c = subjectOf(s.who);
      const p = c.model.root.position;
      const f = (s.fixedFacing ?? c.model.root.rotation.y) + (s.az * Math.PI) / 180;
      return {
        pos: [p.x + Math.sin(f) * s.dist, p.y + s.height, p.z + Math.cos(f) * s.dist],
        look: [p.x, p.y + s.lookY, p.z],
        fov: s.fov,
      };
    };
    followOverride = () => subjectOf(s.who).model.root.position;
  };

  Hn.reset = () => {
    const inp = g.input;
    inp.releaseVirtual();
    inp.pressed.clear();
    g.hitStop = 0;
    g.lockOn.target = null;
    g.player.respawn(g.field.spawn, g.field.spawnHeading);
    g.cam.snapTo(g.field.spawn, g.field.spawnHeading);
    g.cam.pitch = 0.22;
    // Settle: land, let the weapon pose and camera damping converge.
    Hn.step(45, false);
  };

  Hn.info = () => {
    const f = g.player.fighter;
    return { state: f.state, move: f.move ? f.move.id : null, frame: f.frame, active: f.isActive(), speed: g.player.speed };
  };
  Hn.enemyInfo = () => {
    const c = enemy();
    return { name: c.name, variant: c.opts.variant, state: c.fighter.state, stance: c.fighter.stance, dist: c.position.distanceTo(g.player.position) };
  };
}

// Each shot: runs in the page, returns a label. `S` = window.__shots, `g` = game.
const SHOTS = {
  'idle-front': {
    label: 'Idle — front',
    run: () => { S.reset(); S.setCam({ az: 0 }); S.step(1); return 'idle, front'; },
  },
  'idle-side': {
    label: 'Idle — side',
    run: () => { S.reset(); S.setCam({ az: 90 }); S.step(1); return 'idle, left side'; },
  },
  'idle-34': {
    label: 'Idle — three-quarter',
    run: () => { S.reset(); S.setCam({ az: 40 }); S.step(1); return 'idle, front three-quarter'; },
  },
  guard: {
    label: 'Guard (hold E)',
    run: () => {
      S.reset(); S.setCam({ az: 35 });
      g.input.virtualDown('KeyE');
      S.step(24);
      const st = g.player.fighter.state;
      g.input.virtualUp('KeyE');
      return `guard (${st})`;
    },
  },
  // The light combo: tap, capture mid-active, tap again for the chained move.
  ...Object.fromEntries([1, 2, 3].map((n) => [`light-${n}`, {
    label: `Light combo ${n}`,
    run: (n) => {
      S.reset();
      const facing = g.player.model.root.rotation.y;
      S.setCam({ az: -35, dist: 4.8, height: 1.5, lookY: 1.15, fov: 54, fixedFacing: facing });
      const stance = g.player.fighter.stance;
      let id = g.player.fighter.moveset.light[stance];
      for (let k = 1; k <= n; k++) {
        g.input.virtualTap('Mouse0');
        const m = window.__moves[id];
        const mid = m.windup + Math.floor(m.active / 2);
        S.stepUntil(`g.player.fighter.move && g.player.fighter.move.id === '${id}' && g.player.fighter.frame >= ${mid}`, 120, k === n);
        if (k < n) id = m.chain;
      }
      const f = g.player.fighter;
      return `${f.move.id} f${f.frame} (active ${f.isActive()})`;
    },
  }])),
  heavy: {
    label: 'Heavy attack',
    run: () => {
      S.reset();
      const facing = g.player.model.root.rotation.y;
      S.setCam({ az: -60, dist: 4.8, height: 1.5, lookY: 1.15, fov: 54, fixedFacing: facing });
      const id = g.player.fighter.moveset.heavy[g.player.fighter.stance];
      const m = window.__moves[id];
      g.input.virtualTap('Mouse2');
      S.stepUntil(`g.player.fighter.move && g.player.fighter.move.id === '${id}' && g.player.fighter.frame >= ${m.windup + Math.floor(m.active / 2)}`, 120);
      const f = g.player.fighter;
      return `${f.move.id} f${f.frame} (active ${f.isActive()})`;
    },
  },
  sprint: {
    label: 'Sprint (W + Shift)',
    run: () => {
      S.reset();
      // Turn the camera around so W runs back across the staging plateau.
      g.cam.yaw = Math.PI;
      S.setCam({ az: 90, dist: 4.2, height: 1.3, lookY: 1.1, fov: 52 });
      g.input.virtualDown('KeyW');
      g.input.virtualDown('ShiftLeft');
      S.step(70, false);
      // Mid-stride: legs furthest apart.
      S.stepUntil('Math.abs(Math.sin(g.player.model.phase)) > 0.93', 60);
      const sp = g.player.speed;
      g.input.virtualUp('KeyW');
      g.input.virtualUp('ShiftLeft');
      g.cam.yaw = 0;
      return `sprint ${sp.toFixed(1)} m/s`;
    },
  },
  'enemy-34': {
    label: 'Enemy Shardbearer — three-quarter',
    run: () => {
      S.reset();
      S.setCam({ who: 'enemy', az: 35 });
      S.step(1);
      const e = S.enemyInfo();
      return `${e.name} (variant ${e.variant}, ${e.stance}stance)`;
    },
  },
  'game-cam': {
    label: 'Game camera',
    run: () => {
      S.reset();
      S.setCam(null);
      S.step(60);
      return 'third-person camera as played';
    },
  },
};

async function makeSheet(browser, shots, outFile) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const items = shots.map((s) => ({ label: s.label, detail: s.detail, src: `data:image/png;base64,${fs.readFileSync(s.file).toString('base64')}` }));
  const dataUrl = await page.evaluate(async ({ items, W, H }) => {
    const cols = Math.min(4, items.length);
    const rows = Math.ceil(items.length / cols);
    const scale = 0.5, tw = W * scale, th = H * scale, band = 34, pad = 6;
    const cv = document.createElement('canvas');
    cv.width = cols * (tw + pad) + pad;
    cv.height = rows * (th + band + pad) + pad;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#15181d';
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < items.length; i++) {
      const img = new Image();
      img.src = items[i].src;
      await img.decode();
      const x = pad + (i % cols) * (tw + pad), y = pad + Math.floor(i / cols) * (th + band + pad);
      ctx.drawImage(img, x, y, tw, th);
      ctx.fillStyle = '#23272e';
      ctx.fillRect(x, y + th, tw, band);
      ctx.fillStyle = '#f1e9d8';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(items[i].label, x + 7, y + th + 15);
      ctx.fillStyle = '#9aa3ad';
      ctx.font = '11px sans-serif';
      ctx.fillText(items[i].detail, x + 7, y + th + 29);
    }
    return cv.toDataURL('image/png');
  }, { items, W, H });
  fs.writeFileSync(outFile, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await page.close();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = args.only ?? ALL_SHOTS;
  fs.mkdirSync(args.out, { recursive: true });

  let vite = null, browser = null;
  const cleanup = async () => {
    if (browser) { await browser.close().catch(() => {}); browser = null; }
    if (vite) { vite.stop(); vite = null; }
  };
  process.on('SIGINT', () => { cleanup().finally(() => process.exit(130)); });

  try {
    vite = await startVite();
    browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.setDefaultTimeout(300000);

    await page.goto(vite.url, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 180000, polling: 500 });
    } catch (e) {
      throw new Error(`window.game never appeared. Page errors:\n${errors.join('\n')}`);
    }
    // Only the WebGL canvas: hide splash, loading, HUD columns, vitals, touch UI, tuning panel...
    await page.addStyleTag({ content: `
      body > *:not(canvas#game) { display: none !important; }
      .lil-gui, .touch-ui, .splash, .loading, .hud-col, .vitals, .target, .hurt, .fallen, .rotate-hint { display: none !important; }
      canvas#game { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; }
    ` });
    // moves.ts data for frame targets, read through Vite's module graph.
    await page.evaluate(async () => { window.__moves = (await import('/src/combat/moves.ts')).moves; });
    await page.evaluate(`(${installHarness.toString()})()`);

    const canvasBox = await page.locator('canvas#game').boundingBox();
    const clip = { x: 0, y: 0, width: Math.round(canvasBox.width) || W, height: Math.round(canvasBox.height) || H };

    const done = [];
    for (const name of names) {
      const shot = SHOTS[name];
      const n = name.startsWith('light-') ? Number(name.slice(6)) : undefined;
      const t0 = Date.now();
      const detail = await page.evaluate(`(() => { const S = window.__shots, g = window.game; return (${shot.run.toString()})(${n}); })()`);
      // Let the compositor present the drawn frame before grabbing it.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const file = path.join(args.out, `${name}.png`);
      await page.screenshot({ path: file, clip });
      done.push({ name, label: shot.label, detail, file });
      console.log(`  ${name.padEnd(11)} ${detail}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
    if (errors.length) console.warn(`page errors during capture:\n  ${errors.join('\n  ')}`);

    const sheet = path.join(args.out, 'sheet.png');
    await makeSheet(browser, done, sheet);

    console.log('\nFiles written:');
    for (const d of done) console.log(`  ${path.relative(process.cwd(), d.file)}`);
    console.log(`  ${path.relative(process.cwd(), sheet)}`);
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(`ingame_shots: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
