# Helm and collar rebuild: paused 2026-11-13 00:27 (to save usage)

## State
- `scripts/blender/helm_collar.py` (new): a hull built through the helm sheet's
  measured front/side silhouettes, plate regions triangulated on it, flush trim
  bands. `build_helm` in `build_shardplate.py` now calls it.
- The **collar (gorget) is still the old one**; the rebuild hadn't reached it.
- The game model `public/models/shardplate.glb` is the **old, reviewed** one.
  The rebuild's latest output is saved as `wip-shardplate.glb` here (not used
  by the game). Running `build_shardplate.py` now builds the new helm.
- Progress: `progress/001-helm-first-build.png` (first build, before the trim fix).
  Scores at 001: helm-front IoU 0.981 / lines 0.94 / trim 0.995, helm-side
  0.979 / 0.83 / 0.85 (old helm: 0.969 / 0.83 / 0.89 and 0.967 / 0.62 / 0.64).
  Helm 2,077 triangles.
- `status.md`: the step-by-step log. The last change (trim band handedness,
  pad winding, ridge end under the visor) was built but not yet rendered.

## Open issues seen in 001
- Slit reads as a thin glowing line; the drawing's slit is a wide black slot.
- Crown trim was broken into pieces (likely fixed by the 00:26 change; re-render to check).
- Dark padding blocks show below the helm in the close-ups (probably hidden by the collar in game; check).

## Next steps
1. Re-render progress (helm front/side and three-quarter) and check the trim fix.
2. Build the collar from `plate-helm-34`: a standing collar with a front V over
   the dark padding, inset trim along the V, a flared lower edge with a second band.
3. Checkpoint with `compare_reference.py --fast --views helm-front,helm-side,plate-front,plate-side,plate-back`
   (keep plate IoUs >= 0.90), then in-game shots, then review and commit the GLB.
