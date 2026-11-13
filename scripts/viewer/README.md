# Model viewer

A Three.js inspector for the GLBs in `public/models`, with live reload on rebuild.
It is a dev tool, not part of the game build.

```bash
bun run view          # http://localhost:5178/
```

## What it does

- **Loads any GLB** in `public/models` (the list is read from the directory), so a
  new model appears in the dropdown without editing anything.
- **Shows the game's shading.** Materials come from `src/render/humanoid.ts`
  (plate / plate_dark / trim / glow, player colours) and the light from
  `src/render/look.ts` (sun colour, intensity, elevation, azimuth; sky/ground
  hemisphere; exposure), so what you judge is what ships. "game materials" off
  shows the GLB's own materials for comparison.
- **Poses the Plate.** The Shardplate stores each piece relative to its own joint
  (the game parents them to bone groups), so a raw GLB is a pile at the origin.
  `pose.ts` reproduces `buildModelledPlate`'s placement, with sliders for arm
  abduction, elbow and leg splay. Constants are copied from `humanoid.ts`.
- **Lists pieces** with their triangle counts, and clicking one isolates it, which
  is how you check a single rebuilt piece (the helm, the collar) on its own.
- **Live reloads.** The Bun server watches `public/models/*.glb` and pushes a
  server-sent event; the open tab reloads the model and keeps the camera where
  you left it, so an iterative Blender rebuild can be watched in place.
- Wireframe and flat shading toggles, and a 1 m grid for scale.

## Screenshots

`scripts/viewer/shot.mjs` captures a deterministic shot with Playwright (needs the
server running):

```bash
node scripts/viewer/shot.mjs --model shardplate.glb --tag plate --size 1400x1000
node scripts/viewer/shot.mjs --model shardplate.glb --piece helm --tag helm
node scripts/viewer/shot.mjs --model shardplate.glb --camera 0.9,2.3,1.5 --target 0,2.05,0
```

`--piece` isolates a piece and frames it; `--camera` / `--target` place the
camera in body space. Shots go to `art/renders/viewer/` unless `--out` says
otherwise. These are the "check it in the browser" shots for art review; for the
Blender-rendered reference comparisons use `compare_reference.py`, and for the
game itself `scripts/ingame_shots.cjs`.

## Files

| File | What |
|---|---|
| `server.ts` | Bun server: bundles `main.ts`, serves the page and the repo, watches the GLBs, pushes reloads. |
| `main.ts` | The viewer: scene, game lighting, materials, piece list, isolation, GUI, live reload. |
| `pose.ts` | Places the Shardplate pieces in body space, as `humanoid.ts` does. |
| `shot.mjs` | Scripted screenshots. |

Bun bundles `main.ts` on request (cached until the source changes), so editing the
viewer only needs a browser refresh.
