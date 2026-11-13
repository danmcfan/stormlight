"""Render the helm alone from several angles, close up, for judging the visor and trim.

  .venv-blender/bin/python scripts/blender/render_helm.py [--tag after] [--zoom]

Writes art/renders/helm/<tag>-{front,side,three-quarter,visor}.png. The helm is drawn alone at
a fixed orthographic scale so before and after line up, and `--zoom` frames only the visor and
crown for judging the slit.
"""
import argparse
import sys
from pathlib import Path

import bpy  # noqa: F401
from mathutils import Vector

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import ROOT, deg, reset_scene  # noqa: E402
from skeleton import HELM_Y, WAIST_Y  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--tag", default="after")
ap.add_argument("--model", default=None)
ap.add_argument("--samples", type=int, default=48)
ap.add_argument("--zoom", action="store_true", help="frame the visor and crown only")
args = ap.parse_args()

reset_scene()
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "Standard"
scene.render.film_transparent = False

world = bpy.data.worlds.new("studio")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.65, 0.69, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
scene.world = world


def sun(name, rot, energy):
    d = bpy.data.lights.new(name, "SUN")
    d.energy = energy
    d.angle = deg(18)
    o = bpy.data.objects.new(name, d)
    o.rotation_euler = rot
    scene.collection.objects.link(o)


sun("key", (deg(58), 0, deg(35)), 3.0)
sun("fill", (deg(66), 0, deg(-130)), 1.2)
sun("rim", (deg(95), 0, deg(180)), 0.8)

# --- The helm alone, at the joint ---------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(Path(args.model) if args.model
                                       else ROOT / "public/models/shardplate.glb"))
objs = {o.name: o for o in bpy.data.objects if o not in before and o.type == "MESH"}
for name, o in objs.items():
    # Body space (x, y up, z fwd) -> Blender (x, -z, y); helm sits at the helm joint.
    o.location = (0, 0, 0)
    o.visible_camera = name in ("helm", "helm_crest")
    o.visible_shadow = False

helm = objs["helm"]
# The helm's own origin is the helm joint (world 2.00 m), so lift it into view.
for name in ("helm", "helm_crest"):
    if name in objs:
        objs[name].location = (0, 0, WAIST_Y + HELM_Y)

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.resolution_x = scene.render.resolution_y = 820

if args.zoom:
    # Frame the visor: the helm's front-upper half.
    TARGET = (0.0, WAIST_Y + HELM_Y + 0.085, 0.06)
    cam_data.ortho_scale = 0.30
    VIEWS = {"visor": (0.0, WAIST_Y + HELM_Y + 0.085, 1.6),
             "visor-side": (1.6, WAIST_Y + HELM_Y + 0.085, 0.06)}
else:
    TARGET = (0.0, WAIST_Y + HELM_Y + 0.02, 0.0)
    cam_data.ortho_scale = 0.56
    VIEWS = {"front": (0.0, WAIST_Y + HELM_Y + 0.02, 1.6),
             "side": (1.6, WAIST_Y + HELM_Y + 0.02, 0.0),
             "three-quarter": (1.15, WAIST_Y + HELM_Y + 0.30, 1.15)}

out = ROOT / "art/renders/helm"
out.mkdir(parents=True, exist_ok=True)
for name, loc in VIEWS.items():
    # Body space (x, y up, z fwd) -> Blender Z-up: (x, -z_fwd, y_up).
    cx, cy, cz = TARGET
    bl_t = (cx, -cz, cy)
    bl_l = (loc[0], -loc[2], loc[1])
    cam.location = bl_l
    cam.rotation_euler = (Vector(bl_t) - Vector(bl_l)).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(out / f"{args.tag}-{name}.png")
    bpy.ops.render.render(write_still=True)
    print("render", (out / f"{args.tag}-{name}.png").relative_to(ROOT))
