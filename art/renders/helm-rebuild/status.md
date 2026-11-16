# Helm and collar rebuild: status (agent 8673)

- Baseline `before-8673` (main GLB at branch start): helm-front 0.982 / 0.971 / 0.998, helm-side 0.979 / 0.902 / **0.983**; plate-front 0.924 / 0.831 / 0.773; plate-side 0.930 / 0.714 / 0.484.
- Intermediate `after3-8673` (first PR pass): helm-side trim F **0.952** — jaw/crown `rx` flare and wider visor envelope pushed enamel outside the helm-side silhouette mask.
- Shipped `after-final-8673`: helm-front 0.982 / 0.971 / 0.998, helm-side 0.979 / 0.902 / **0.983** (trim regression fixed); plate-front 0.925 / 0.823 / 0.772; plate-side 0.923 / 0.693 / **0.502**; plate-back 0.920 / 0.726 / 0.696.
- **Helm/collar geometry (keeps trim scores):** gorget back profile row + shallower front V; gambeson strip at rim sides; back `plate_dark` fill under nape; helm visor kept on reference-traced trim (no hull flare / no visor width change).
- **Body:** side flank belt enamel via measured `ref_path`; fauld back depth; tasset splay/thickness; pauldron crown/depth.
- **Judge 3× (intersection):** visor still reads boxy vs painted wedge; gorget V can hide chin in tight front cameras; in-game shader ≠ painted cel (expected). Back neck void addressed with gorget fill strip.
- Sheets: `art/renders/compare/sheet-before-vs-after-final-8673.png`, `art/renders/head/pair-final-8673.png`, `art/renders/shardplate/in-game/sheet.png`.