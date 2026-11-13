# Rounds: Shardplate against its construction references

Target: the whole Plate, at the fixed views `plate-front`, `plate-side`,
`plate-back` (plus `helm-front` / `helm-side` when the helm changes).
References: `art/source/shardplate-front`, `shardplate-side-back`,
`shardplate-helm`, `plate-helm-34`, `plate-*` (all `nb21-v1`); sizes in
`docs/models/shardplate.md`.
Owner files: `scripts/blender/build_shardplate.py` (per-piece functions),
`scripts/blender/helm_collar.py` (helm, collar), `plate_geom.py` (helpers, shared),
`public/models/shardplate.glb` (built, never hand-merged).
Caps: 3 rounds, 2 h (started 2026-11-13 10:06).
Baseline: commit `46519c6`, `art/renders/compare/scores.json` —
front 0.902 / 0.717 / 0.549, side 0.888 / 0.684 / 0.511, back 0.887 / 0.550 / 0.472
(IoU / lines F / trim F).
Best so far: round 1, commit `8005afc` — front 0.914 / 0.781 / 0.734,
side 0.895 / 0.679 / 0.470, back 0.906 / 0.623 / 0.637.

## Decisions
- 10:15 Hired three builders in separate worktrees, one per piece group, rather
  than one agent over the whole file, because the builders are independent
  functions and the alternative serialises 2 h of measuring.
- 10:31 Re-cut the collar rim only 28 mm down at the back, not the 85 mm the art
  review suggested, because the body reference keeps its back rim trim at
  2.10-2.16 m and the deeper dip deleted it (back trim F 0.493 -> 0.432).
- 11:01 Merged builder branches only after re-scoring them on a detached
  worktree with `compare_reference.py`, because two of three had been iterating
  against their own helper, which measures a different region at a different
  scale (one read 0.72 where the shipped score said 0.51).
- 11:13 Resolved every `shardplate.glb` conflict by rebuilding from the merged
  source, never by picking a side of the binary.

## User feedback
Exact words. Close an item only with a render that shows the fix.
- "I need before and after screenshots and a ThreeJS HTML viewer" | round 1 |
  done: `art/renders/head/helm-collar-before-after.png`, `bun run view`
  (`scripts/viewer/`), index at `/`, gallery at `/gallery.html`.
- "Can you update a central index.html file with images and renderings as they
  come in? I want befores and afters." | round 1 | done:
  `scripts/viewer/gallery.html`, pairs by view, updates live.
- "Should we remove these metrics of IoU lines and trim? And just use a 1-10
  score from Opus 5.5?" | round 1 | answered with measurement: three identical
  runs scored 6, 5, 5, so keep the metrics and act on repeated judge defects.
  Recorded in `docs/3d-pipeline.md`.
- "Commit skirt subagent work when done." | round 1 | open: the skirt builder is
  still running; its work is uncommitted in `/tmp/wt-skirt`.

## Round 1
Focus: the helm and collar were mid-rebuild from a paused session; the body
views were the weak numbers (trim F front 0.549, side 0.505, back 0.493).
Changed: `helm_collar.py` — confirmed the paused trim-handle fix, made the eye
slit's recess walls dark and lifted the glow line clear of its backing, rebuilt
the collar on a measured hull layered over the breastplate, and rolled the rim
28 mm at the back. `plate_geom.py` — bisected `th_for`'s angle solve instead of
taking the nearest of 97 samples. Three builders rewrote breastplate/belt trim,
arms and hands, and the fauld and knee cop.
Renders: `art/renders/compare/plate-{front,side,back}.png`,
`art/renders/head/helm-collar-before-after.png`,
`art/renders/compare/helm-{front,side}.png`.
Measured: front 0.902/0.717/0.549 -> 0.914/0.781/0.734; side 0.888/0.684/0.511
-> 0.895/0.679/0.470; back 0.887/0.550/0.472 -> 0.906/0.623/0.637; helm-front
lines F 0.940 -> 0.971 at IoU 0.982.
Judge defects (named by >=2 of 3): lean tassets read as flat slats (3/3); the
side pauldron sits too high and too far back (3/3); the build reads boxy where
the drawing is rounded and swollen (3/3); gauntlets are stubs with fingers
missing (2/3); the gem is too small (2/3). A separate read-only review also
found a torn seam and a level collar rim, both fixed.
Not checked: the side view's trim is still below its baseline (0.511 -> 0.470)
and the cause is structural; no cross-piece decision has been made about which
piece owns the enamel band at the flank.
Next: land the skirt builder's branch; then settle the flank band (torso
breastplate vs tasset), then the tasset leaf splay and the side pauldron.
Stop: no — the round cap is 3 and two of the judge's repeated defects are open.
