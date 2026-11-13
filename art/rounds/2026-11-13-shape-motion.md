# Rounds: the Shardplate's shape and the Shardbearer's motion

Target: the Plate's shape at the fixed views `plate-front`, `plate-side`, `plate-back` (helm views
checked for regressions), and the Shardbearer's motion in `scripts/lookdev/motionstrip.mjs`
strips (run, sprint, light cut, heavy thrust, guard) and the in-game sheet.
References: `art/source/shardplate-front`, `shardplate-side-back`, part sheets `plate-*`
(`nb21-v1`); sizes in `docs/models/shardplate.md`; `docs/look-brief.md` (Characters: "silhouette
and motion matter most").
Owner files: `scripts/blender/build_shardplate.py`, `helm_collar.py` (collar), `plate_geom.py`
(`leaf`), `src/render/humanoid.ts` (rig and procedural animation), `src/combat/moves.ts`.
Brief (the user's answers): all four shape areas (fauld, gauntlets, torso and collar, knees and
sabatons); animation may retune blade arcs; one at a time in this session, shape first; 1
round, then check in; push each round.
Baseline: commit `3f81b92`. Best so far: round 1 (this commit).

## Decisions
- Blade arcs: the new keys go only in each Shardbearer sword move's windup (an anticipation
  key: blade cocked further, torso wound tighter) and recovery (an overswing key). The blade is
  only tested against opponents in the active frames, so this makes swings read heavier without
  moving a hit. Checked: the blade pose on all 380 active-frame samples of every move is
  identical to the old one (worst difference 0); 1,046 windup/recovery samples changed. The
  user allowed retuning the hitting part too; left for after a playtest.
- The hips turn in a new `pelvis` group (legs, belt, fauld, tassets) under `body`, because the
  weapon hangs from `body`: turning `body` would carry the visible blade off its hit segment.
- Fauld: 20% wider leaves closed the columns up but cost the front view 0.013 of lines F; kept
  the measured widths. A 0.22 m hip cylinder turned the outer leaves edge-on (spikes); 0.32.
- Leg trim: the toe-cap band and the sabaton cuff band each cost front/back trim F (the
  drawings put no enamel there; the front's ankle band is the greave's); both removed.
- `scores.json`'s helm-side trim F (0.983) was stale: the committed model at `3f81b92` scores
  0.963 too, the same as now.

## Round 1
Focus: the shape faults three judge panels kept naming (spiky fauld, stick fingers, flat slab
torso with a forward collar, blobby knees and feet) and the motion faults read off the before
strips (a statue on paddling legs in the run; attacks all arm, no step or hip; a raised sword
arm passing up under the fixed pauldron).
Changed, shape:
- Fauld: scales with straight sides, gothic-arch tips (`leaf(..., ogive=True)`), 2.2 cm thick
  with a centre ridge, on a 0.32 m hip cylinder, over a dark padded backing panel front and back.
- Gauntlets: fingers 35% wider, rounded, with a cap at every joint; the knuckle row runs
  diagonally across x and z so the front and side views both see a broad hand.
- Torso: the chest's front pulled in ~2 cm over 1.40-1.76 m and sloped back to 0.33 / 0.30 at
  1.86 / 1.94 (the side view's front edge had stood 2-3 cm proud low and 5-9 cm at the collar);
  the collar rows follow it, kept ~1.5 cm proud so the surfaces don't tear; back +2 cm.
- Legs: the thigh stops 0.36 below the hip over a widened dark knee pad, which shows as the
  back view's level band; greaves end at 0.15 m with a flared lip over dark ankle padding and a
  front ridge; sabatons lower over the instep with a separate toe cap and thicker lames.
Changed, motion (`humanoid.ts`):
- Run: the hips swing with the striding leg (0.16 rad) while the shoulders counter-turn
  (0.14); the free off hand swings opposite its leg; a heavier footfall bob.
- Attacks: the lead foot steps forward and the rear leg braces bent as the move starts, the
  body drops 6 cm into the active frames, and the hips lead the torso's twist (40%).
- Pauldrons take 30% of their upper arm's rotation, so a raised arm lifts the plate.
- `moves.ts`: anticipation and overswing keys on the seven Shardbearer sword moves (above).
Renders: `art/renders/compare/plate-{front,side,back}.png` (previous kept as `-iter9`),
`art/renders/motion/{before,after}-*.jpg` (new tool: `scripts/lookdev/motionstrip.mjs`).
Measured (full quality, IoU / lines F / trim F): front 0.923/0.835/0.770 -> 0.924/0.831/0.773;
side 0.914/0.692/0.472 -> 0.931/0.710/0.475; back 0.917/0.683/0.647 -> 0.920/0.691/0.653;
helm unchanged (0.982/0.971/0.998, 0.979/0.902/0.963). Front lines F -0.004 is within the fast
renders' run-to-run spread. 30.5k -> 34.8k triangles.
In game: the full in-game sheet (idle, guard, the light combo, heavy, sprint, the enemy, the
game camera) shows the new shapes and stances with nothing broken; emulated iPhone 15 Pro
landscape: no errors, touch controls visible, Plate painted. `npm test` 75/75, the move-data
tests (keys span the move, no jump over 170 degrees) included.
Judge (3 runs, blind; shape A=before/B=after against the drawings, motion A=after/B=before):
shape: after closer 3/3 ("its skirt reads as layered rows, its tassets are shorter and more
wrapped, and its knee cops are chunkier"). Motion: after better 2/3, the third even (after
ahead on the run and thrust, behind on the cut). Repeated defects, 3/3: the gauntlets still
read as thin claws (a plank in profile), not the drawing's chunky fists; the fauld tips still
read as points, not rounded tiled scales; the heavy thrust "hops": a tucked knee at its active
frame instead of a planted lunge, the legs and hips not carrying weight. 2/3: the greaves are
straight tubes and the boots bulbs; the arms look locked in the run.
Fixed after the judge: the hop. The lunge's root motion (2.6 m in 8 frames) read as a sprint to
the run cycle, which tucked the legs; the run and sprint terms now fade out under the attack
stance (`attackBlend`). Re-captured strips: the thrust and the light cut plant both feet through
their active frames; the in-game light, heavy and sprint shots still read right.
Next: the gauntlet (a closed fist at least 1.5x the bulk, a big back-of-hand plate, a flared
cuff), rounder fauld tips (a shorter arch, more even lengths), greave flare and a longer toe
cap; in motion, more weight in the legs and hips (a deeper front knee and a body drop on each
footfall) and a freer arm swing in the run. Then the user's playtest of the arcs.
Stop: yes, the cap is 1 round.
