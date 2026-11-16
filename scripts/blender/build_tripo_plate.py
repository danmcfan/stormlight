"""Cut the generated Tripo Shardbearer into the game's rigid Plate pieces.

Input:  art/source/shardbearer-tripo/tripo-h31-v2/shardbearer-model_urls-pbr_model-model.glb
        (one textured mesh, posed like the construction references) and
        public/models/shardplate.glb (only to fit the mesh to the skeleton).
Output: public/models/shardplate-tripo.glb (loaded with ?plate=tripo) and
        art/renders/tripo/build-*.png

The references, the scripted Plate and the skeleton agree in compare_reference's pose
(arms out 45 degrees, elbows -37, legs 5), so the mesh is fitted to the scripted Plate in that
pose, decimated, given a normal map baked from the full mesh, and cut by nearest posed bone into
the pieces build_shardplate.py makes (same names, same joint origins, limbs un-posed to hang
straight down). The game then parents them exactly as it does the scripted pieces: rigid, no
skinning. Pieces with nothing of their own (gorget, abdomen, helm_crest) are empty nodes.

  .venv-blender/bin/python scripts/blender/build_tripo_plate.py [--tris 40000] [--tex 2048] [--no-bake]
"""
import argparse
import json
import math
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import ROOT, deg, reset_scene  # noqa: E402
from skeleton import (FAULD_BACK_Z, FAULD_FRONT_Z, FAULD_Y, HELM_Y, HIP_Y, LEG_X, LOWER_ARM, SHIN,  # noqa: E402
                      SHOULDER, TASSET_X, TASSET_Y, THIGH, UPPER_ARM, WAIST_Y)

ap = argparse.ArgumentParser()
ap.add_argument("--src", default="art/source/shardbearer-tripo/tripo-h31-v2/shardbearer-model_urls-pbr_model-model.glb")
ap.add_argument("--tris", type=int, default=40000)
ap.add_argument("--tex", type=int, default=2048)
ap.add_argument("--no-bake", action="store_true")
ap.add_argument("--blend", type=int, default=3, help="joint blend width, in edge rings")
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

OUT = ROOT / "public/models/shardplate-tripo.glb"
RENDERS = ROOT / "art/renders/tripo"
POSE_ARM, POSE_ELBOW, POSE_LEG = deg(45), deg(-37), deg(5)   # compare_reference.POSE
PLATE_HAND = 0.21                                            # humanoid.ts PLATE_HAND


def game_to_blender(p):
    x, y, z = p
    return Vector((x, -z, y))


