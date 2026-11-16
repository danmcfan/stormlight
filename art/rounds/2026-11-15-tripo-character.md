# Rounds: a whole generated Shardbearer (Tripo) against the scripted Plate

Target: does one generated, textured character look better in game than the scripted 24-piece
Plate, with combat and animation unchanged? Asked by the user ("I mean literally generating a
complete character using Tripo3D").
References: `art/source/shardplate-front`, `shardplate-side-back` (`nb21-v1`).
Owner files: `scripts/blender/build_tripo_plate.py`, `public/models/shardplate-tripo.glb` (new);
`src/render/assets.ts` (the `?plate=tripo` switch) and `src/render/humanoid.ts` (`buildModelledPlate`:
the `tripo` material only). The scripted Plate stays the default.
Caps: one test, then check in; round 2 (skinning) asked for by the user ("Yes, skin it"). Paid: 2 runs, $1.20 (est.), both approved.
Baseline: commit `86d3cae`, the scripted Plate.

## Decisions
- No paid rigging or generated animation: `moves.ts` keyframes drive both the swing and the hit
  capsule, so the generated mesh is cut into the scripted Plate's pieces (same names, same joint
  origins) and the procedural animation drives it unchanged. Rigid pieces in round 1; in round
  2, one skin bound to those same animated nodes.
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

## Round 2: skinned to the game skeleton
Focus: the tearing all three judges named, because the cut pieces split at every joint.
Changed: `build_tripo_plate.py` no longer cuts. It welds the vertices the glTF import split along
UV seams (31,640 -> 29,418), labels each vertex by nearest posed bone, makes small loose shells
(fauld leaves, rivets) follow one bone, diffuses the weights three edge rings across each joint
(24% of vertices blend), and exports one skinned mesh plus empty nodes named for the pieces and
each bone's reference-pose frame (`refFrames`). `humanoid.ts` (`bindPlateSkin`) binds that skin to
the pieces' animated nodes with each frame's inverse as the bind inverse, so the procedural
animation, the fauld and tasset swing and the pauldron follow drive it unchanged.
Renders: `art/renders/tripo/ingame-skinned/sheet.png` against `ingame-scripted/sheet.png`;
weights by bone `art/renders/tripo/build-weights.png`; phone `iphone-landscape-skinned.png`.
In game: no errors on desktop or the emulated iPhone 15 Pro landscape; touch controls visible.
3.0 MB GLB. `npm test` 75/75.
Judge (3 blind A/B runs, sides shuffled): overall Tripo 1/3 (was 0/3); closer to the reference
3/3 again. Idle front, guard, enemy and game camera now mostly go to Tripo; idle side, heavy and
sprint still go to the scripted Plate. Tripo defects 3/3: the shoulder and armpit still tear and
shard in the big arm swings (side, heavy, sprint), where the arm turns furthest from the
reference pose's 45 degrees; the fauld leaves stretch into shards in the sprint. 2/3: glossy
finish with dark blotches, near-black gloves.
Next: generate the references and the mesh arms-down (the game's rest pose), so the shoulder
blends a small turn instead of 45 degrees; weight the fauld leaves to the fauld nodes only, no
blend to the thighs; a matte finish and lighter gloves. | Stop: yes, check in with the user.

## Round 3: shoulder, skirt and finish (free fixes)
Asked by the user ("Yes, free fixes") after the arms-down references failed: two Nano Banana
runs ($0.083 of a $1.00 budget, `art/source/shardplate-front-down/`) kept Image 1's pose both
times. With 1.5 m pauldrons and the shoulder joint 0.42 m out, the arms angle ~45 degrees to clear
the plate, so the pose comes with the design. It would not have helped anyway: the game never
rests the arms hanging (IK keeps the right hand on the grip, the left on the hilt or out).
Changed: `build_tripo_plate.py`: the fauld and tassets take no weight from the legs and the legs
none from them; loose leaves above the knee leave the thigh bones; the darkest paint (gloves,
padding, the painted ink lines; 26% of texels) lifted toward dark leather. `humanoid.ts`: the
`tripo` material's roughness x1.6.
Tried and reverted: passing the pauldron's lower lames to the upper arm, and the pauldron
following 55% of the arm's turn (was 30%). Both caved the pauldron in at idle, where the arm is
far from the reference pose's 45 degrees.
Renders: `art/renders/tripo/ingame-r3/sheet.png`; phone `iphone-landscape-r3.png`.
In game: no errors on desktop or the emulated iPhone; touch controls visible. `npm test` 75/75.
Judge (3 blind A/B runs, sides shuffled): overall Tripo 2/3 (round 2: 1/3, round 1: 0/3); closer
to the reference 3/3. Tripo defects 3/3: the skirt leaves read as shards when the game's skirt
swing fans them out (sprint, heavy, guard; the scripted skirt fans the same way and was called
"blades"); the pauldron underside tears, worst on the enemy; still glossy. Scripted defects 3/3:
generic, simplified suit (round helm, blob boots, plain pauldrons), plastic finish.
Next: tune the skirt swing for the generated Plate (smaller fan, the leaves overlapping); a dark
lining under the pauldron; a matte finish in the stylizer's terms; the gem and visor glow.
| Stop: yes, check in with the user.
