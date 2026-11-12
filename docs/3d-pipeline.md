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
- **Scripted geometry helpers** in `build_shardplate.py`: `Loft` (stacked
  superellipse sections, smooth between key sections), `ring`/`path` (raised
  trim tubes on a loft's surface), `patch` (a solid plate lying on a loft
  region), `leaf`, `disc`, `ellipsoid`.
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
| `shardplate.glb` | `build_shardplate.py` | `art/source/shardplate-front` (primary), `shardplate-side-back`, `shardplate-helm` (`nb21-v1`) | 24 rigid pieces sized from the front reference's measured silhouette: the stocky build (1.7 m across the arms, 0.34 m thick legs). Helm with glowing slit and centre ridge, high flared collar with a V front, barrel breastplate with hex sapphire and trim V, belt, leaf-plate fauld front/back, tassets hung from the belt, pauldrons with upright horn, disc bosses and two lames, couters + flared vambraces, heavy gauntlets, big knee cops, thick greaves, broad sabatons; enemy-only `helm_crest`. ~26.1k triangles. IoU front 0.876, side 0.888, back 0.884, helm 0.922 / 0.911 (were 0.59 / 0.60 / 0.62 for the body) |

## Shardplate target sizes

Measured off the references on a metric grid (front reference scaled so the
helm top is at 2.37 m; ground = 0; x from the body axis, + = the character's
left; side view z from the hip line, + = forward). Round 2 numbers; the part
sheets in `art/source/plate-*` show the same pieces close up.

| Piece | Front view | Side / back view |
|---|---|---|
| Helm | top 2.37; 0.28–0.30 wide at 2.12–2.20, cheeks flare slightly at 2.06–2.10; eye slit 2.18–2.215, ±0.09, dipping at the centre; faceplate ridge x = 0 from the slit down to ~2.03; two trim lines start together at the crown and run down either side of the faceplate to the cheeks | ~0.36 deep; faceplate juts forward, slit set back; cheek plate edge with three rivets |
| Collar (gorget) | flared rim ±0.25 at 2.07–2.16, open in a V at the front down to 1.93 with the dark under-layer showing; trim on the rim | back: rim at 2.10–2.16, a trim V at 1.95–2.0 below it |
| Gem | hexagonal, centre (0, 1.785), 0.09 wide × 0.15 tall, in a trim-edged setting; trim lines from the collar sides (±0.25, 2.05) to its top | – |
| Breastplate | ±0.37 at 1.55–1.65, ±0.38 at 1.40; chest arc trim (0, 1.69) → (±0.25, 1.60) → (±0.37, 1.50); abdomen lines (±0.13, 1.50) → (±0.16, 1.32) and (±0.30, 1.48) → (±0.32, 1.33); raised centre line 1.69 → 1.36; lower edge a shallow V (±0.38, 1.36) → (0, 1.29) | chest front at z +0.38 (gem); back: yoke arc trim (±0.3, 1.47) → (0, 1.60), two lines down to the belt |
| Belt | 1.22–1.34, ±0.38, trim top and bottom | same at the back |
| Pauldron | dome top 2.06 at x ±0.55; outer rim ±0.73 at 1.80 (trim band); horn flange on the inner edge x ±0.36–0.46, tip 2.22; disc boss centre (±0.33, 1.80), r 0.08; two lames 1.72–1.78 (to ±0.71) and 1.62–1.70 (to ±0.70); dark under-layer below at the armpit 1.55–1.62 | spans z −0.20 … +0.37 (it sits back), top 2.20 |
| Elbow (couter) | disc on the outside at (±0.79, 1.55), r ≈ 0.06; dark under-layer inside the elbow 1.48–1.58 | round cop 1.40–1.56 |
| Vambrace | 1.12–1.45, x ±0.48 … ±0.85 (≈0.37 wide, widest at the top); trim bands 1.38–1.42 and 1.11–1.15; a stepped trim line down the outside | – |
| Gauntlet | cuff 1.08–1.12; hand 1.08 → fingertips 0.78, 0.28 wide; thumb on the inside down to 0.88; four fingers of three plates; dark leather palm | – |
| Tasset | hangs from the belt 1.22 → outer bottom corner (±0.50, 0.87), x ±0.20 … ±0.51; shield shape with a trim border | back: pointed upper inner corner, 1.33 → 0.84 |
| Fauld | four rows of pointed leaves, x ±0.18, rows from 1.20, 1.08, 0.96, 0.84; centre leaf to 0.58; leaves ≈0.07 × 0.20 | side: leaves hang to 0.62 front and back, splayed out |
| Knee cop | 0.52–0.82, x ±0.18 … ±0.46; trim arcs on its top and bottom edges | back: dark under-layer behind the knee 0.60–0.70 |
| Greave | 0.22–0.52, x ±0.18 … ±0.42, narrowing to ±0.20 … ±0.40 at the ankle | z −0.13 … +0.20 |
| Sabaton | 0–0.20, x ±0.16 … ±0.58; toe cap ≈0.12 tall; heel plate with rivets, dark under-layer at the ankle | toe at z ≈ −0.45 (the toes point out) |
