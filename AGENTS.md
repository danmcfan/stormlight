# Stormlight: agent guide

A browser action RPG prototype set on the Shattered Plains (Three.js, Rapier,
TypeScript, Vite). The plan lives in GitHub issues on `danmcfan/stormlight`:
#1 is the overall plan, the milestone issues hang under it, and #9 is the art
pass. Scripts are in `package.json`.

## Read before you start

| When your task… | Read first |
|---|---|
| changes how anything **looks** (terrain, props, characters, materials, light, effects) | `docs/look-brief.md`, then `docs/rendering.md` for the renderer and its look values |
| runs **more than one improvement round** on the look or a model | `docs/art-rounds.md`: the brief, the ledger in `art/rounds/`, the fresh-context judge, the caps |
| **generates images** (concept art, references, textures) | `docs/art.md` |
| builds or changes a **3D model** | `docs/3d-pipeline.md` |
| changes **gameplay** (controls, combat, horde mode) | `README.md` for how it plays; every feel number is in `src/config.ts` |
| changes the **agent box** (the VPS that runs Claude Code and Cursor CLI) | `ops/nixos/README.md` |

## Shipping a change

Several sessions work on `main` at once, and every push to `main` deploys the
live site (`.github/workflows/deploy.yml`). For each push:

1. `npm test` and `npm run build` pass (the build includes the type check).
2. `git pull --rebase origin main`; resolve conflicts keeping both sides' work,
   then repeat step 1.
3. If images or models are now 130-byte text files, run `git lfs checkout`:
   art and models are Git LFS, and a rebase can leave pointer stubs.
4. Push in small commits whose messages explain what changed and why.

## Rules

- **Stay in your lane.** When your brief names files another session owns,
  touch them only as far as your brief allows, and say so in the commit.
- **Combat timing is shared data.** `src/combat/moves.ts` keyframes drive both
  the animation and the hit detection (`src/combat/bladePose.ts`); weapon pivots
  and the hit capsule must stay in step with the skeleton in
  `src/render/humanoid.ts`.
- **Tests guard rules, not numbers.** Unit-test rules of play and pure logic
  (the fighter state machine, direction conventions, horde logic) through their
  public functions, with fixed inputs of the test's own; tuning values in
  `src/config.ts` and the look stay free to change, and screenshots judge art.
- **A Shardblade kills anyone without Shardplate in one stroke.** Long fights
  are Plate against Plate. This is a design decision from the user.

## Checking your work in a browser

- Playwright and Chromium are installed. This machine has no GPU: launch with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. Frame
  rates here are meaningless; the user measures on a real phone (frame timing
  panel, key F).
- Run `npx vite`, wait for `window.game`, then drive it: set
  `game.allowInputWithoutLock = true`; press with `game.input.pressed.add(code)`
  and hold with `game.input.held`; step time by calling `game.fixedUpdate(1/60)`
  yourself (replace it with a no-op first so the live loop stops moving things).
- `node scripts/ingame_shots.cjs` and `node scripts/lookdev/matchshot.mjs` take
  standard screenshots; see the docs above.
- Read every screenshot you take. Check desktop and an emulated iPhone
  (`devices['iPhone 15 Pro landscape']`); the touch controls must keep working.
