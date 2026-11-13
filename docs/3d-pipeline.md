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

   **The plate views fit on total model height, so editing the helm moves their
   scores.** The helm's top is the model's tallest point; change it and every
   body view is rescaled, which can swing `plate-front` IoU by ~1.5% with no
   body geometry touched. Judge body work by `--views` and the per-height
   profile (metres), or by comparing runs against a baseline taken on the same
   helm. Comparing a body score across a helm change reads as a regression that
   isn't one.
   **Beware two traps when reading a score:**
   - **Bands vs the whole.** `lines F` / `trim F` are computed over the whole
     silhouette. A helper that scores one height band (a belt, a knee) will
     report a very different number than the shipped `trim_f`, and optimising
     the band can leave the total flat. Check `scores.json`'s figure, not a
     helper's, before claiming a gain.
   - **Region and scale.** The score erodes the shared interior by 2.5 cm and
     measures at the render's own resolution. A helper with its own camera or a
     fixed erosion kernel measures a different region at a different scale, so
     its absolute numbers are not comparable with `scores.json`
     (a hand-rolled tool has read 0.72 where the score says 0.51). Use a helper
     to *locate* defects in metres; use `compare_reference.py` to *judge* a
     gain.

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

   For a fast look at a single piece while iterating, `bun run view` opens the
   model viewer (`scripts/viewer/`, see its README): it shades the GLB with the
   game's materials and light, lists the pieces with triangle counts, isolates
   one on click, and reloads when the build rewrites the file. `node
   scripts/viewer/shot.mjs --piece helm` captures that view to a PNG.

## Judging the art

The scores above measure geometry against the drawings. They cannot see whether it
*reads* right: a seam where two surfaces intersect, a plate that looks flat, trim that
matches in position but sits proud or wrong in colour. Use a vision model for that, but
read the next section before trusting its numbers.

**A 1–10 rating from a vision model is not repeatable enough to optimise against.**
Three identical runs (same images, same prompt, same model) scored the same model 6, 5
and 5. Treat a single rating as ±1, which means a real improvement of half a point is
invisible and a no-op can read as a regression. Never let an agent hill-climb a judged
score.

**The named defects are stable, though.** The same three runs agreed 3/3 on the leaf
tassets reading as flat slats, the side pauldron being oversized, and the build reading
boxy where the drawing is rounded and swollen; 2/3 on the gauntlets being stubs and the
gem being too small. So:

- run the judge **three times**, and
- act on the **intersection** of the defects it names, never on the mean of the numbers.

Use the metrics to find *where* (they localise in metres and are deterministic), and the
judge to find *what looks wrong* (which the metrics cannot see). Neither replaces the
other.

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
  scored and looked worse than the scripted pieces. Use them to measure. A pauldron head-to-head (`pauldron_variants.py`,
  `PAULDRON_VARIANT=trellis|hybrid`) found the same, even fitted to the same box and carrying the
  scripted trim: lower scores in front and back, and a blind judge ranked the scripted piece
  first 3/3 (`art/rounds/2026-11-13-pauldron.md`).
- **Plate paint mask:** `build_shardplate.py` UV-unwraps the plate faces of every piece into
  one atlas and bakes `public/models/shardplate-mask.jpg` (`plate_bake.py`: R occlusion, G
  worn edges, B dust cavities), which the game paints with per-fighter colours
  (`docs/rendering.md`, Plate paint). Every build rebakes it (about a minute), because the
  UVs change with the geometry; the GLB and the mask must ship together.
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
| `shardplate.glb` | `build_shardplate.py` (helpers in `plate_geom.py`; helm and collar in `helm_collar.py`) | `art/source/shardplate-front` (primary), `shardplate-side-back`, `shardplate-helm` and `plate-helm-34` (helm, collar) (`nb21-v1`); part sheets `art/source/plate-*` | 24 rigid pieces, sized from the target table in `docs/models/shardplate.md`; trim placed from measured reference coordinates (`proj` / `ref_path`, with `th_for` bisected rather than sampled). Helm: a hull built through the helm sheet's front and side silhouettes, with the visor (prow, slit cut through, dark recess, glow line), cheek plates, neck-guard lame, crown ridge and rivets lying on it as layers. Collar: a hull through the body references' silhouettes, rim and inset trim bands as bands of that one surface, open in a V at the front, its base layered over the breastplate and its rim rolled down at the back. Barrel chest with the reference's chest arc, rib pairs, abdomen and back trims and a near-edge-to-edge sapphire; belt between two measured edges with the codpiece arch. Shield tassets with an enamel border; four rows of ridged fauld leaves fanned round the hips and tipped out ~24 degrees, which is the depth the side view reads at the hip. Pauldrons: swollen upright domes whose crown leans in toward the neck, a heavy rim band and an arch band along the crest's base, a round-edged crest set in and leaning toward the neck, flat rondels inside the side outline, two lames that each flare out and step over the one below. Vambraces with the reference's two trim bands and stepped outer line, high elbow cop and disc, gauntlets whose hand is built from the front reference's own silhouette (knuckles at h 0.94, fingers curling in under the palm to tips at h 0.73) with a three-plate finger and a two-plate thumb. Knee cops with dipped enamel arcs, greaves with a calf, sabatons with instep lames, rivets, toe cap, heel cup. Enemy-only `helm_crest`. ~30.5k triangles. IoU front 0.923, side 0.914, back 0.917 (trim F 0.770 / 0.472 / 0.647); helm 0.982 / 0.979 (round 1: 0.876 / 0.888 / 0.884, 0.922 / 0.911) |

Per-model reference data (target sizes measured off the references) lives in
`docs/models/`: read `docs/models/shardplate.md` before changing the Plate.
