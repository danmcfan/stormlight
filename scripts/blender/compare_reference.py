"""Compare the Shardplate and Shardblade models with their references, side by side.

For each reference view, renders the model with an orthographic camera looking
the same way (front, side, back, helm front and side, blade side), puts it on
the references' plain light grey, and scores the silhouettes:

  1. the reference's silhouette mask (trace_silhouette.silhouette_mask: flood
     fill of the plain background from the border)
  2. the model's silhouette mask (the render's alpha)
  3. both cropped to their bounding boxes; the render scaled uniformly so its
     height (blade: length) matches the reference's, bottom-aligned, then slid
     sideways (within 6% of the width) to the best overlap
  4. IoU = overlap / union

Writes art/renders/compare/<view>[-<tag>].png: reference | render | overlay
(grey = both, red = only in the reference, blue = only in the model), and
art/renders/compare/scores[-<tag>].json.

  .venv-blender/bin/python scripts/blender/compare_reference.py [--tag before] [--views plate-front,blade-side] [--fast]

--fast renders 4 samples (silhouettes are exact; shading is noisy).
"""
import argparse
import json
import math
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

ap = argparse.ArgumentParser()
ap.add_argument("--tag", default="")
ap.add_argument("--views", default="")
ap.add_argument("--fast", action="store_true")
ap.add_argument("--out", default=str(ROOT / "art/renders/compare"))
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

BG = 199                      # the references' background grey
OUT = ROOT / args.out if not args.out.startswith("/") else __import__("pathlib").Path(args.out)
OUT.mkdir(parents=True, exist_ok=True)
SRC = ROOT / "art/source"

# Reference pose (read off the front reference): arms hang out from the body,
# feet apart. Only the pose for the comparison; the model is unchanged.
POSE = dict(arm=deg(37), elbow=deg(-29), leg=deg(5))

# view: reference image, crop (x0, x1) or None, camera side, pieces shown, fit axis
VIEWS = {
    "plate-front": ("shardplate-front/nb21-v1/shardplate-front.jpg", None, "front", "plate", "h"),
    "plate-side": ("shardplate-side-back/nb21-v1/shardplate-side-back.jpg", (0, 690), "left", "plate", "h"),
    "plate-back": ("shardplate-side-back/nb21-v1/shardplate-side-back.jpg", (690, 1376), "back", "plate", "h"),
    "helm-front": ("shardplate-helm/nb21-v1/shardplate-helm.jpg", (0, 512), "front", "helm", "helm"),
    "helm-side": ("shardplate-helm/nb21-v1/shardplate-helm.jpg", (512, 1024), "left", "helm", "helm"),
    "blade-side": ("shardblade-side/nb21-v1/shardblade-side.jpg", None, "blade", "blade", "w"),
}
HELM_PIECES = ("helm",)
# The helm sheet draws a much deeper mantle than the body views (whose collar
# is the target), so the helm views compare the helm alone, down to HELM_DEPTH
# below its top (where the sheet's collar starts),
# at a fixed scale: the helm's widest point, 346 px on the sheet, is 0.31 m.
HELM_MPP = 0.31 / 346
HELM_DEPTH = 0.36


def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


# In-game colours (humanoid.ts buildModelledPlate) so the render reads like the game.
PLATE_LOOK = {
    "plate": dict(color=srgb("#7a8796"), metallic=0.55, roughness=0.42),
    "plate_dark": dict(color=srgb("#4d5865"), metallic=0.55, roughness=0.5),
    "trim": dict(color=srgb("#2d55c8"), metallic=0.2, roughness=0.4, emission=srgb("#16348f"), strength=0.6),
}


def restyle(obj):
    for slot in obj.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        look = PLATE_LOOK.get(m.name.split(".")[0])
        if not look:
            continue
        p = m.node_tree.nodes.get("Principled BSDF")
        if not p:
            continue
        p.inputs["Base Color"].default_value = (*look["color"], 1)
        p.inputs["Metallic"].default_value = look["metallic"]
        p.inputs["Roughness"].default_value = look["roughness"]
        if "emission" in look:
            p.inputs["Emission Color"].default_value = (*look["emission"], 1)
            p.inputs["Emission Strength"].default_value = look["strength"]


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    objs = {o.name: o for o in set(bpy.data.objects) - before if o.type == "MESH"}
    for o in objs.values():
        restyle(o)
    return objs


def place(o, pos, roll=0.0):
    """Game body-space position, rolled `roll` about game +z. Game (x, y, z) -> Blender (x, -z, y)."""
    x, y, z = pos
    o.location = (x, -z, y)
    o.rotation_mode = "XYZ"
    o.rotation_euler = (0, -roll, 0)


