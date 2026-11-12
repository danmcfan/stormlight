# 3D modelling pipeline

Models are built by Python scripts run in headless Blender (`bpy`), from the
construction references in `art/source/` (see `docs/art.md`). Outputs are
GLB files the game loads at startup.

## Setup (once per machine)

```bash
python3 -m venv .venv-blender
.venv-blender/bin/pip install bpy opencv-python-headless pillow numpy matplotlib scikit-image
```

`bpy` 5.3 needs Python 3.13. On a desktop you can also open any exported GLB in
Blender itself to inspect or hand-edit it.

## Steps for a model

1. **Reference.** A straight-on construction reference on a plain background
   (`art/source/<slug>/`).
2. **Trace** its outline when the shape is essentially flat (blades, axe heads):
   `.venv-blender/bin/python scripts/blender/trace_silhouette.py IMAGE art/source/<slug>/trace/outline.json --smooth 2.5 --epsilon 1.5`
   Check the red overlay written next to the JSON.
3. **Build** with a script in `scripts/blender/` (`build_<model>.py`). It
   writes `public/models/<model>.glb` and preview renders to
   `art/renders/<model>/`. Review the renders before using the model in game.
4. **Compare** it with its references side by side:
   `.venv-blender/bin/python scripts/blender/compare_reference.py [--fast] [--views plate-front,blade-side] [--tag before]`
   renders each reference view with a matched orthographic camera (Plate
   front/side/back, helm front/side, Blade side) and writes
   `art/renders/compare/<view>.png` (reference | model | overlap: red = only in
   the reference, blue = only in the model) and `scores.json` with the
   silhouette IoU. Masks are aligned by height (Blade: length), bottom edges
   together, then slid sideways to the best overlap. The helm views compare the
   helm alone at a fixed scale (the helm sheet draws a much deeper collar than
   the body views). `--fast` (4 samples) is enough for scores while iterating.
   It also writes, per view:
   - `<view>-profile.png`: both silhouettes' extents every 5 cm of height in
     metres from the body axis, and the error per band; `scores.json` lists the
     worst bands as sentences ("at 1.52 m the model's char-left edge is 0.09 m
     inside the reference"). Start here when the IoU drops.
   - `<view>-detail.png` and the **detail scores** `lines_f` / `trim_f`: the
     reference's ink lines and its blue enamel (found by colour) against the
     model's creases and plate edges (edges of flat normal and material-ID
     renders) and its `trim` material, as F-scores (share of lines within 3 cm
     of a line in the other image; 1.5 cm on the helm) and chamfer distances,
     counted only inside both silhouettes. They measure trim lines and plate
     layout, which the IoU can't see.
5. **Load** it in `src/render/assets.ts` and use it where the placeholder was.
6. **Check it in game**: `node scripts/ingame_shots.cjs [--only idle-front,guard]`
   starts Vite, drives the game in headless Chromium (manual time stepping,
   virtual input) and writes shots from cameras placed round the player and
   enemy (idle front/side/three-quarter, guard, each light-combo step, heavy,
   sprint, the enemy Shardbearer, the game camera) to `art/renders/ingame/`,
   gridded into `sheet.png`. About 20 s.

## Conventions

- **Units:** metres. **Axes:** Blender is Z-up; glTF export converts to Y-up
  (Blender +Z → glTF +Y, Blender −Y → glTF +Z).
- **Weapons:** origin at the grip point (the right hand). The blade runs along
  glTF +Y, the cutting edge faces +Z (it leads the swing), and it is thin along
  X. A Shardblade's tip is 1.95 m from the hand, matching the hit segment in
  `src/combat/moves.ts`.
