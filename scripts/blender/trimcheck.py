"""Compare the model's `trim` against a reference view's blue enamel, in world metres.

  .venv-blender/bin/python scripts/blender/trimcheck.py --view front,back [--region 1.15,2.15] [--step 0.02]

Renders the plate with an orthographic camera on that side (flat material-ID pass),
maps both masks onto the same world grid (x or z across, height up, metres), and prints:

  - the F-score / precision / recall of the trim at 3 cm, inside the shared torso
  - per height row, the reference spans and the model spans, with each reference span
    marked ok (a model span within 3 cm) or MISS, and each model span that no reference
    span sits near marked EXTRA

This is the same question compare_reference.py's `trim_f` answers, but reported in
metres so a path can be placed from it directly. Use `--width` to limit the region to
the pieces you own; the default 0.45 m half-width takes in the arms and tassets.

`trim_lines.py` is the companion: it prints the reference's enamel as polylines in the
same world metres (skeleton graph, split at junctions), ready to paste into ref_path.
"""
import argparse
import sys

import bpy
import cv2
import numpy as np
from mathutils import Vector

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import ROOT, deg, link, reset_scene  # noqa: E402
from skeleton import (FAULD_BACK_Z, FAULD_FRONT_Z, FAULD_Y, HELM_Y, HIP_Y, LEG_X, LOWER_ARM, SHIN,  # noqa: E402
                      SHOULDER, TASSET_X, TASSET_Y, THIGH, UPPER_ARM, WAIST_Y)
from trace_silhouette import silhouette_mask  # noqa: E402
import compare_metrics as M  # noqa: E402

REF = {
    "front": ("shardplate-front/nb21-v1/shardplate-front.jpg", None, "shardplate-front"),
    "side": ("shardplate-side-back/nb21-v1/shardplate-side-back.jpg", (0, 690), "shardplate-front"),
    "back": ("shardplate-side-back/nb21-v1/shardplate-side-back.jpg", (690, 1376), "shardplate-front"),
}
ap = argparse.ArgumentParser()
ap.add_argument("--view", default="front")
ap.add_argument("--region", default="1.15,2.15")
ap.add_argument("--width", type=float, default=0.45, help="half-width of the marked region, metres")
ap.add_argument("--step", type=float, default=0.02)
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

POSE = dict(arm=deg(45), elbow=deg(-37), leg=deg(5))
ID = {"plate": (0.3, 0.3, 0.3), "plate_dark": (0.05, 0.05, 0.05), "trim": (0.0, 0.0, 1.0), "glow": (0.0, 1.0, 1.0)}


def emat(name, col):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*col, 1)
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


reset_scene()
s = bpy.context.scene
s.render.engine = "CYCLES"
s.cycles.device = "CPU"
s.cycles.samples = 4
s.render.film_transparent = True
s.render.image_settings.color_mode = "RGBA"
s.view_settings.view_transform = "Standard"
s.world = bpy.data.worlds.new("w")
bpy.ops.import_scene.gltf(filepath=str(ROOT / "public/models/shardplate.glb"))
objs = {o.name: o for o in bpy.data.objects if o.type == "MESH"}
objs.pop("helm_crest").hide_render = True
for slot in [sl for o in objs.values() for sl in o.material_slots]:
    if slot.material:
        slot.material = emat("id_" + slot.material.name, ID.get(slot.material.name.split(".")[0], (1, 0, 1)))


def place(o, pos, roll=0.0):
    x, y, z = pos
    o.location = (x, -z, y)
    o.rotation_mode = "XYZ"
    o.rotation_euler = (0, -roll, 0)


W = WAIST_Y
place(objs["helm"], (0, W + HELM_Y, 0))
for n in ("gorget", "breastplate", "abdomen", "belt"):
    place(objs[n], (0, W, 0))
