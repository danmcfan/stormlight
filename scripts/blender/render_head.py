"""Render head close-ups (helm + gorget in the torso) of the built Plate, for art review.

  .venv-blender/bin/python scripts/blender/render_head.py [--tag before] [--model path.glb]

Writes art/renders/head/<tag>-{front,side,back,three-quarter}.png. Each camera is fixed, so a
before and an after render of the same tag pair up directly. The pose mirrors
compare_reference.pose_plate (arms abducted 45, elbows bent -37, legs 5) so the head sits where
the reference views put it.

This stands alone rather than importing compare_reference, which runs its own comparison when
imported.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy  # noqa: F401
import numpy as np

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import ROOT, deg, reset_scene  # noqa: E402
from skeleton import (FAULD_BACK_Z, FAULD_FRONT_Z, FAULD_Y, HELM_Y, HIP_Y, LEG_X, LOWER_ARM,  # noqa: E402
                      SHOULDER, TASSET_X, TASSET_Y, THIGH, UPPER_ARM, WAIST_Y, SHIN)

ap = argparse.ArgumentParser()
ap.add_argument("--tag", default="after")
ap.add_argument("--model", default=None, help="GLB path (default public/models/shardplate.glb)")
ap.add_argument("--samples", type=int, default=32)
ap.add_argument("--out", default=None, help="output directory (default art/renders/head)")
args = ap.parse_args()

reset_scene()
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"

# Background and light: a plain grey studio, so the silhouette and the trim read clearly.
world = bpy.data.worlds.new("studio")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.65, 0.69, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
scene.world = world

def sun(name, rot, energy):
    d = bpy.data.lights.new(name, "SUN")
    d.energy = energy
    d.angle = deg(20)
    o = bpy.data.objects.new(name, d)
    o.rotation_euler = rot
    scene.collection.objects.link(o)

sun("key", (deg(58), 0, deg(35)), 3.2)
sun("fill", (deg(66), 0, deg(-130)), 1.1)

# --- The model, in the same pose the reference comparisons use -------------------------
def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return {o.name: o for o in bpy.data.objects if o not in before and o.type == "MESH"}


def place(o, pos, roll=0.0):
    x, y, z = pos
    o.location = (x, -z, y)          # body Y-up -> Blender Z-up
    o.rotation_euler = (0, -roll, 0)


model = Path(args.model) if args.model else ROOT / "public/models/shardplate.glb"
objs = import_glb(model)
objs.pop("helm_crest", None)

W = WAIST_Y
place(objs["helm"], (0, W + HELM_Y, 0))
for n in ("gorget", "breastplate", "abdomen", "belt"):
    place(objs[n], (0, W, 0))
place(objs["fauld_front"], (0, FAULD_Y, FAULD_FRONT_Z))
place(objs["fauld_back"], (0, FAULD_Y, FAULD_BACK_Z))

A, E, LG = deg(45), deg(-37), deg(5)
for s, side in ((1, "l"), (-1, "r")):
    sh = np.array([s * SHOULDER[0], W + SHOULDER[1], 0])
    place(objs[f"pauldron_{side}"], sh)
    place(objs[f"upperarm_{side}"], sh, s * A)
    elbow = sh + UPPER_ARM * np.array([s * math.sin(A), -math.cos(A), 0])
    place(objs[f"forearm_{side}"], elbow, s * (A + E))
    wrist = elbow + LOWER_ARM * np.array([s * math.sin(A + E), -math.cos(A + E), 0])
    place(objs[f"gauntlet_{side}"], wrist, s * (A + E))
    hip = np.array([s * LEG_X, HIP_Y, 0])
    place(objs[f"tasset_{side}"], (s * TASSET_X, TASSET_Y, 0))
    place(objs[f"thigh_{side}"], hip, s * LG)
    place(objs[f"shin_{side}"], hip - [0, THIGH, 0], s * LG)
    place(objs[f"boot_{side}"], hip - [0, THIGH + SHIN, 0], s * LG)

# --- Cameras --------------------------------------------------------------------------
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 1.0
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

TARGET = (0.0, 2.02, 0.0)
VIEWS = {
    "front": (0.0, 2.02, 2.5),
    "side": (2.5, 2.02, 0.0),
    "back": (0.0, 2.02, -2.5),
    "three-quarter": (1.8, 2.3, 1.8),
}
out = Path(args.out) if args.out else ROOT / "art/renders/head"
out.mkdir(parents=True, exist_ok=True)
scene.render.resolution_x = scene.render.resolution_y = 760

from mathutils import Vector  # noqa: E402

for name, loc in VIEWS.items():
    # Blender is Z-up: our (x, y_up, z_fwd) -> (x, -z_fwd, y_up)
    bl_loc = (loc[0], -loc[2], loc[1])
    bl_tgt = (TARGET[0], -TARGET[2], TARGET[1])
    cam.location = bl_loc
    cam.rotation_euler = (Vector(bl_tgt) - Vector(bl_loc)).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(out / f"{args.tag}-{name}.png")
    bpy.ops.render.render(write_still=True)
    print("render", (out / f"{args.tag}-{name}.png").relative_to(ROOT))
