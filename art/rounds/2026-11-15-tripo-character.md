# Rounds: a whole generated Shardbearer (Tripo) against the scripted Plate

Target: does one generated, textured character look better in game than the scripted 24-piece
Plate, with combat and animation unchanged? Asked by the user ("I mean literally generating a
complete character using Tripo3D").
References: `art/source/shardplate-front`, `shardplate-side-back` (`nb21-v1`).
Owner files: `scripts/blender/build_tripo_plate.py`, `public/models/shardplate-tripo.glb` (new);
`src/render/assets.ts` (the `?plate=tripo` switch) and `src/render/humanoid.ts` (`buildModelledPlate`:
the `tripo` material only). The scripted Plate stays the default.
Caps: one test, then check in. Paid: 2 runs, $1.20 (est.), both approved.
Baseline: commit `86d3cae`, the scripted Plate.

## Decisions
- No paid rigging or generated animation: `moves.ts` keyframes drive both the swing and the hit
  capsule, so the generated mesh is cut into the scripted Plate's pieces (same names, same joint
  origins) and the procedural animation drives it unchanged. Rigid, no skinning.
- The mesh is fitted to the scripted Plate in compare_reference's pose (arms 45, elbows -37, legs
  5), where the references, the scripted Plate and the skeleton agree; each face goes to the
  nearest posed bone capsule, with rules for the fauld (between the legs), tassets (outer thigh
  fronts) and boots (below 0.13 m); limbs are then un-posed to hang straight down.
- Tripo's view slots: the "left" slot takes the view where the figure faces image-left. Run 1 had
  them the other way and built a second front on the back (`docs/3d-pipeline.md`).
- Material: Tripo's metalness map reads as mirror steel and went near-black in game, so the
  material's metalness is 0.35 (the scripted Plate's), its colour lifted 1.8x to the scripted
  slate, and it draws double-sided so the cut edges show a dark inside rather than see-through
  cracks (they were white slivers at the knees and pauldrons).
- The raw meshes (68 MB each) are git-ignored: the deploy pulls every LFS file.

## Round 1
Changed: `build_tripo_plate.py` (fit, decimate 1.90M -> 40k triangles, 2K textures, normal map
baked from the full mesh, cut into pieces); `?plate=tripo` in `assets.ts`; a per-fighter copy of
the `tripo` material in `humanoid.ts` (hit flash, bronze tint on the enemy); `--query` on
`ingame_shots.cjs`.
Renders: `art/renders/tripo/ingame/sheet.png` (Tripo) and `art/renders/tripo/ingame-scripted/sheet.png`
(scripted, same commit); pieces coloured by bone `art/renders/tripo/build-pieces.png`; phone
`art/renders/tripo/iphone-landscape.png`.
In game: no errors on desktop or the emulated iPhone 15 Pro landscape; touch controls visible.
2.5 MB GLB (the scripted Plate is about 1 MB plus its mask).
Judge (3 blind A/B runs, sides shuffled, both references given): scripted holds together better
3/3; Tripo is closer to the reference's detail 3/3 (trim, chest vee, leaf fauld, crest horns, gem).
Tripo defects 3/3: pauldron undersides torn, toothed and see-through (the arm that wrapped under
them at 45 degrees now hangs); loose shards at the fauld and tassets in motion; the dark gloves
read as black voids. Scripted defects 2-3/3: plain plastic-looking material, oversized blobby
pauldrons, the tasset blades fanning out in the sprint, blobby boots.
Not checked: frame time on a real phone; the gem and visor do not glow (no emissive mask yet).
Verdict against the proposal's bar (judge prefers it in game 2/3, no tearing): not met.
Next, if continued (free): give the upper arm's top to the pauldron and drop small islands per
piece; close each piece's open cut with a cap; lift the gloves; an emissive mask for the gem and
visor. Then rejudge. | Stop: yes, the cap is one test.