def pose_plate(objs):
    if "helm_crest" in objs:
        objs.pop("helm_crest").hide_render = True
    W = WAIST_Y
    place(objs["helm"], (0, W + HELM_Y, 0))
    for n in ("gorget", "breastplate", "abdomen"):
        place(objs[n], (0, W, 0))
    place(objs["belt"], (0, W, 0))
    place(objs["fauld_front"], (0, FAULD_Y, FAULD_FRONT_Z))
    place(objs["fauld_back"], (0, FAULD_Y, FAULD_BACK_Z))
    a, e, lg = POSE["arm"], POSE["elbow"], POSE["leg"]
    for s, side in ((1, "l"), (-1, "r")):
        sh = np.array([s * SHOULDER[0], W + SHOULDER[1], 0])
        place(objs[f"pauldron_{side}"], sh)
        place(objs[f"upperarm_{side}"], sh, s * a)
        elbow = sh + UPPER_ARM * np.array([s * math.sin(a), -math.cos(a), 0])
        place(objs[f"forearm_{side}"], elbow, s * (a + e))
        wrist = elbow + LOWER_ARM * np.array([s * math.sin(a + e), -math.cos(a + e), 0])
        place(objs[f"gauntlet_{side}"], wrist, s * (a + e))
        hip = np.array([s * LEG_X, HIP_Y, 0])
        place(objs[f"thigh_{side}"], hip, s * lg)
        if f"tasset_{side}" in objs:
            place(objs[f"tasset_{side}"], (s * TASSET_X, TASSET_Y, 0))
        knee = hip + THIGH * np.array([s * math.sin(lg), -math.cos(lg), 0])
        place(objs[f"shin_{side}"], knee, s * lg)
        ankle = knee + SHIN * np.array([s * math.sin(lg), -math.cos(lg), 0])
        place(objs[f"boot_{side}"], ankle, s * lg)


