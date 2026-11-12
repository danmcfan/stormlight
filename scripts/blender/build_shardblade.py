"""Build the Shardblade from its traced side-view outline.

Input:  art/source/shardblade-side/trace/outline.json (trace_silhouette.py)
Output: public/models/shardblade.glb and art/renders/shardblade/*.png

Game conventions (src/render/humanoid.ts): the origin is the grip point
(right hand); in glTF the blade runs along +Y, its wide axis is Z with the
cutting edge toward +Z (it leads the swing), and it is thin along X. The
damaging part spans 0.2–1.95 m from the hand (combat/moves.ts weapon), so the
tip sits 1.95 m from the origin.

  .venv-blender/bin/python scripts/blender/build_shardblade.py
"""
import json
import sys

import bpy
import numpy as np

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import ROOT, apply_transforms, deg, export_glb, link, material, render_views, reset_scene  # noqa: E402

TIP_FROM_HAND = 1.95      # metres, matches the game's hit segment end
HALF_THICK = 0.0045       # flat of the blade (each side), before the edge chamfer
CHAMFER = 0.0075          # bevel that thins the outline into an edge

trace = json.load(open(ROOT / "art/source/shardblade-side/trace/outline.json"))
pts = np.array(trace["points"], dtype=float)

# --- Measure the reference ----------------------------------------------------
# Column heights of the outline polygon tell grip (thin) from blade (wide).
mask_w, mask_h = trace["size"]
import cv2  # noqa: E402
mask = np.zeros((mask_h, mask_w), np.uint8)
cv2.fillPoly(mask, [pts.astype(np.int32)], 255)
cols = (mask > 0).sum(axis=0)
xs = np.nonzero(cols)[0]
x_min, x_max = xs.min(), xs.max()
grip_h = np.median(cols[x_min + 80: x_min + 200])  # well inside the grip
guard_x = next(x for x in range(x_min + 120, x_max) if cols[x] > grip_h * 3)
rows = np.nonzero(mask[:, x_min + 150])[0]
centre_y = (rows.min() + rows.max()) / 2  # grip centreline
hand_x = guard_x - 0.6 * grip_h           # right hand sits just below the hooks
scale = TIP_FROM_HAND / (x_max - hand_x)
grip_r = grip_h / 2 * scale
print(f"guard at x={guard_x}px, grip {grip_h:.0f}px, scale {scale * 1000:.2f} mm/px, "
      f"total length {(x_max - x_min) * scale:.2f} m")

def to_local(x, y):
    """Image px -> curve plane: X along the blade from the hand, Y toward the spine."""
    return ((x - hand_x) * scale, (centre_y - y) * scale)

reset_scene()
steel = material("Shardblade steel", (0.86, 0.89, 0.93), metallic=1.0, roughness=0.16)
grip_mat = material("Shardblade grip", (0.42, 0.45, 0.5), metallic=1.0, roughness=0.35)
gem_mat = material("Sapphire", (0.1, 0.25, 0.85), roughness=0.05, emission=(0.45, 0.75, 1.0), strength=3.0)
etch_mat = material("Etched glow", (0.6, 0.85, 1.0), roughness=0.3, emission=(0.5, 0.82, 1.0), strength=1.2)

# --- Blade: the traced outline, extruded thin with chamfered edges --------------
curve = bpy.data.curves.new("blade_outline", "CURVE")
curve.dimensions = "2D"
curve.fill_mode = "BOTH"
curve.extrude = HALF_THICK
curve.bevel_depth = CHAMFER
curve.bevel_resolution = 0
curve.offset = -CHAMFER / (CHAMFER + 1e-9) * 0.0  # keep the outline at the traced size
spline = curve.splines.new("POLY")
spline.points.add(len(pts) - 1)
for p, (x, y) in zip(spline.points, pts):
    lx, ly = to_local(x, y)
    p.co = (lx, ly, 0, 1)
spline.use_cyclic_u = True
blade = link(bpy.data.objects.new("Shardblade", curve))
blade.data.materials.append(steel)
bpy.context.view_layer.objects.active = blade
blade.select_set(True)
bpy.ops.object.convert(target="MESH")
# Curve plane -> Blender: blade length along +Z, spine toward +Y (edge toward -Y), thin along X.
blade.rotation_euler = (0, deg(-90), 0)
apply_transforms(blade)

parts = [blade]

# --- Grip: a round two-hand grip over the flat silhouette ------------------------
pommel_x = x_min + grip_h * 2.2
z0, z1 = to_local(pommel_x, 0)[0], to_local(guard_x, 0)[0]
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=grip_r * 1.05, depth=z1 - z0, location=(0, 0, (z0 + z1) / 2))
grip = bpy.context.active_object
grip.name = "Grip"
grip.data.materials.append(grip_mat)
# Raised rings along the grip for hands to read against.
for i in range(5):
    z = z0 + (z1 - z0) * (i + 0.5) / 5
    bpy.ops.mesh.primitive_torus_add(major_radius=grip_r * 1.05, minor_radius=grip_r * 0.28, location=(0, 0, z))
    ring = bpy.context.active_object
    ring.data.materials.append(grip_mat)
    parts.append(ring)
parts.append(grip)

# --- Sapphire in the pommel (glows) ----------------------------------------------
gem_x = x_min + grip_h * 1.6
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=grip_r * 1.25, location=(0, 0, to_local(gem_x, 0)[0]))
gem = bpy.context.active_object
gem.name = "Sapphire"
gem.scale = (1.15, 0.9, 1.0)
gem.data.materials.append(gem_mat)
apply_transforms(gem)
parts.append(gem)

# --- Faint glowing line down the fuller (both faces) ------------------------------
f0, f1 = to_local(guard_x + 120, 0)[0], to_local(guard_x + 0.68 * (x_max - guard_x), 0)[0]
for side in (1, -1):
    # The chamfer adds its depth to the flat, so the face sits at HALF_THICK + CHAMFER.
    bpy.ops.mesh.primitive_plane_add(size=1, location=(side * (HALF_THICK + CHAMFER + 0.0006), 0, (f0 + f1) / 2))
    etch = bpy.context.active_object
    etch.rotation_euler = (0, deg(90), 0)
    etch.scale = (f1 - f0, 0.009, 1)
    etch.data.materials.append(etch_mat)
    apply_transforms(etch)
    parts.append(etch)

# Join into one mesh with several materials, shade smooth-ish edges.
bpy.ops.object.select_all(action="DESELECT")
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = blade
bpy.ops.object.join()
blade.name = "Shardblade"
bpy.ops.object.shade_auto_smooth(angle=deg(35))

dims = blade.dimensions
print(f"Shardblade: {dims.z:.2f} m long, {dims.y:.2f} m wide, {dims.x * 1000:.0f} mm thick, "
      f"{len(blade.data.polygons)} faces")

export_glb(ROOT / "public/models/shardblade.glb", [blade])

if "--no-render" not in sys.argv:
    # Lay it horizontally for landscape previews (already exported upright).
    blade.rotation_euler = (0, deg(90), 0)   # blade now runs along +X
    blade.location = (-0.75, 0, 0)
    mid = (0, 0, 0)
    paths = render_views(ROOT / "art/renders/shardblade/shardblade", [
        ("flat", (0, 0, 4), mid, 2.9),               # looking down at the flat of the blade
        ("edge", (0, -4, 0), mid, 2.9),              # looking along the edge: shows thickness
        ("three-quarter", (1.2, -2.4, 1.1), (0.1, 0, 0), None),
    ], size=(1400, 600))
    for p in paths:
        print("render", p.relative_to(ROOT))