- **Plate:** one mesh per rigid piece, named for the bone it rides on
  (`helm`, `pauldron_l`, `forearm_r`, …), with its origin at that joint in the
  body space of `src/render/humanoid.ts` (+Y up, +Z forward, +X = the
  character's left). No skinning: `HumanoidModel` parents each piece to its
  group, so the procedural animation drives it. The table of pieces, parent
  groups and origins is at the top of `build_shardplate.py`; keep it and
  `buildModelledPlate` in step. The skeleton constants are read from
  `humanoid.ts` by `scripts/blender/skeleton.py`, so the scripts can't drift. Exported node transforms are identity (the
  geometry is already relative to the joint).
- **Material names are an interface.** The game swaps glTF materials for
  per-instance ones by name (`plate`, `plate_dark`, `trim`, `glow`), which
  gives each fighter its own colours (the enemy's bronze) and hit flash.
- **Avoid big flat metal faces.** Under the game's sun, a flat metallic face
  mirrors it as a white patch; give plates some curvature.
- **Scripted geometry helpers** in `plate_geom.py`: `Loft` (stacked
  superellipse sections, smooth between key sections), `ring`/`path` (enamel
  trim: flat bands on a loft's surface), `patch` (a solid plate lying on a
  loft region; its bounds can be functions, for curved or shield outlines),
  `proj` / `ref_path` (trim through points read off a reference view in world
  metres, mirrored), `leaf`, `disc` (domed boss or flat rondel), `ellipsoid`.
- **Image-to-3D** (`trellis_part.py`, tried in round 2): Trellis meshes of the
  part sheets have good shapes but, cut to a game budget, they come out lumpy
  and their trim (traced from the texture) breaks up; the helm and gauntlet
  scored and looked worse than the scripted pieces. Use them to measure.
- **Materials:** Principled BSDF only (exports to glTF PBR). Glow is emission:
  Stormlight blue `(0.5, 0.82, 1.0)`.
- **Storage:** GLBs and renders are Git LFS (`.gitattributes`); the Pages
  deploy checks out LFS files.
- **Previews:** Cycles on the CPU. EEVEE needs a GPU, which cloud containers
  lack, and crashes there.

## Models

| Model | Script | Reference | Notes |
|---|---|---|---|
| `shardblade.glb` | `build_shardblade.py` | `art/source/shardblade-side/nb21-v1` | Traced outline (shrunk by the bevel width so the finished silhouette matches), chamfered edges, two-hand grip, glowing sapphire, diamond boss at the hooks, etched fuller with abstract glyph strokes. 2.5 m overall. Side IoU 0.955 (was 0.897) |
| `shardplate.glb` | `build_shardplate.py` (helpers in `plate_geom.py`) | `art/source/shardplate-front` (primary), `shardplate-side-back`, `shardplate-helm` (`nb21-v1`); part sheets `art/source/plate-*` | 24 rigid pieces, sized from the target table in `docs/models/shardplate.md`; trim paths placed from reference coordinates (`proj` / `ref_path`). Helm: round crown with a flush rib edged in trim that frames the faceplate to a V chin, S-curve cheek trim and rivets, faceted faceplate with a ridge, a dark eye slit (straight top, V bottom) with a thin glowing line. Wide flared collar open in a V over the dark padding. Barrel chest with a faceted sapphire, the reference's chest arc, abdomen and back trims. Belt with a V front, shield tassets, five rows of long ridged fauld leaves. Pauldrons: upright domes, arched flange (the "horn"), flat rondels, two curved lames. Vambraces, high elbow cop and disc, gauntlets with knuckles, three-plate fingers and a thumb closed round the grip (`GRIP_Y`, the game's `PLATE_HAND`). Knee cops with trim, greaves with a calf, sabatons with instep lames, rivets, toe cap, heel cup. Enemy-only `helm_crest`. ~24.9k triangles. IoU front 0.905, side 0.900, back 0.905, helm 0.965 / 0.966 (round 1: 0.876 / 0.888 / 0.884, 0.922 / 0.911) |

Per-model reference data (target sizes measured off the references) lives in
`docs/models/`: read `docs/models/shardplate.md` before changing the Plate.
