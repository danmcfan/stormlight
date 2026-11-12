# 3D modelling pipeline

Models are built by Python scripts run in headless Blender (`bpy`), from the
construction references in `art/source/` (see `docs/art.md`). Outputs are
GLB files the game loads at startup.

## Setup (once per machine)

```bash
python3 -m venv .venv-blender
.venv-blender/bin/pip install bpy opencv-python-headless pillow
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
4. **Load** it in `src/render/assets.ts` and use it where the placeholder was.

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
  `buildModelledPlate` in step. Exported node transforms are identity (the
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
| `shardblade.glb` | `build_shardblade.py` | `art/source/shardblade-side/nb21-v1` | Traced outline, chamfered edges, ringed two-hand grip, glowing sapphire and etched line. 2.5 m overall, ~3.6k faces |
| `shardplate.glb` | `build_shardplate.py` | `art/source/shardplate-front`, `shardplate-side-back`, `shardplate-helm` (`nb21-v1`) | 22 rigid pieces on the game skeleton (helm with glowing slit, gorget, breastplate with sapphire, abdomen, belt, front/back fauld of leaf plates, pauldrons with discs, upper arms, couters + vambraces, gauntlets, cuisses with tassets, poleyns + greaves, sabatons) plus an enemy-only `helm_crest`. ~22.8k triangles. Renders in `art/renders/shardplate/` (in-game shots in `in-game/`) |