# --- The posed skeleton (game body space: +Y up, +Z forward, +X the character's left) ---
W = WAIST_Y
JOINTS = {}   # piece -> (joint position, roll)  (roll: build_shardplate.place)
SEGS = {}     # piece -> (a, b, radius): capsules the cut measures against
JOINTS["helm"] = ((0, W + HELM_Y, 0), 0.0)
SEGS["helm"] = ((0, W + HELM_Y + 0.02, 0), (0, W + HELM_Y + 0.3, 0), 0.16)
JOINTS["breastplate"] = ((0, W, 0), 0.0)
SEGS["breastplate"] = ((0, W + 0.07, 0), (0, W + 0.77, 0), 0.30)
JOINTS["belt"] = ((0, W, 0), 0.0)
SEGS["belt"] = ((-0.2, W + 0.02, 0), (0.2, W + 0.02, 0), 0.22)
JOINTS["fauld_front"] = ((0, FAULD_Y, FAULD_FRONT_Z), 0.0)
JOINTS["fauld_back"] = ((0, FAULD_Y, FAULD_BACK_Z), 0.0)
for s, side in ((1, "l"), (-1, "r")):
    sh = np.array([s * SHOULDER[0], W + SHOULDER[1], 0])
    a, e = POSE_ARM, POSE_ARM + POSE_ELBOW
    elbow = sh + UPPER_ARM * np.array([s * math.sin(a), -math.cos(a), 0])
    wrist = elbow + LOWER_ARM * np.array([s * math.sin(e), -math.cos(e), 0])
    hand = wrist + PLATE_HAND * np.array([s * math.sin(e), -math.cos(e), 0])
    hip = np.array([s * LEG_X, HIP_Y, 0])
    lg = POSE_LEG
    knee = hip + THIGH * np.array([s * math.sin(lg), -math.cos(lg), 0])
    ankle = knee + SHIN * np.array([s * math.sin(lg), -math.cos(lg), 0])
    JOINTS[f"pauldron_{side}"] = (sh, 0.0)
    SEGS[f"pauldron_{side}"] = (sh + [s * 0.08, 0.10, -0.02], sh + [s * 0.08, 0.10, -0.02], 0.24)
    JOINTS[f"upperarm_{side}"] = (sh, s * a)
    SEGS[f"upperarm_{side}"] = (sh, elbow, 0.14)
    JOINTS[f"forearm_{side}"] = (elbow, s * e)
    SEGS[f"forearm_{side}"] = (elbow, wrist, 0.16)
    JOINTS[f"gauntlet_{side}"] = (wrist, s * e)
    SEGS[f"gauntlet_{side}"] = (wrist, wrist + 1.5 * (hand - wrist), 0.14)   # the generated hand is longer
    JOINTS[f"tasset_{side}"] = ((s * TASSET_X, TASSET_Y, 0), 0.0)
    JOINTS[f"thigh_{side}"] = (hip, s * lg)
    SEGS[f"thigh_{side}"] = (hip, knee, 0.17)
    JOINTS[f"shin_{side}"] = (knee, s * lg)
    SEGS[f"shin_{side}"] = (knee, ankle, 0.15)
    JOINTS[f"boot_{side}"] = (ankle, s * lg)
EMPTY = ("gorget", "abdomen", "helm_crest")