def setup_render(samples):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.cycles.use_denoising = False
    s.render.film_transparent = True
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("cmp")
    s.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.64, 0.68, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    # Even, frontal-ish light like the references' flat illustration lighting.
    for name, loc, energy in (("key", (2.5, -5, 5), 600), ("fill", (-4, -3, 2), 300), ("top", (0, 2, 7), 250)):
        light = bpy.data.lights.new(name, "AREA")
        light.energy = energy
        light.size = 4
        o = link(bpy.data.objects.new(name, light))
        o.location = loc
        o.rotation_euler = (Vector((0, 0, 1.2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam = link(bpy.data.objects.new("cmp_cam", bpy.data.cameras.new("cmp_cam")))
    cam.data.type = "ORTHO"
    s.camera = cam
    return cam


def visible_bounds(objs):
    pts = []
    for o in objs:
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    a = np.array([tuple(p) for p in pts])
    return a.min(0), a.max(0)


def render(cam, objs, side, size, path):
    bpy.context.view_layer.update()
    lo, hi = visible_bounds(objs)
    c = (lo + hi) / 2
    ext = (hi - lo).max() * 1.08
    d = 20
    loc = {"front": (c[0], c[1] - d, c[2]), "back": (c[0], c[1] + d, c[2]),
           "left": (c[0] + d, c[1], c[2]), "blade": (c[0] - d, c[1], c[2])}[side]
    cam.location = loc
    cam.rotation_euler = (Vector(tuple(c)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = ext
    cam.data.clip_end = 100
    s = bpy.context.scene
    s.render.resolution_x = s.render.resolution_y = size
    s.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    im = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if side == "blade":   # blade along +Z, spine +Y: rotate so the tip points right, spine up
        im = cv2.rotate(im, cv2.ROTATE_90_CLOCKWISE)
    return im, cam.data.ortho_scale / size


def crop_to(mask, img):
    x, y, w, h = cv2.boundingRect(mask)
    return mask[y:y + h, x:x + w], img[y:y + h, x:x + w]


def compare(name, ref_img, ren_rgba, fit, ren_mpp):
    ref_mask, _ = silhouette_mask(ref_img)
    alpha = ren_rgba[:, :, 3]
    a = alpha.astype(np.float32)[:, :, None] / 255
    ren = (ren_rgba[:, :, :3].astype(np.float32) * a + BG * (1 - a)).astype(np.uint8)
    ren_mask = ((alpha > 127) * 255).astype(np.uint8)
    rm, rc = crop_to(ref_mask, ref_img)
    mm, mc = crop_to(ren_mask, ren)
    if fit == "helm":
        k = ren_mpp / HELM_MPP
        d_ref, d_ren = int(HELM_DEPTH / HELM_MPP), int(HELM_DEPTH / ren_mpp)
        rm, rc = crop_to(rm[:d_ref], rc[:d_ref])
        mm, mc = crop_to(mm[:d_ren], mc[:d_ren])
    elif fit == "h":
        k = rm.shape[0] / mm.shape[0]
    else:
        k = rm.shape[1] / mm.shape[1]
    mm = cv2.resize(mm, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    mm = ((mm > 127) * 255).astype(np.uint8)
    mc = cv2.resize(mc, (mm.shape[1], mm.shape[0]), interpolation=cv2.INTER_AREA)
    H = max(rm.shape[0], mm.shape[0])
    W = max(rm.shape[1], mm.shape[1]) + 2 * int(0.06 * rm.shape[1]) + 4
    margin = 20

    def canvas(m, base_x, dx):
        c = np.zeros((H + 2 * margin, W + 2 * margin), np.uint8)
        y0 = margin + H - m.shape[0]
        x0 = margin + base_x + dx
        c[y0:y0 + m.shape[0], x0:x0 + m.shape[1]] = m
        return c, (x0, y0)

    rx = (W - rm.shape[1]) // 2
    A, _ = canvas(rm, rx, 0)
    best = (-1, 0)
    span = int(0.06 * rm.shape[1])
    mx = (W - mm.shape[1]) // 2
    for dx in range(-span, span + 1, 2):
        if mx + dx < 0 or mx + dx + mm.shape[1] > W:
            continue
        B, _ = canvas(mm, mx, dx)
        inter = np.logical_and(A, B).sum()
        uni = np.logical_or(A, B).sum()
        if inter / uni > best[0]:
            best = (inter / uni, dx)
    iou, dx = best
    B, _ = canvas(mm, mx, dx)
    ov = np.full((*A.shape, 3), 235, np.uint8)
    both = np.logical_and(A, B)
    ov[both] = (120, 120, 120)
    ov[np.logical_and(A, ~B.astype(bool))] = (60, 60, 230)     # BGR: red = reference only
    ov[np.logical_and(B, ~A.astype(bool))] = (230, 120, 40)    # blue = model only

    # Colour panels on the same canvas geometry.
    def panel(col, m, x0):
        p = np.full((H + 2 * margin, W + 2 * margin, 3), BG, np.uint8)
        y0 = margin + H - m.shape[0]
        region = p[y0:y0 + m.shape[0], margin + x0:margin + x0 + m.shape[1]]
        region[:] = col[:region.shape[0], :region.shape[1]]
        return p

    left = panel(rc, rm, rx)
    mid = panel(mc, mm, mx + dx)
    if fit == "w":   # long, flat things stack vertically
        sheet = np.vstack([left, np.full((6, left.shape[1], 3), 255, np.uint8), mid,
                           np.full((6, left.shape[1], 3), 255, np.uint8), ov])
    else:
        sheet = np.hstack([left, np.full((left.shape[0], 6, 3), 255, np.uint8), mid,
                           np.full((left.shape[0], 6, 3), 255, np.uint8), ov])
    f = 1400 / sheet.shape[1] if fit == "w" else min(1.0, 2400 / sheet.shape[1], 900 / sheet.shape[0])
    sheet = cv2.resize(sheet, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    bar = np.full((44, sheet.shape[1], 3), 255, np.uint8)
    cv2.putText(bar, f"{name}   reference | model | overlap (red: reference only, blue: model only)   IoU {iou:.3f}",
                (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (30, 30, 30), 1, cv2.LINE_AA)
    return np.vstack([bar, sheet]), float(iou)


def main():
    want = [v for v in (args.views.split(",") if args.views else VIEWS)]
    reset_scene()
    cam = setup_render(4 if args.fast else 48)
    plate = import_glb(ROOT / "public/models/shardplate.glb")
    pose_plate(plate)
    blade = import_glb(ROOT / "public/models/shardblade.glb")
    for o in blade.values():
        o.location = (6, 0, 0)    # out of the Plate's way
    suffix = f"-{args.tag}" if args.tag else ""
    scores_path = OUT / f"scores{suffix}.json"
    scores = json.load(open(scores_path)) if scores_path.exists() else {}
    tmp = ROOT / "art/renders/compare/.tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    for name in want:
        ref, crop, side, group, fit = VIEWS[name]
        shown = {"plate": [o for k, o in plate.items()],
                 "helm": [plate[k] for k in HELM_PIECES],
                 "blade": list(blade.values())}[group]
        for o in list(plate.values()) + list(blade.values()):
            o.hide_render = o not in shown
        ref_img = cv2.imread(str(SRC / ref))
        if crop:
            ref_img = ref_img[:, crop[0]:crop[1]]
        rgba, mpp = render(cam, shown, side, 1400 if group == "blade" else 1000, tmp / f"{name}.png")
        sheet, iou = compare(name, ref_img, rgba, fit, mpp)
        out = OUT / f"{name}{suffix}.png"
        cv2.imwrite(str(out), sheet)
        scores[name] = round(iou, 3)
        print(f"{name:12s} IoU {iou:.3f}  -> {out.relative_to(ROOT)}")
    json.dump(scores, open(scores_path, "w"), indent=1)
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)


main()
