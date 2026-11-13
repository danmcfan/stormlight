# Model viewer and art-pass index

Three pages for judging the art, served together:

```bash
bun run view          # http://localhost:5178/
```

| Page | What |
|---|---|
| `/` | The index: links, and the current comparison scores colour-coded by strength. |
| `/gallery.html` | Every render in `art/renders`, paired **before → after** by view, with the `-profile`/`-detail` passes and the earlier checkpoints nested under each pair. Grows live as renders are written. |
| `/model.html` | The Three.js inspector for the GLBs. |

Point it at subagents' worktrees so their in-progress renders appear too:

```bash
VIEWER_WORKTREES=/tmp/wt-arms,/tmp/wt-torso bun run view
```

Worktree renders are filtered to files newer than the worktree itself (a new worktree
carries a full copy of the history), and `.tmp`/`look-dev` scratch folders are skipped.

## The gallery's pairing rule

A view's files are grouped by a stem with the markers stripped. The **baseline** is
`<view>-before`, the **current** is the untagged `<view>` (what `compare_reference.py`
writes), and `<view>-iterN` files are earlier checkpoints shown in an "earlier" strip.
`<view>-profile` and `<view>-detail` attach to their view as "supporting".

## The model viewer

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

`shot.mjs`, `gallery-shot.mjs` and `index-shot.mjs` capture deterministic shots with
Playwright (needs the server running):

```bash
node scripts/viewer/shot.mjs --model shardplate.glb --tag plate --size 1400x1000
node scripts/viewer/shot.mjs --model shardplate.glb --piece helm --tag helm
node scripts/viewer/shot.mjs --model shardplate.glb --camera 0.9,2.3,1.5 --target 0,2.05,0
node scripts/viewer/gallery-shot.mjs --out art/renders/gallery.png
node scripts/viewer/index-shot.mjs --out art/renders/index.png
```

Note that these pages hold an open `EventSource` for live reload, so the shot scripts
wait for `load` plus a settle, never `networkidle` — that never arrives.

`--piece` isolates a piece and frames it; `--camera` / `--target` place the
camera in body space. Shots go to `art/renders/viewer/` unless `--out` says
otherwise. These are the "check it in the browser" shots for art review; for the
Blender-rendered reference comparisons use `compare_reference.py`, and for the
game itself `scripts/ingame_shots.cjs`.

## Files

| File | What |
|---|---|
| `server.ts` | Bun server: bundles `main.ts`, serves the pages, the repo and the render gallery, watches models and renders, pushes reloads. |
| `index.html` | The art-pass index (links and the scores table). |
| `gallery.html` | Before/after render gallery, grouped and paired by view. |
| `model.html` | The 3D viewer's page. |
| `main.ts` | The viewer: scene, game lighting, materials, piece list, isolation, GUI, live reload. |
| `pose.ts` | Places the Shardplate pieces in body space, as `humanoid.ts` does. |
| `shot.mjs` | Scripted screenshots of the viewer. |
| `gallery-shot.mjs`, `index-shot.mjs` | Scripted screenshots of the two other pages. |

Bun bundles `main.ts` on request (cached until the source changes), so editing the
viewer only needs a browser refresh.
