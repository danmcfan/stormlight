/**
 * Horde balance check: three scripted players against seeded horde runs.
 *
 *   node scripts/balance/horde.mjs [--seeds 1,2,3] [--bots aggressive,careful,idle]
 *
 * Starts a Vite dev server, loads the game headless (SwiftShader), stops the
 * live loop and steps the simulation itself, so every run is repeatable for a
 * seed. Each bot gets a fresh page.
 *
 * Bots:
 *  - aggressive: walks at the nearest warrior (camera on it), light attack
 *    every 14 frames once within 3.4 m.
 *  - careful: stands still, camera on the nearest warrior, light attack only
 *    when one is within 3.2 m.
 *  - idle: stands still facing +Z, no input.
 *
 * Targets (see tuning.horde): aggressive loses ≥30% of max HP by the end of
 * wave 3 (median over seeds) and can die by wave 5–6; careful is swung at at least every ~4 s
 * while warriors are engaged (within 12 m); idle falls within ~30 s in wave 1.
 */
import { createRequire } from 'node:module';
import { createServer } from 'vite';

// Playwright is installed globally on the dev machines, not as a dependency.
const { chromium } = createRequire(import.meta.url)('playwright');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const seeds = arg('seeds', '1,2,3,4,5,6').split(',').map(Number);
const bots = arg('bots', 'aggressive,careful,idle').split(',');
// --tune horde.waveStart=6,horde.warriorDamage=1.2 overrides tuning values for a run.
const tune = (arg('tune', '') || '').split(',').filter(Boolean).map((kv) => {
  const [path, v] = kv.split('=');
  return { path: path.split('.'), value: Number(v) };
});
const LIMIT = { aggressive: 300, careful: 120, idle: 60 }; // seconds of game time

const server = await createServer({ server: { port: 0 }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function run(bot, seed) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto(`${url}?seed=${seed}`);
  await page.waitForFunction(() => window.game && window.game.fixedUpdate, null, { timeout: 120000 });
  const res = await page.evaluate(({ bot, limit, tune }) => {
    const g = window.game;
    for (const { path, value } of tune) window.tuning[path[0]][path[1]] = value;
    const step = g.fixedUpdate.bind(g);
    g.fixedUpdate = () => {}; g.render = () => {}; // we drive time
    g.allowInputWithoutLock = true;
    g.startHorde();
    const pl = g.player, f = pl.fighter, maxHp = f.stats.maxHp;
    const out = { bot, seconds: 0, wave: 0, kills: 0, died: false, minHpByWave3: 1, minHp: 1, maxGap: 0, swingsAtMe: 0, hitsTaken: 0 };
    const serials = new Map();
    let lastSwing = null, aliveTime = 0, hp = f.hp;
    const nearest = () => {
      let best = null, bd = 1e9;
      for (const c of g.horde.foes) {
        if (!c.alive) continue;
        const d = Math.hypot(c.position.x - pl.position.x, c.position.z - pl.position.z);
        if (d < bd) { bd = d; best = c; }
      }
      return { c: best, d: bd };
    };
    for (let i = 0; i < limit * 60; i++) {
      const t = i / 60;
      const { c, d } = nearest();
      g.input.held.delete('KeyW');
      if (bot !== 'idle' && c) {
        g.cam.yaw = Math.atan2(c.position.x - pl.position.x, c.position.z - pl.position.z);
        if (bot === 'aggressive') {
          if (d > 2.2) g.input.held.add('KeyW');
          if (d < 3.4 && i % 14 === 0) g.input.pressed.add('Mouse0');
        } else if (d < 3.2 && i % 14 === 0) g.input.pressed.add('Mouse0');
      }
      step(1 / 60);
      // Warriors swinging at the player (started a swing within 4.5 m), and
      // whether any are engaged (within 12 m: arrivals still climbing in
      // from the far rim don't count toward the gap).
      let anyAlive = false;
      for (const w of g.horde.foes) {
        if (!w.alive) continue;
        if (w.position.distanceTo(pl.position) < 12) anyAlive = true;
        const s0 = serials.get(w.id);
        const s = w.fighter.attackSerial;
        serials.set(w.id, s);
        if (s0 !== undefined && s !== s0 && w.position.distanceTo(pl.position) < 4.5) {
          out.swingsAtMe++;
          if (lastSwing !== null && aliveTime - lastSwing > out.maxGap) { out.maxGap = aliveTime - lastSwing; out.gapAt = t; }
          lastSwing = aliveTime;
        }
      }
      if (anyAlive) { aliveTime += 1 / 60; if (lastSwing === null) lastSwing = aliveTime; }
      if (f.hp < hp) out.hitsTaken++;
      hp = f.hp;
      const frac = f.hp / maxHp;
      out.minHp = Math.min(out.minHp, frac);
      if (g.horde.stats.wave <= 3) out.minHpByWave3 = Math.min(out.minHpByWave3, frac);
      out.seconds = t;
      if (!pl.alive) { out.died = true; break; }
    }
    if (lastSwing !== null) out.maxGap = Math.max(out.maxGap, aliveTime - lastSwing);
    out.wave = g.horde.stats.wave; out.kills = g.horde.stats.kills;
    return out;
  }, { bot, limit: LIMIT[bot], tune });
  await page.close();
  return res;
}

const pct = (x) => `${Math.round(x * 100)}%`;
const rows = [];
for (const bot of bots) {
  for (const seed of seeds) {
    const r = await run(bot, seed);
    rows.push({ seed, ...r });
    const end = r.died ? `died at ${r.seconds.toFixed(1)} s` : `alive after ${r.seconds.toFixed(0)} s`;
    console.log(`${bot.padEnd(10)} seed ${seed}: ${end}, wave ${r.wave}, kills ${r.kills}, ` +
      `HP low by wave 3 ${pct(r.minHpByWave3)} (overall ${pct(r.minHp)}), hits taken ${r.hitsTaken}, ` +
      `swings at you ${r.swingsAtMe}, longest gap ${r.maxGap.toFixed(1)} s (ending at ${(r.gapAt ?? 0).toFixed(0)} s)`);
  }
}
// Targets.
const agg = rows.filter((r) => r.bot === 'aggressive');
const car = rows.filter((r) => r.bot === 'careful');
const idl = rows.filter((r) => r.bot === 'idle');
const check = (ok, msg) => console.log(`${ok ? 'PASS' : 'MISS'}  ${msg}`);
console.log('');
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
if (agg.length) {
  // Runs vary a lot by seed (one early hit snowballs), so judge the median.
  const lost = agg.map((r) => 1 - r.minHpByWave3);
  check(median(lost) >= 0.3, `aggressive loses ≥30% of max HP by the end of wave 3 (median ${pct(median(lost))}; per seed ${lost.map(pct).join(' ')})`);
  check(agg.some((r) => r.died && r.wave <= 6), `aggressive can die by wave 5–6 (died in waves ${agg.map((r) => (r.died ? r.wave : '–')).join(' ')})`);
}
if (car.length) check(car.every((r) => r.maxGap <= 4.5), 'careful is swung at at least every ~4 s while warriors are engaged');
if (idl.length) check(idl.every((r) => r.died && r.seconds <= 30), 'idle falls within ~30 s in wave 1');
await browser.close();
await server.close();
