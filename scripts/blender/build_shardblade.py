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

# The bevel below grows the outline by CHAMFER all round, so shrink the traced
# outline by that much first (at 4x resolution); the finished silhouette then
# matches the reference instead of reading fat.
UP = 4
big = np.zeros((mask_h * UP, mask_w * UP), np.uint8)
cv2.fillPoly(big, [(pts * UP).astype(np.int32)], 255)
er = max(1, int(round(CHAMFER / scale * UP)))
big = cv2.erode(big, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * er + 1, 2 * er + 1)))
cs, _ = cv2.findContours(big, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
pts = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 1.2 * UP, True)[:, 0, :].astype(float) / UP
print(f"outline shrunk {er / UP:.1f} px for the bevel: {len(pts)} points")
print(f"guard at x={guard_x}px, grip {grip_h:.0f}px, scale {scale * 1000:.2f} mm/px, "
      f"total length {(x_max - x_min) * scale:.2f} m")

def to_local(x, y):
    """Image px -> curve plane: X along the blade from the hand, Y toward the spine."""
    return ((x - hand_x) * scale, (centre_y - y) * scale)

reset_scene()
steel = material("Shardblade steel", (0.86, 0.89, 0.93), metallic=1.0, roughness=0.16)
grip_mat = material("Shardblade grip", (0.42, 0.45, 0.5), metallic=1.0, roughness=0.35)
gem_mat = material("Sapphire", (0.1, 0.25, 0.85), roughness=0.05, emission=(0.45, 0.75, 1.0), strength=3.0)
etch_mat = material("Etched glow", (0.6, 0.85, 1.0), roughness=0.3, emission=(0.5, 0.82, 1.0), strength=0.7)

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
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=grip_r * 0.95, depth=z1 - z0, location=(0, 0, (z0 + z1) / 2))
grip = bpy.context.active_object
grip.name = "Grip"
grip.data.materials.append(grip_mat)
# Raised rings along the grip for hands to read against.
for i in range(4):
    z = z0 + (z1 - z0) * (i + 0.5) / 4
    bpy.ops.mesh.primitive_torus_add(major_radius=grip_r * 0.95, minor_radius=grip_r * 0.16, location=(0, 0, z),
                                     major_segments=16, minor_segments=6)
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

# --- Etched fuller: two converging lines and abstract glyph strokes (both faces) --
# Like the reference's engraved band of symbols, but not readable text.
f0, f1 = to_local(guard_x + 60, 0)[0], to_local(guard_x + 0.66 * (x_max - guard_x), 0)[0]
FH = 13 * scale            # half-height of the fuller band
face_x = HALF_THICK + CHAMFER + 0.0006   # the chamfer adds its depth to the flat
strokes = []               # (z0, y0, z1, y1, width) in blade-length / spine coordinates
tip = f1 + 4 * FH
for sgn in (1, -1):
    strokes.append((f0, sgn * FH, f1, sgn * FH, 0.004))
    strokes.append((f1, sgn * FH, tip, 0.0, 0.004))
strokes.append((f0, -FH, f0, FH, 0.004))
rng = np.random.default_rng(7)
z = f0 + 0.03
while z < f1 - 0.03:
    if rng.random() < 0.12:            # word gaps
        z += 0.03
        continue
    w = rng.uniform(0.012, 0.022)
    kind = rng.integers(4)
    a, b = -0.6 * FH, 0.6 * FH
    if kind == 0:   # vertical bar
        strokes.append((z + w / 2, a, z + w / 2, b, 0.003))
    elif kind == 1:  # chevron
        strokes += [(z, a, z + w / 2, b, 0.003), (z + w / 2, b, z + w, a, 0.003)]
    elif kind == 2:  # bar with a tick
        strokes += [(z, a, z, b, 0.003), (z, 0, z + w, 0.4 * FH * (1 if rng.random() < 0.5 else -1), 0.003)]
    else:            # slanted pair
        strokes += [(z, a, z + w * 0.6, b, 0.003), (z + w * 0.5, a, z + w, b, 0.003)]
    z += w + 0.009
verts, faces = [], []
for side in (1, -1):
    for z0, y0, z1, y1, wd in strokes:
        d = np.array([z1 - z0, y1 - y0]); d /= np.linalg.norm(d) or 1
        n = np.array([-d[1], d[0]]) * wd / 2
        base = len(verts)
        for zz, yy in ((z0, y0), (z1, y1)):
            pass
        quad = [(z0 + n[0], y0 + n[1]), (z1 + n[0], y1 + n[1]), (z1 - n[0], y1 - n[1]), (z0 - n[0], y0 - n[1])]
        verts += [(side * face_x, yy, zz) for zz, yy in quad]
        faces.append((base, base + 1, base + 2, base + 3) if side > 0 else (base + 3, base + 2, base + 1, base))
etch_mesh = bpy.data.meshes.new("etch")
etch_mesh.from_pydata(verts, [], faces)
etch = link(bpy.data.objects.new("etch", etch_mesh))
etch.data.materials.append(etch_mat)
parts.append(etch)

# Diamond boss on each face where the crescent hooks meet (reference guard).
gz = to_local(guard_x + 18, 0)[0]
for side in (1, -1):
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.05, radius2=0.0, depth=0.012,
                                    location=(side * (face_x + 0.005), 0, gz))
    boss = bpy.context.active_object
    boss.rotation_euler = (0, deg(90) * side, 0)
    boss.scale = (0.55, 1.0, 1.0)
    boss.data.materials.append(steel)
    apply_transforms(boss)
    parts.append(boss)

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