def seg_dist(p, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    L2 = float(ab @ ab)
    t = np.zeros(len(p)) if L2 < 1e-9 else np.clip((p - a) @ ab / L2, 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def classify(c):
    """Piece name for each face centroid c (N x 3, game body space, posed)."""
    names = list(SEGS)
    score = np.stack([seg_dist(c, *SEGS[n][:2]) - SEGS[n][2] for n in names], axis=1)
    label = np.array(names, dtype=object)[np.argmin(score, axis=1)]
    x, y, z = c[:, 0], c[:, 1], c[:, 2]
    side = np.where(x >= 0, "l", "r")
    thigh_d = np.minimum(seg_dist(c, *SEGS["thigh_l"][:2]), seg_dist(c, *SEGS["thigh_r"][:2]))
    # The fauld hangs between the legs; the tassets lie over the thighs' outer fronts.
    fauld = (np.abs(x) < 0.15) & (y > 0.66) & (y < W + 0.1) & (thigh_d > 0.11)
    label[fauld] = np.where(z[fauld] >= 0, "fauld_front", "fauld_back")
    hand = np.isin(label, ["gauntlet_l", "gauntlet_r", "forearm_l", "forearm_r"])
    tasset = ~fauld & ~hand & (np.abs(x) > 0.12) & (y > 0.84) & (y < TASSET_Y) & (thigh_d > 0.155) & (z > -0.12)
    label[tasset] = np.char.add("tasset_", side[tasset].astype(str))
    boot = y < 0.13
    label[boot] = np.char.add("boot_", side[boot].astype(str))
    return label


# --- Scene --------------------------------------------------------------------------------
reset_scene()


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [o for o in set(bpy.data.objects) - before]


def mesh_points(objs):
    pts = []
    for o in objs:
        if o.type == "MESH":
            m = o.matrix_world
            pts += [m @ v.co for v in o.data.vertices]
    a = np.array([(p.x, p.z, -p.y) for p in pts])   # -> game space
    return a


# The scripted Plate in the reference pose: the target the generated mesh is fitted to.
ref = {o.name: o for o in import_glb(ROOT / "public/models/shardplate.glb")}
for n, (pos, roll) in JOINTS.items():
    if n in ref:
        ref[n].location = game_to_blender(pos)
        ref[n].rotation_euler = (0, -roll, 0)
for n in ("gorget", "abdomen"):
    ref[n].location = game_to_blender((0, W, 0))
ref["helm_crest"].location = game_to_blender((0, W + HELM_Y, 0))
bpy.context.view_layer.update()
rp = mesh_points([o for n, o in ref.items() if n != "helm_crest"])
r_lo, r_hi = rp[:, 1].min(), rp[:, 1].max()
r_chest = rp[(rp[:, 1] > 1.3) & (rp[:, 1] < 1.7)]
r_cz = (r_chest[:, 2].min() + r_chest[:, 2].max()) / 2
for o in ref.values():
    bpy.data.objects.remove(o)

# The generated mesh: faces Blender +X; turn it to face the game's +Z (Blender -Y), then fit
# its height and chest depth to the scripted Plate's.
hi = next(o for o in import_glb(ROOT / args.src) if o.type == "MESH")
bpy.context.view_layer.update()
hi.data.transform(hi.matrix_world)   # the importer's node transform (quaternion), baked in
hi.parent = None
hi.matrix_world = Matrix.Identity(4)
hi.data.transform(Matrix.Rotation(deg(-90), 4, "Z"))
hp = mesh_points([hi])
k = (r_hi - r_lo) / (hp[:, 1].max() - hp[:, 1].min())
h_chest = hp[(hp[:, 1] - hp[:, 1].min()) * k + r_lo > 1.3]
h_chest = h_chest[(h_chest[:, 1] - hp[:, 1].min()) * k + r_lo < 1.7]
h_cx = (hp[:, 0].min() + hp[:, 0].max()) / 2
h_cz = (h_chest[:, 2].min() + h_chest[:, 2].max()) / 2
hi.data.transform(Matrix.Translation(Vector((-h_cx, h_cz, -hp[:, 1].min()))))   # Blender: game z = -y
hi.data.transform(Matrix.Scale(k, 4))
hi.data.transform(Matrix.Translation(Vector((0, -r_cz, r_lo))))
hi.data.update()
print(f"fit: scale {k:.4f}, height {r_lo:.3f}-{r_hi:.3f} m, chest centre z {r_cz:.3f}")

# Decimated copy carrying the same UVs, its normal map baked from the full mesh.
lo = hi.copy()
lo.data = hi.data.copy()
lo.name = "tripo_lo"
bpy.context.collection.objects.link(lo)
mat = hi.data.materials[0].copy()
mat.name = "tripo"
lo.data.materials[0] = mat
dec = lo.modifiers.new("dec", "DECIMATE")
dec.ratio = args.tris / len(hi.data.polygons) / (1 if hi.data.polygons[0].loop_total == 3 else 2)
bpy.ops.object.select_all(action="DESELECT")
lo.select_set(True)
bpy.context.view_layer.objects.active = lo
bpy.ops.object.modifier_apply(modifier="dec")
lo.data.calc_loop_triangles()
print(f"decimated: {len(lo.data.loop_triangles)} triangles")
for p in lo.data.polygons:
    p.use_smooth = True

nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
for n in nt.nodes:
    if n.type == "TEX_IMAGE" and n.image and n.image.size[0] > args.tex:
        n.image.scale(args.tex, args.tex)
# The gloves and the padding at the joints are painted near-black, which reads as holes in the
# game's light: lift the darkest paint toward a dark leather brown, leaving the rest untouched.
base_link = bsdf.inputs["Base Color"].links
if base_link and base_link[0].from_node.type == "TEX_IMAGE":
    img = base_link[0].from_node.image
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    lum = px[:, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    # 8-bit textures come back sRGB-encoded: these are sRGB values.
    k = np.clip((0.2 - lum) / 0.12, 0, 1)[:, None] * 0.5   # full below 0.08, none above 0.2
    px[:, :3] += (np.array([0.30, 0.24, 0.20], dtype=np.float32) - px[:, :3]) * k
    img.pixels.foreach_set(px.ravel())
    img.update()
    print(f"lifted the darkest paint on {(k[:, 0] > 0).mean():.1%} of texels")
nmap =next((n for n in nt.nodes if n.type == "NORMAL_MAP"), None)
if not args.no_bake:
    baked = bpy.data.images.new("tripo_normal", args.tex, args.tex, alpha=False, float_buffer=False)
    baked.colorspace_settings.name = "Non-Color"
    tgt = nt.nodes.new("ShaderNodeTexImage")
    tgt.image = baked
    nt.nodes.active = tgt
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = 1
    s.render.bake.use_selected_to_active = True
    s.render.bake.cage_extrusion = 0.02
    s.render.bake.max_ray_distance = 0.05
    s.render.bake.margin = 8
    bpy.ops.object.select_all(action="DESELECT")
    hi.select_set(True)
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
    if nmap is None:
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(tgt.outputs["Color"], nmap.inputs["Color"])
    old = [n for n in nt.nodes if n.type == "TEX_IMAGE" and n is not tgt and n.image and "Normal" in n.image.name]
    for n in old:
        nt.nodes.remove(n)
    baked.pack()
    print("baked normal map")
bpy.data.objects.remove(hi)

# --- Skin weights: one bone per region, blended over a few centimetres at each joint -------
me = lo.data
# The glTF import splits vertices along every UV seam; weld them so the surface is connected
# (UVs are per face corner in Blender, so the seams survive).
bm = bmesh.new()
bm.from_mesh(me)
nb = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
print(f"welded {nb} -> {len(bm.verts)} vertices")
bm.to_mesh(me)
bm.free()
nv = len(me.vertices)
co = np.empty(nv * 3)
me.vertices.foreach_get("co", co)
co = co.reshape(-1, 3)
vpos = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)   # -> game space
labels = classify(vpos)
bones = sorted(set(labels))
idx = {b: i for i, b in enumerate(bones)}
lab = np.array([idx[x] for x in labels])
ev = np.empty(len(me.edges) * 2, dtype=np.int64)
me.edges.foreach_get("vertices", ev)
ev = ev.reshape(-1, 2)

# Small loose shells (a fauld leaf, a rivet) move as one: they take their majority bone.
parent = np.arange(nv)


def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


for a, b in ev:
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[ra] = rb
roots = np.array([find(v) for v in range(nv)])
shells = moved_leaves = 0
for r in np.unique(roots):
    members = np.where(roots == r)[0]
    if len(members) < 0.04 * nv:
        best = bones[np.bincount(lab[members]).argmax()]
        c = vpos[members].mean(axis=0)
        # A loose leaf above the knee belongs to the skirt even where it overlaps the thigh.
        if best.startswith("thigh_") and c[1] > 0.66:
            best = "fauld_back" if c[2] < -0.12 else f"tasset_{best[-1]}"
            if best not in idx:
                best = bones[np.bincount(lab[members]).argmax()]
            moved_leaves += 1
        lab[members] = idx[best]
        shells += 1
Wt = np.zeros((nv, len(bones)))
Wt[np.arange(nv), lab] = 1.0
# Diffuse the one-hot weights along the surface: each pass spreads a joint by about one edge.
deg_ = np.bincount(ev.ravel(), minlength=nv).astype(float)
for _ in range(args.blend):
    acc = Wt.copy()
    np.add.at(acc, ev[:, 0], Wt[ev[:, 1]])
    np.add.at(acc, ev[:, 1], Wt[ev[:, 0]])
    Wt = acc / (1.0 + deg_)[:, None]

# The skirt hangs from the belt: the fauld leaves and tassets take nothing from the legs (and the
# legs nothing from them), or a stride stretches the leaves into shards.
skirt = [idx[b] for b in bones if b.startswith(("fauld_", "tasset_"))]
legs = [idx[b] for b in bones if b.startswith(("thigh_", "shin_", "boot_"))]
is_skirt = np.isin(lab, skirt)
Wt[np.ix_(is_skirt, legs)] = 0
Wt[np.ix_(~is_skirt & np.isin(lab, legs), skirt)] = 0
top = np.argsort(-Wt, axis=1)[:, :4]
tw = np.take_along_axis(Wt, top, axis=1)
tw[tw < 0.02] = 0
tw /= tw.sum(axis=1, keepdims=True)
print(f"weights: {len(bones)} bones, {shells} small shells made rigid ({moved_leaves} leaves off the thighs), "
      f"{(tw[:, 1] > 0.05).mean():.0%} of vertices blended")

# Armature: one unparented bone per piece at its joint. The game ignores the bones' own
# transforms: it binds the skin to its animated groups using the reference frames below.
arm = bpy.data.objects.new("tripo_rig", bpy.data.armatures.new("tripo_rig"))
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for b in bones:
    eb = arm.data.edit_bones.new(f"b_{b}")
    head = game_to_blender(JOINTS[b][0])
    eb.head = head
    eb.tail = head + Vector((0, 0, 0.1))
bpy.ops.object.mode_set(mode="OBJECT")
lo.name = lo.data.name = "tripo_body"
for bi, b in enumerate(bones):
    vg = lo.vertex_groups.new(name=f"b_{b}")
    for k in range(4):
        sel = np.where((top[:, k] == bi) & (tw[:, k] > 0))[0]
        for v, w in zip(sel.tolist(), tw[sel, k].tolist()):
            vg.add([v], w, "REPLACE")
lo.parent = arm
mod = lo.modifiers.new("rig", "ARMATURE")
mod.object = arm
# Each bone's frame in the reference pose the mesh is in: joint position and roll about +Z
# (game space). The game's bone inverse is the inverse of this frame.
lo["refFrames"] = json.dumps({b: [*map(float, JOINTS[b][0]), float(JOINTS[b][1])] for b in bones})
pieces = [arm, lo]
for name in sorted(set(JOINTS) | set(EMPTY)):
    e = bpy.data.objects.new(name, None)   # the animated nodes the game parents and moves
    bpy.context.collection.objects.link(e)
    pieces.append(e)

# --- Export -----------------------------------------------------------------------------
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for o in pieces:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", use_selection=True, export_apply=False,
                          export_yup=True, export_materials="EXPORT", export_image_format="JPEG",
                          export_jpeg_quality=88, export_skins=True, export_extras=True,
                          export_animations=False)
print(f"exported {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")

# --- Check: each vertex coloured by its main bone, front and side -------------------------
RENDERS.mkdir(parents=True, exist_ok=True)
pal = np.random.default_rng(3).uniform(0.15, 0.95, (len(bones), 3))
col = np.concatenate([(pal[top[:, 0]] * tw[:, :1] + pal[top[:, 1]] * tw[:, 1:2]), np.ones((nv, 1))], axis=1)
ca = me.color_attributes.new("bone", "FLOAT_COLOR", "POINT")
ca.data.foreach_set("color", col.ravel())
lo.modifiers.remove(mod)
s = bpy.context.scene
s.render.engine = "BLENDER_WORKBENCH"
s.display.shading.color_type = "VERTEX"
s.render.resolution_x, s.render.resolution_y = 700, 900
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
s.collection.objects.link(cam)
s.camera = cam
cam.data.type = "ORTHO"
cam.data.ortho_scale = 2.6
for view, loc, rot in (("front", (0, -6, 1.2), (deg(90), 0, 0)), ("side", (6, 0, 1.2), (deg(90), 0, deg(90)))):
    cam.location, cam.rotation_euler = loc, rot
    s.render.filepath = str(RENDERS / f"build-weights-{view}.png")
    bpy.ops.render.render(write_still=True)
print("renders: art/renders/tripo/build-weights-{front,side}.png")
