# Helm and collar rebuild: status (agent 8673)

- Picked up the paused `helm_collar.py` rebuild: hull helm is live in `public/models/shardplate.glb`.
- Baseline `before-8673`: helm-front 0.982 / 0.971 / 0.998, helm-side 0.979 / 0.902 / 0.983.
- Pass `after3-8673`: helm-front 0.981 / 0.977 / 0.998, helm-side 0.979 / 0.899 / 0.952; helm 2185 tris, gorget 1212 tris; total ~35.0k.
- Changes: deeper/wider visor recess, glow pushed back; crown/jaw silhouette nudge; helm pad extended; gorget inner neck + gambeson band under the helm opening (plate-helm-34).
- Renders: `art/renders/head/pair-8673.png`, `art/renders/compare/helm-*-after3-8673.png`, `art/renders/ingame/idle-{front,side}.png`.
- Judge (3× intersection): side view still shows a metal gap between helm lame and gorget rim (references disagree on how wide the dark neck reads; plate-helm-34 wants visible gambeson). Visor Stormlight still catches sun at gameplay angles.
- Body plate trim unchanged (side trim F still ~0.48); next round per original brief.