place(objs["fauld_front"], (0, FAULD_Y, FAULD_FRONT_Z))
place(objs["fauld_back"], (0, FAULD_Y, FAULD_BACK_Z))
a, e, lg = POSE["arm"], POSE["elbow"], POSE["leg"]
for sg, side in ((1, "l"), (-1, "r")):
    sh = np.array([sg * SHOULDER[0], W + SHOULDER[1], 0])
    place(objs[f"pauldron_{side}"], sh)
    place(objs[f"upperarm_{side}"], sh, sg * a)
    elbow = sh + UPPER_ARM * np.array([sg * np.sin(a), -np.cos(a), 0])
    place(objs[f"forearm_{side}"], elbow, sg * (a + e))
    wrist = elbow + LOWER_ARM * np.array([sg * np.sin(a + e), -np.cos(a + e), 0])
    place(objs[f"gauntlet_{side}"], wrist, sg * (a + e))
    hip = np.array([sg * LEG_X, HIP_Y, 0])
    place(objs[f"thigh_{side}"], hip, sg * lg)
    if f"tasset_{side}" in objs:
        place(objs[f"tasset_{side}"], (sg * TASSET_X, TASSET_Y, 0))
    knee = hip + THIGH * np.array([sg * np.sin(lg), -np.cos(lg), 0])
    place(objs[f"shin_{side}"], knee, sg * lg)
    ankle = knee + SHIN * np.array([sg * np.sin(lg), -np.cos(lg), 0])
    place(objs[f"boot_{side}"], ankle, sg * lg)

bpy.context.view_layer.update()
pts = []
for o in objs.values():
    if not o.hide_render:
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
A = np.array([tuple(p) for p in pts])
lo, hi = A.min(0), A.max(0)
c = (lo + hi) / 2
ext = (hi - lo).max() * 1.08
d = 20
loc = {"front": (c[0], c[1] - d, c[2]), "back": (c[0], c[1] + d, c[2]),
       "side": (c[0] + d, c[1], c[2]), "left": (c[0] + d, c[1], c[2])}[args.view]
