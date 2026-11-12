# Shattered Plains — gameplay prototype

A browser prototype of Shardbearer combat on the Shattered Plains. Graphics are
deliberately rough: the goal is to get the *feel* right first.

## Play it

**https://danmcfan.github.io/stormlight/**. Every push to `main` deploys automatically
(see `.github/workflows/deploy.yml`).

## Run it locally

```bash
npm install
npm run dev
```

Open the printed URL (usually http://localhost:5173) and click to take control.

| Input | Action |
|---|---|
| WASD | Move (relative to camera) |
| Shift | Sprint |
| C | Toggle walk |
| Mouse | Look · Scroll to zoom |
| Q / Middle mouse | Lock on / release |
| Flick mouse while locked | Switch target left/right |
| ` (backquote) | Debug readout + live tuning panel |
| F | Show/hide the FPS graph (top right) |
| H | Hide the help panel |
| Esc | Release the mouse |

Fall into a chasm and you respawn on the staging plateau.

## Tuning feel

Every number that affects feel is in `src/config.ts`. Press ` in game to tweak
them live, then **Copy tuning JSON** and paste the values you like back into
`config.ts`.

## Milestones

1. **Movement, camera, lock-on** ✅ — heavy Plate locomotion (inertia, limited
   turn rate, plant-and-pivot), over-the-shoulder camera with collision,
   Souls-style lock-on and strafing, assault plateau + bridge + chrysalis.
2. One-on-one duel: light/heavy combos, dodge, block, parry, hit-stop,
   Windstance / Stonestance switching.
3. Shardbearer systems: Stormlight, per-piece Plate cracking, Blade summon.
4. The battle: crowds of Parshendi, attack-token AI, allied squad.
5. Parshendi Shardbearer duel.
6. First-person mode.
7. A ten-minute plateau run, then an art pass.

## Layout

```
src/
  config.ts              all tunable numbers
  game.ts                wires everything together
  main.ts                boot + fixed 60 Hz loop with render interpolation
  core/                  input, math, Rapier physics wrapper
  player/locomotion.ts   pure movement model (unit-tested)
  player/player.ts       character controller (Rapier)
  player/playerModel.ts  placeholder Plate model + procedural animation
  camera/                third-person camera
  combat/lockOn.ts       pure target selection (unit-tested)
  combat/lockOnSystem.ts reticle + switching
  enemies/parshendi.ts   placeholder warriors (no AI yet)
  world/                 plateau generation, props, lighting
tests/                   vitest unit tests (`npm test`)
```

Stack: Three.js, Rapier (physics), TypeScript, Vite, lil-gui.
