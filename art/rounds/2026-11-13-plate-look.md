# Rounds: the Shardplate's surface, whole figure

Target: how the whole Plate is painted in game, at the fixed close-up (framed like the
concept close-up), the shade side and the gameplay angle (`scripts/lookdev/plateshot.mjs`),
plus the in-game sheet (`scripts/ingame_shots.cjs`) and an emulated iPhone.
References: `art/source/shardbearer-closeup/nb21-v2` (the bar for how Plate is painted),
`docs/look-brief.md` (Characters; Materials). Owner files: `src/render/platePaint.ts`,
`scripts/blender/plate_bake.py`, the Plate materials in `src/render/humanoid.ts`.
Caps: 1 round, then check in (the user's pattern for this work; "Yes, whole figure").
Builders: none; one subagent fixed the site deploy in parallel (no repo change).
Baseline: commit `413b52d`.
Best so far: round 1 (this commit).

## Decisions
- Painted wear ships as a mask, not colour: the game recolours the Plate per fighter by
  material name (the enemy's bronze, the hit flash), so the GLB carries a baked mask and the
  shader paints it with each fighter's colours.
- Only the plate faces are unwrapped. With every face unwrapped, the trim tubes split into
  thousands of islands and crowded the plates into small corners of the atlas.
- Wear and dust are baked wider than real (2 cm bevel, 5 cm cavity): at the first widths
  (0.8 cm, 2.5 cm) nothing showed at gameplay distance, whatever the strength.
- `scripts/lookdev/acceptance.mjs` already failed on main (shaded Plate saturation 0.313,
  over its 0.30 cap; ratio to lit 3.01, cap 1.3): the pass in `docs/rendering.md` predates
  the rebuilt Plate. Metalness 0.25 -> 0.35 brings the shade to 0.155 (cool grey `#4c4f58`,
  under the cap). The ratio stays at 2.17 because the lit side is now nearly neutral (0.07);
  meeting 1.3 needs metalness 0.4, a dead-grey shade (0.05) that the look brief ("cool
  blue-violet shade") and the judges both reject. Flagged to the user rather than changed.
- The bloom check also fails on main, unchanged here: gem halo 2.68 -> 2.74 radii (cap ~2).
- First paint pass lost the blind judge 1-2 (blotchy brush noise and a rust stain at the crest,
  a chalky warm grey): brushwork 0.22 -> 0.08 with longer strokes, dust 1.3 -> 0.8 in a
  greyer brown, albedo `#9ea6ae` -> `#98a2b0`.

## User feedback
- "Should we work on each piece separately or ... as a whole?" / "Yes, whole figure" |
  round 1 | done: `art/renders/look-dev/plate-paint-before-after.jpg`.
- "Can we have a subagent push current changes to main to get the site deployed?" | round 1 |
  done: every deploy since 04:47 UTC failed at configure-pages (the Pages site was missing,
  then re-enabled outside the repo); a subagent re-ran the newest run, which passed
  (https://github.com/danmcfan/stormlight/actions/runs/43517991335). The uncommitted
  material work was not pushed then.

## Round 1
Focus: the judges' top repeated complaint about the whole figure: one flat, plastic grey with
no value, wear or dust (the concept close-up has folds in shade, worn bright edges, orange
plateau dust in the seams and visible brushwork).
Changed: `plate_bake.py` UV-unwraps the plate faces into one 1024 atlas on every build and
bakes `public/models/shardplate-mask.jpg` (R occlusion, G worn convex edges, B dust cavities;
380 KB). `platePaint.ts` paints it (fold shade 0.7, wear 1.2, dust 0.8, brushwork 0.08, as
look values with a "Plate paint" panel); `assets.ts` loads the mask; `humanoid.ts` paints the
plate material (worn steel / bronze, dust per fighter), metalness 0.35, albedo `#98a2b0`.
New fixed views: `scripts/lookdev/plateshot.mjs`.
Renders: `art/renders/look-dev/plate-paint-before-after.jpg` (the painting, before, after;
then shade before/after and the gameplay angle), `plate-{before,after}-*.png`,
`acceptance-after*`.
Measured (`acceptance.mjs`): shaded Plate saturation 0.313 -> 0.155 (cap 0.30), ratio 3.01 ->
2.17 (cap 1.3, see Decisions); bloom unchanged. Cost: one texture read and ~40 ALU ops per
Plate pixel, one 1024 mask (~4 MB GPU with mips); the user should check frame time on a
phone (key F).
Phone (iPhone 15 Pro landscape, emulated): medium quality, 22 painted meshes on the player,
touch controls visible, no errors.
Judge (3 runs, blind, against the concept close-up): after preferred 3/3. Defects on it, 3/3:
the light has no warm-lit / cool-shaded plane structure, a compressed value range and no
crisp highlights (the weakest thing, all three); the brushwork reads as a faint smudge, not
strokes that follow the plate; the trim is a uniform dark band like a decal. 2/3: the orange
wear and grime are too faint.
Not checked: the Bun viewer (`scripts/viewer`) still shades with its own materials and does
not show the paint.
Next: the Plate's light: a wider value range with a warm lit side and cool shade, and a
painted highlight on plate crowns (stylize.ts treats metal; that is where it lives). Then
brush strokes that follow each plate's direction.
Stop: yes, the cap is 1 round.
