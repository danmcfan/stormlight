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

Writes, per view, to art/renders/compare/:
  <view>[-<tag>].png          reference | render | overlay (grey = both, red =
                              only in the reference, blue = only in the model)
  <view>[-<tag>]-profile.png  both silhouettes' left/right (side view: front/
                              back) extents every 5 cm of height, in metres from
                              the body axis, and the edge error per band
  <view>[-<tag>]-detail.png   interior lines (left) and trim (right): the
                              reference's ink lines and blue enamel (found by
                              colour) vs the model's creases / plate edges
                              (edges of flat normal and material-ID passes)
                              and its `trim` material
and scores[-<tag>].json: per view the IoU, the detail F-scores (`lines_f`,
`trim_f`: the share of lines within 3 cm of a line in the other image, 1.5 cm
for the helm, counted only 2.5 cm or more inside both silhouettes), chamfer
distances in cm, the worst profile bands as sentences, and the full profile.

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
import compare_metrics as M  # noqa: E402

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
POSE = dict(arm=deg(45), elbow=deg(-37), leg=deg(5))

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
# Image-left / image-right edges per camera, for the profile.
EDGES = {"front": ("char-right", "char-left"), "back": ("char-left", "char-right"),
         "left": ("front", "back"), "blade": ("spine", "edge")}
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
# Reference colours (the drawings' slate plate and deep indigo enamel), so the sheets compare
# like with like; the game's own colours are tuned for its painterly lighting (humanoid.ts).
PLATE_LOOK = {
    "plate": dict(color=srgb("#6e8293"), metallic=0.45, roughness=0.45),
    "plate_dark": dict(color=srgb("#2b2724"), metallic=0.05, roughness=0.85),
    "trim": dict(color=srgb("#38406f"), metallic=0.2, roughness=0.4),
    "Shardblade steel": dict(color=(0.6, 0.64, 0.7), metallic=0.85, roughness=0.3),
    "Shardblade grip": dict(color=(0.3, 0.32, 0.36), metallic=0.85, roughness=0.4),
    "glow": dict(color=srgb("#a9ccff"), metallic=0.0, roughness=0.3, emission=srgb("#5aa2ff"), strength=2.2),
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
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    # Even, frontal-ish light like the references' flat illustration lighting.
    for name, loc, energy in (("key", (2.5, -5, 5), 420), ("fill", (-4, -3, 2), 200), ("top", (0, 2, 7), 170)):
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


ID_COLOURS = {  # flat emission colours of the material-ID pass (linear; Standard view -> exact sRGB)
    "plate": (0.3, 0.3, 0.3), "plate_dark": (0.05, 0.05, 0.05), "trim": (0.0, 0.0, 1.0), "glow": (0.0, 1.0, 1.0),
}


def emission_material(name, colour=None, normal=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    if normal:   # camera-space normal as colour
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        vt = nt.nodes.new("ShaderNodeVectorTransform")
        vt.vector_type = "NORMAL"
        vt.convert_from, vt.convert_to = "WORLD", "CAMERA"
        mad = nt.nodes.new("ShaderNodeVectorMath")
        mad.operation = "MULTIPLY_ADD"
        mad.inputs[1].default_value = (0.5, 0.5, 0.5)
        mad.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(geo.outputs["Normal"], vt.inputs[0])
        nt.links.new(vt.outputs[0], mad.inputs[0])
        nt.links.new(mad.outputs[0], em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = (*colour, 1)
    return m


_OVERRIDES = {}


def override(objs, mode):
    """Swap every slot's material for a flat pass ('id', 'normal') or back ('shade')."""
    if not _OVERRIDES:
        _OVERRIDES["normal"] = emission_material("pass_normal", normal=True)
        for k, c in ID_COLOURS.items():
            _OVERRIDES[k] = emission_material(f"pass_id_{k}", c)
    for o in objs:
        if "orig_mats" not in o:
            o["orig_mats"] = [s.material.name if s.material else "" for s in o.material_slots]
        for slot, name in zip(o.material_slots, o["orig_mats"]):
            if mode == "shade":
                slot.material = bpy.data.materials.get(name)
            elif mode == "normal":
                slot.material = _OVERRIDES["normal"]
            else:
                slot.material = _OVERRIDES.get(name.split(".")[0], _OVERRIDES["plate"])


def render(cam, objs, side, size, path):
    """Shaded render plus flat material-ID and normal passes; returns (images, metres per px, axis column)."""
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
    bpy.context.view_layer.update()
    mpp = cam.data.ortho_scale / size
    right = Vector(cam.matrix_world.col[0][:3])
    axis = size / 2 + (Vector((0, 0, 0)) - Vector(loc)).dot(right) / mpp   # body axis (x = 0, z = 0) column
    imgs = {}
    samples = s.cycles.samples
    for mode in ("shade", "id", "normal"):
        override(objs, mode)
        s.cycles.samples = samples if mode == "shade" else 4
        s.render.filepath = str(path.with_name(f"{path.stem}-{mode}.png"))
        bpy.ops.render.render(write_still=True)
        im = cv2.imread(s.render.filepath, cv2.IMREAD_UNCHANGED)
        if side == "blade":   # blade along +Z, spine +Y: rotate so the tip points right, spine up
            im = cv2.rotate(im, cv2.ROTATE_90_CLOCKWISE)
        imgs[mode] = im
    override(objs, "shade")
    s.cycles.samples = samples
    return imgs, mpp, axis


def crop_box(mask):
    return cv2.boundingRect(mask)


def flat(rgba, bg=BG):
    a = rgba[:, :, 3].astype(np.float32)[:, :, None] / 255
    return (rgba[:, :, :3].astype(np.float32) * a + bg * (1 - a)).astype(np.uint8)


def compare(name, ref_img, imgs, fit, ren_mpp, axis_px, edge_names):
    ref_mask, _ = silhouette_mask(ref_img)
    shade = imgs["shade"]
    alpha = shade[:, :, 3]
    ren_mask = ((alpha > 127) * 255).astype(np.uint8)
    rx0, ry0, rw, rh = crop_box(ref_mask)
    mx0, my0, mw, mh = crop_box(ren_mask)
    if fit == "helm":
        k = ren_mpp / HELM_MPP
        rh = min(rh, int(HELM_DEPTH / HELM_MPP))
        mh = min(mh, int(HELM_DEPTH / ren_mpp))
        rx0, ry0, rw, rh = (lambda b: (rx0 + b[0], ry0 + b[1], b[2], b[3]))(crop_box(ref_mask[ry0:ry0 + rh, rx0:rx0 + rw]))
        mx0, my0, mw, mh = (lambda b: (mx0 + b[0], my0 + b[1], b[2], b[3]))(crop_box(ren_mask[my0:my0 + mh, mx0:mx0 + mw]))
    elif fit == "h":
        # Fits on total model height. Note this is sensitive to the helm: its top is the
        # tallest point, so editing the helm rescales the whole body comparison. Read the
        # per-height profile (which is in metres) rather than the IoU alone when comparing
        # runs that changed the helm.
        k = rh / mh
    else:
        k = rw / mw
    cmpp = ren_mpp / k                     # metres per canvas pixel
    sw, sh = max(1, round(mw * k)), max(1, round(mh * k))

    def scaled(im, interp):
        return cv2.resize(im[my0:my0 + mh, mx0:mx0 + mw], (sw, sh), interpolation=interp)
    rm = ref_mask[ry0:ry0 + rh, rx0:rx0 + rw]
    rc = ref_img[ry0:ry0 + rh, rx0:rx0 + rw]
    mm = ((scaled(ren_mask, cv2.INTER_AREA) > 127) * 255).astype(np.uint8)
    H = max(rh, sh)
    W = max(rw, sw) + 2 * int(0.06 * rw) + 4
    margin = 20
    CH, CW = H + 2 * margin, W + 2 * margin

    def put(im, x0, fill=0):
        c = np.full((CH, CW) + im.shape[2:], fill, im.dtype)
        y0 = margin + H - im.shape[0]
        c[y0:y0 + im.shape[0], margin + x0:margin + x0 + im.shape[1]] = im
        return c

    rxc = (W - rw) // 2
    A = put(rm, rxc)
    best = (-1, 0)
    span = int(0.06 * rw)
    mxc = (W - sw) // 2
    for dx in range(-span, span + 1, 2):
        if mxc + dx < 0 or mxc + dx + sw > W:
            continue
        B = put(mm, mxc + dx)
        inter = np.logical_and(A, B).sum()
        uni = np.logical_or(A, B).sum()
        if inter / uni > best[0]:
            best = (inter / uni, dx)
    iou, dx = best
    B = put(mm, mxc + dx)
    ov = np.full((*A.shape, 3), 235, np.uint8)
    ov[np.logical_and(A, B)] = (120, 120, 120)
    ov[np.logical_and(A, ~B.astype(bool))] = (60, 60, 230)     # BGR: red = reference only
    ov[np.logical_and(B, ~A.astype(bool))] = (230, 120, 40)    # blue = model only

    left = put(rc, rxc, BG)
    mid = put(flat(scaled(shade, cv2.INTER_AREA)), mxc + dx, BG)
    if fit == "w":   # long, flat things stack vertically
        sheet = np.vstack([left, np.full((6, left.shape[1], 3), 255, np.uint8), mid,
                           np.full((6, left.shape[1], 3), 255, np.uint8), ov])
    else:
        sheet = np.hstack([left, np.full((left.shape[0], 6, 3), 255, np.uint8), mid,
                           np.full((left.shape[0], 6, 3), 255, np.uint8), ov])
    f = 1400 / sheet.shape[1] if fit == "w" else min(1.0, 2400 / sheet.shape[1], 900 / sheet.shape[0])
    sheet = cv2.resize(sheet, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)

    # Interior detail: model trim from the ID pass, creases/plate edges from the ID and normal passes.
    idc = put(scaled(imgs["id"][:, :, :3], cv2.INTER_NEAREST), mxc + dx)
    nrm = put(scaled(imgs["normal"][:, :, :3], cv2.INTER_LINEAR), mxc + dx)
    b, g, r = idc[..., 0].astype(int), idc[..., 1].astype(int), idc[..., 2].astype(int)
    mod_trim = ((b > 170) & (g < 90) & (r < 90)).astype(np.uint8) * 255
    mod_edges = M.model_edges(idc, nrm)
    mod_edges[B == 0] = 0
    ref_canvas = put(ref_img[ry0:ry0 + rh, rx0:rx0 + rw], rxc, BG)
    # Finer tolerance for the helm close-ups (the helm is only 0.31 m wide).
    tol = 0.015 if fit == "helm" else M.TOL
    det, ref_lines, rt, mt, region = M.detail_scores(ref_canvas, A, mod_trim, mod_edges, B, cmpp, tol)
    if fit == "w":   # the Blade has no enamel trim or plate layout to score
        det = {"trim": None, "lines": None, "trim_cover": None}
    lines_f = det["lines"]["f"] if det["lines"] else 0
    trim_f = det["trim"]["f"] if det["trim"] else 0
    bar = np.full((44, sheet.shape[1], 3), 255, np.uint8)
    cv2.putText(bar, f"{name}   reference | model | overlap (red: reference only, blue: model only)   "
                f"IoU {iou:.3f}   lines F {lines_f:.2f}   trim F {trim_f:.2f}",
                (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (30, 30, 30), 1, cv2.LINE_AA)
    detail_img = M.detail_overlay(ref_canvas, ref_lines, cv2.bitwise_or(mod_edges, mt), rt, mt, region,
                                  f"{name} interior lines (left) and trim (right): red = reference only, "
                                  f"blue = model only, purple = both   lines F {lines_f:.2f}  trim F {trim_f:.2f}")

    # Per-height profile (blade: along its length, from the pommel end).
    if fit == "w":
        At, Bt = np.ascontiguousarray(np.flipud(A.T)), np.ascontiguousarray(np.flipud(B.T))
        ys = np.where(A.any(1))[0]
        axis_col = int(ys.mean())
        ground = At.shape[0] - 1 - (margin + rxc)
        rows, worst = M.profile(At, Bt, cmpp, axis_col, ground, edge_names)
    else:
        axis_col = margin + mxc + dx + (axis_px - mx0) * k
        rows, worst = M.profile(A, B, cmpp, axis_col, margin + H - 1, edge_names)
    return np.vstack([bar, sheet]), float(iou), det, rows, worst, detail_img


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
        imgs, mpp, axis = render(cam, shown, side, 1400 if group == "blade" else 1000, tmp / f"{name}.png")
        sheet, iou, det, rows, worst, detail_img = compare(name, ref_img, imgs, fit, mpp, axis, EDGES[side])
        out = OUT / f"{name}{suffix}.png"
        cv2.imwrite(str(out), sheet)
        cv2.imwrite(str(OUT / f"{name}{suffix}-detail.png"), detail_img)
        M.profile_plot(rows, f"{name}: silhouette extents every 5 cm (red reference, blue model)",
                       OUT / f"{name}{suffix}-profile.png", EDGES[side])
        scores[name] = {
            "iou": round(iou, 3),
            "lines_f": det["lines"]["f"] if det["lines"] else None,
            "trim_f": det["trim"]["f"] if det["trim"] else None,
            "detail": det,
            "worst_bands": [w["text"] for w in worst[:10]],
            "profile": rows,
        }
        print(f"{name:12s} IoU {iou:.3f}  lines F {scores[name]['lines_f']}  trim F {scores[name]['trim_f']}"
              f"  -> {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}")
        for w in worst[:6]:
            print("     ", w["text"])
    json.dump(scores, open(scores_path, "w"), indent=1)
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)


main()
