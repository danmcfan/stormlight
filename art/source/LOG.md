# Concept art log

One row per generated image: where it is, the verdict, and the billed cost.
How images are generated: `docs/art.md`.

| Image | Result | Cost |
|---|---|---|
| `art/source/plateau-noon/nb21-v1` | Good composition; photographic; rope bridge; melon rockbuds | $0.039 |
| `art/source/plateau-noon/nb21-v2` | **Painterly and bright: the look to follow.** Rockbuds and chrysalis right; bridge too short, reads as a bench | $0.041 |
| `art/source/shardbearer-closeup/nb21-v1` | Style matches v2 (reference works). Plate convincing; Stormlight reads as grey smoke; Blade looks like a generic knight's sword | $0.039 |
| `art/source/shardbearer-closeup/nb21-v2` | Stormlight now glows ✅. Blade has wavy flared edges but still a cross-guard and leather grip; blade cropped by the frame | $0.039 |
| `art/source/shardblade-sheet/nb21-v1` | **Distinct Shardblade design** ✅: crescent hooks instead of a crossguard, flame-wave edge, hooked tip, sapphire pommel, condensation. Scale too small next to the gauntlet; glyphs read as runes | $0.043 |
| `art/source/shardblade-side/nb21-v1` | **Construction ref** ✅: horizontal side view, design kept, plain background. Etched line still reads as runes | $0.042 |
| `art/source/shardplate-front/nb21-v1` | **Construction ref** ✅: symmetric front view with fauld, chest gem, knee cops. Outlined/cel look (fine for modelling); very stocky proportions; dark under-layer shows at joints | $0.039 |
| `art/source/shardplate-side-back/nb21-v1` | **Construction ref** ✅: side and back views consistent with the front (same pauldron discs, fauld, trim). Side view slightly turned, not a pure profile; legs still short | $0.039 |
| `art/source/shardplate-helm/nb21-v1` | **Construction ref** ✅: helm front and side with gorget; visor, ridge and trim lines clear | $0.039 |
| `art/source/plate-gauntlet/nb21-v1` | Part sheet (round 2, for modelling detail): gauntlet back of hand + thumb side, fingers closed round a grip ✅ | $0.043 |
| `art/source/plate-pauldron/nb21-v1` | Part sheet: pauldron front + outside: dome, horn flange, disc boss, three lames ✅ | $0.048 |
| `art/source/plate-leg/nb21-v1` | Part sheet: leg front + outside: thigh plate with trim stripe, knee cop, greave, sabaton with heel ✅ | $0.045 |
| `art/source/plate-helm-34/nb21-v1` | Part sheet: helm with collar, three-quarter and side (asked for back): crown trim lines, curved slit, rivets, cheek plate ✅ | $0.045 |
| `art/source/plate-waist/nb21-v1` | Part sheet: belt, shield-shaped tassets, four rows of leaf plates, front + side ✅ | $0.042 |
| `art/source/shardplate-34/nb21-v1` | Whole suit (asked for three-quarter, came out nearly frontal); consistent with the front reference | $0.047 |
| `art/source/*/trellis-v1` | Image-to-3D with `fal-ai/trellis` on one view of each sheet above (`scripts/gen/fal_run.py`), 6 runs. Good shapes for the helm + collar, gauntlet and waist; leg came out as a pair of legs. At game budgets (≈2k triangles a piece) the meshes are lumpy and the trim (recovered from the texture, `trellis_part.py`) breaks into fragments: the helm scored worse than the scripted one (IoU 0.87 / 0.80 vs 0.92 / 0.91). Used as shape guides only | $0.12 (est.) |