cam = link(bpy.data.objects.new("c", bpy.data.cameras.new("c")))
cam.data.type = "ORTHO"
cam.data.clip_end = 100
cam.location = loc
cam.rotation_euler = (Vector(tuple(c)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
cam.data.ortho_scale = ext
s.camera = cam
size = 1400
s.render.resolution_x = s.render.resolution_y = size
bpy.context.view_layer.update()
MPP = ext / size
right = Vector(cam.matrix_world.col[0][:3])
up = Vector(cam.matrix_world.col[1][:3])
AXIS = size / 2 + (Vector((0, 0, 0)) - Vector(loc)).dot(right) / MPP
GROUND = size / 2 - (Vector((0, 0, 0)) - Vector(loc)).dot(up) / MPP
s.render.filepath = "/tmp/trimcheck-id.png"
bpy.ops.render.render(write_still=True)
im = cv2.imread("/tmp/trimcheck-id.png", cv2.IMREAD_UNCHANGED)
b, g, r = im[..., 0].astype(int), im[..., 1].astype(int), im[..., 2].astype(int)
model_trim = ((b > 170) & (g < 90) & (r < 90)).astype(np.uint8) * 255
model_mask = (im[..., 3] > 127).astype(np.uint8) * 255

h0, h1 = (float(v) for v in args.region.split(","))
# Both masks on a world grid: 5 mm per cell, x from -0.90..0.90, y from 0..2.40.
RES = 0.005
NX, NY = int(2.4 / RES), int(2.4 / RES)
gx = (np.arange(NX) - NX / 2) * RES


def to_world(mask, axis, mpp, ground):
    """Resample a camera mask onto the world grid (columns gx, rows 0..2.4 m)."""
    out = np.zeros((NY, NX), np.uint8)
    for i in range(NY):
        h = i * RES
        row = int(round(ground - h / mpp))
        if not (0 <= row < mask.shape[0]):
            continue
        cols = np.arange(NX)
        src = np.round(axis + gx / mpp).astype(int)
        ok = (src >= 0) & (src < mask.shape[1])
        out[i, ok] = mask[row, src[ok]]
    return out


mw_trim = to_world(model_trim, AXIS, MPP, GROUND)
mw_mask = to_world(model_mask, AXIS, MPP, GROUND)

ref, crop, _ = REF[args.view]
img = cv2.imread(str(ROOT / "art/source" / ref))
if crop:
    img = img[:, crop[0]:crop[1]]
rmask, _ = silhouette_mask(img)
ys, xs = np.where(rmask > 0)
ry0, ry1 = int(ys.min()), int(ys.max())
rmpp = 2.37 / (ry1 - ry0 + 1)
rband = np.where(rmask[int(ry1 - 1.8 / rmpp):int(ry1 - 1.2 / rmpp)] > 0)
raxis = float(np.median(rband[1])) + 0.5
rtrim = cv2.bitwise_and(M.ref_trim_mask(img), rmask)
rw_trim = to_world(rtrim, raxis, rmpp, ry1)
rw_mask = to_world(rmask, raxis, rmpp, ry1)

rows = (np.arange(NY) * RES >= h0) & (np.arange(NY) * RES <= h1)
cols = np.abs(gx) < args.width
region = np.zeros((NY, NX), bool)
region[np.ix_(rows, cols)] = True
interior = cv2.erode(cv2.bitwise_and(rw_mask, mw_mask), np.ones((9, 9), np.uint8)) > 0
sel = region & interior
r_pts, m_pts = (rw_trim > 0) & sel, (mw_trim > 0) & sel
if r_pts.sum() and m_pts.sum():
    dt_r = cv2.distanceTransform(255 - (rw_trim > 0).astype(np.uint8) * 255, cv2.DIST_L2, 3)
    dt_m = cv2.distanceTransform(255 - (mw_trim > 0).astype(np.uint8) * 255, cv2.DIST_L2, 3)
    tol = 0.03 / RES
    rec = float((dt_m[r_pts] <= tol).mean())
    pre = float((dt_r[m_pts] <= tol).mean())
    f = 0 if rec + pre == 0 else 2 * rec * pre / (rec + pre)
    print(f"{args.view}: trim  F {f:.3f}  precision {pre:.3f}  recall {rec:.3f}   "
          f"ref px {int(r_pts.sum())}  model px {int(m_pts.sum())}")
else:
    print(f"{args.view}: no overlap")


def spans(mask_row, lim=0.45):
    cs = np.where(mask_row > 0)[0]
    if not len(cs):
        return []
    out, st = [], cs[0]
    for a, b in zip(cs, cs[1:]):
        if b - a > 2:
            out.append((st, a))
            st = b
    out.append((st, cs[-1]))
    return [((p - NX / 2) * RES, (q + 1 - NX / 2) * RES) for p, q in out
            if abs(((p + q) / 2 - NX / 2) * RES) < lim]


for i in range(NY):
    h = i * RES
    if not (h0 <= h <= h1) or abs((h * 200) % 1) > 1e-6:      # 5 mm steps
        continue
    if abs((h * 100) % 2) > 1e-6:                             # print every 2 cm
        continue
    rs, ms = spans(rw_trim[i]), spans(mw_trim[i])
    line = f"{h:5.2f} "
    for a, b in rs:
        mid = (a + b) / 2
        near = min((abs(mid - (p + q) / 2) for p, q in ms), default=9)
        line += f"[{a:+.3f},{b:+.3f}]{'ok' if near <= 0.03 else 'MISS'} "
    for p, q in ms:
        mid = (p + q) / 2
        near = min((abs(mid - (a + b) / 2) for a, b in rs), default=9)
        if near > 0.03:
            line += f"<EXTRA {p:+.3f},{q:+.3f}> "
    print(line)
