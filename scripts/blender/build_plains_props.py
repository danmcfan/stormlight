"""Shattered Plains props: rockbuds (closed and open), the gemheart chrysalis
and a bridge-crew bridge. Run with:

  .venv-blender/bin/python scripts/blender/build_plains_props.py [--no-render]

Writes public/models/plains-props.glb with one node per prop:

  rockbud_closed   squat ridged clam-like stone shell, ~0.8 m across (instanced)
  rockbud_open     the same with the upper valve lifted, dark flesh and a few
                   thin green vines trailing from the lip onto the rock
  chrysalis        a towering hunched mound of overlapping ridged plates,
                   ~5.6 m tall (three times a man's height)
  bridge           heavy squared planks laid side by side along an 18 m span,
                   bolted to two thick beams underneath; no rails or ropes

Wording from docs/art.md (book-accuracy table). Shapes are built from
parametric grids so they stay light: a rockbud is ~600 triangles, the
chrysalis ~4k, the bridge ~1k. Colour is in vertex colours (painted light
ridges, dark grooves) multiplied by a flat material colour; the bridge
planks carry the generated wood texture (public/textures/wood.jpg).
Preview renders go to art/renders/plains-props/.
"""
import math
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import ROOT, link, render_views, reset_scene  # noqa: E402

OUT = ROOT / "public/models/plains-props.glb"
RENDERS = ROOT / "art/renders/plains-props"


# --- helpers -----------------------------------------------------------------------

def vc_material(name, rough=0.9, image=None, double=False):
    """Material = vertex colour (× optional image). The glTF exporter keeps both."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Roughness"].default_value = rough
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(image))
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        nt.links.new(tex.outputs["Color"], mul.inputs[6])
        nt.links.new(attr.outputs["Color"], mul.inputs[7])
        nt.links.new(mul.outputs[2], p.inputs["Base Color"])
    else:
        nt.links.new(attr.outputs["Color"], p.inputs["Base Color"])
    m.use_backface_culling = not double
    return m


class Builder:
    """Accumulates quads/triangles with per-corner colours and UVs into one mesh."""

    def __init__(self):
        self.verts, self.faces, self.cols, self.uvs, self.mats = [], [], [], [], []

    def grid(self, pts, cols, uvs=None, mat=0, closed_u=False):
        """pts[i][j]: rows i (v) by columns j (u). Quads between neighbours."""
        base = len(self.verts)
        rows, cn = len(pts), len(pts[0])
        for i in range(rows):
            for j in range(cn):
                self.verts.append(tuple(pts[i][j]))
        idx = lambda i, j: base + i * cn + (j % cn)
        jmax = cn if closed_u else cn - 1
        for i in range(rows - 1):
            for j in range(jmax):
                f = (idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j))
                self.faces.append(f)
                self.cols.append([cols[i][j], cols[i][(j + 1) % cn], cols[i + 1][(j + 1) % cn], cols[i + 1][j]])
                if uvs:
                    self.uvs.append([uvs[i][j], uvs[i][(j + 1) % cn], uvs[i + 1][(j + 1) % cn], uvs[i + 1][j]])
                else:
                    self.uvs.append([(0, 0)] * 4)
                self.mats.append(mat)

    def poly(self, pts, col, mat=0, uv=None):
        base = len(self.verts)
        self.verts += [tuple(p) for p in pts]
        self.faces.append(tuple(range(base, base + len(pts))))
        self.cols.append([col] * len(pts))
        self.uvs.append(uv or [(0, 0)] * len(pts))
        self.mats.append(mat)

    def box(self, center, size, col, mat=0, uv_scale=None, rot=None):
        """Axis-aligned box (optionally rotated about Z), UVs: U along the longest side."""
        cx, cy, cz = center
        sx, sy, sz = (s / 2 for s in size)
        R = rot or Matrix.Identity(3)
        c = lambda x, y, z: tuple(Vector((cx, cy, cz)) + R @ Vector((x, y, z)))
        P = [c(-sx, -sy, -sz), c(sx, -sy, -sz), c(sx, sy, -sz), c(-sx, sy, -sz),
             c(-sx, -sy, sz), c(sx, -sy, sz), c(sx, sy, sz), c(-sx, sy, sz)]
        quads = [(4, 5, 6, 7), (3, 2, 1, 0), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        for q in quads:
            uv = None
            if uv_scale:
                # Project onto the face plane; U along world Y (the span), V across.
                pts = [Vector(P[k]) for k in q]
                n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
                if abs(n.z) > abs(n.x) and abs(n.z) > abs(n.y):
                    uv = [(p.y * uv_scale, p.x * uv_scale * 2) for p in pts]
                elif abs(n.x) > abs(n.y):
                    uv = [(p.y * uv_scale, p.z * uv_scale * 2) for p in pts]
                else:
                    uv = [(p.x * uv_scale, p.z * uv_scale * 2) for p in pts]
            self.poly([P[k] for k in q], col, mat, uv)

    def build(self, name, materials, smooth=True):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.update()
        ca = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        uvl = me.uv_layers.new(name="UVMap")
        k = 0
        for fi, poly in enumerate(me.polygons):
            poly.use_smooth = smooth
            poly.material_index = self.mats[fi]
            for c, li in enumerate(poly.loop_indices):
                col = self.cols[fi][c]
                ca.data[li].color = (*col, 1.0)
                uvl.data[li].uv = self.uvs[fi][c]
                k += 1
        for m in materials:
            me.materials.append(m)
        obj = link(bpy.data.objects.new(name, me))
        return obj


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def srgb(h):
    """Hex sRGB → linear (vertex colours are stored linear for glTF)."""
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# --- rockbud -----------------------------------------------------------------------

SHELL_LIGHT, SHELL_DARK, SHELL_LIP = srgb("#a8a49a"), srgb("#5f5c57"), srgb("#c9c2b0")
FLESH, VINE, VINE_TIP = srgb("#3f4a2c"), srgb("#6f8f3e"), srgb("#a3bf5c")


def valve(b, sign, lift, rng, ns=6, nt=24, ridges=6):
    """One clam valve as a fan from the hinge (origin) toward +Y.

    Local frame: hinge at the origin, valve opens toward +Y, bulges toward
    +Z (upper, sign=+1) or -Z (lower). `lift` rotates the valve about the
    hinge (X axis) to open the clam.
    """
    R0, psi_max = 0.46, math.radians(80)
    H = 0.5 if sign > 0 else 0.07
    rot = Matrix.Rotation(lift, 3, "X")
    pts, cols = [], []
    for i in range(ns + 1):
        s = 0.06 + 0.94 * i / ns  # from hinge (0) to lip (1)
        row, crow = [], []
        for j in range(nt + 1):
            t = -1 + 2 * j / nt
            psi = t * psi_max
            r = R0 * s * (1 - 0.12 * t * t)
            x, y = math.sin(psi) * r * 1.15, math.cos(psi) * r
            # Highest toward the hinge, rolling down to the lip.
            dome = H * math.sin(math.pi * (0.14 + 0.86 * s)) ** 0.5 * (math.cos(t * math.pi / 2) ** 0.3)
            dome = max(dome, H * 0.02)
            rib = abs(math.sin((t * 0.5 + 0.5) * ridges * math.pi))
            rib = rib ** 0.6
            z = sign * (dome + (0.075 if sign > 0 else 0.02) * rib * (0.3 + 0.7 * s))
            p = rot @ Vector((x, y, z))
            row.append(p)
            shade = 0.15 + 0.85 * rib
            c = mix(SHELL_DARK, SHELL_LIGHT, shade * (0.85 + 0.15 * rng.random()))
            if s > 0.9:
                c = mix(c, SHELL_LIP, 0.5)
            crow.append(c)
        pts.append(row)
        cols.append(crow)
    b.grid(pts, cols)
    return pts


def vine(b, start, direction, length, rng, segs=7, radius=0.012):
    """A thin vine as a 4-sided tube trailing out and down onto the ground (z = 0)."""
    pts = []
    p = Vector(start)
    d = Vector(direction).normalized()
    for k in range(segs + 1):
        pts.append(p.copy())
        d = (d + Vector(((rng.random() - 0.5) * 0.5, (rng.random() - 0.5) * 0.5, -0.35))).normalized()
        p = p + d * (length / segs)
        if p.z < 0.012:
            p.z = 0.012
            d.z = max(d.z, 0)
    rows, cols = [], []
    for k, c in enumerate(pts):
        nxt = pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]
        tdir = nxt.normalized()
        side = tdir.cross(Vector((0, 0, 1)))
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(tdir).normalized()
        rr = radius * (1 - 0.6 * k / segs)
        ring = [c + (side * math.cos(a) + up * math.sin(a)) * rr for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2)]
        rows.append(ring)
        cols.append([mix(VINE, VINE_TIP, k / segs)] * 4)
    b.grid(rows, cols, closed_u=True)


def build_rockbud(name, open_, seed):
    rng = random.Random(seed)
    b = Builder()
    lift = math.radians(16) if open_ else math.radians(1)
    valve(b, +1, lift, rng)
    valve(b, -1, 0.0, rng)
    if open_:
        # Dark flesh filling the open mouth.
        # Dark flesh in the open mouth: a vertical lens just inside the lip.
        fl = []
        for i in range(12):
            a = 2 * math.pi * i / 12
            fl.append(Vector((math.cos(a) * 0.36, 0.3 - 0.04 * abs(math.cos(a)), 0.1 + math.sin(a) * 0.09)))
        b.poly(fl, FLESH)
        b.poly(list(reversed(fl)), FLESH)
    # Pose: lower valve resting on the ground, hinge at the back, mouth tilted
    # up and forward (like the clams in the style reference).
    b.verts = [(v[0], v[1] - 0.22, v[2] + 0.075) for v in b.verts]
    if open_:
        for k in range(5):
            ang = -0.8 + 0.4 * k + (rng.random() - 0.5) * 0.2
            start = Vector((math.sin(ang) * 0.3, 0.12 + math.cos(ang) * 0.1, 0.13 + rng.random() * 0.05))
            vine(b, start, (math.sin(ang) * 0.7, 0.9, 0.1), 0.6 + rng.random() * 0.7, rng)
    mat = vc_material("rockbud", rough=0.95, double=True)
    o = b.build(name, [mat])
    # Sink slightly so it sits in the rock, not on it.
    o.location.z = -0.04
    return o


# --- chrysalis ----------------------------------------------------------------------

PLATE_LIGHT, PLATE_DARK, PLATE_EDGE = srgb("#a39684"), srgb("#5c5246"), srgb("#c4b8a2")


CH_H, CH_R = 5.6, 2.35


def egg(az, h):
    """Egg-shaped mound, widest a third of the way up, top hunched toward -Y."""
    if h < 0.32:
        r = CH_R * (0.9 + 0.1 * math.sin(h / 0.32 * math.pi / 2))
    else:
        q = (h - 0.32) / 0.68
        r = CH_R * math.sqrt(max(0.0, 1 - q * q)) ** 0.85
    r *= 1 + 0.06 * math.cos(az * 2)  # slightly oval
    lean = 0.55 * h * h
    return Vector((math.sin(az) * r, math.cos(az) * r - lean, h * CH_H)), Vector((0, -lean, h * CH_H))


def build_chrysalis(seed=5):
    rng = random.Random(seed)
    b = Builder()
    # Core under the plates (shows in the gaps as dark crevices).
    core, ccol = [], []
    for i in range(10):
        h = min(0.99, i / 9)
        core.append([egg(2 * math.pi * j / 18, h)[0] * 0.94 for j in range(18)])
        ccol.append([PLATE_DARK] * 18)
    b.grid(core, ccol, closed_u=True)
    # Long leaf-shaped plates running diagonally up and round the egg, each
    # overlapping its neighbours like the scales of a twisted cone.
    rows = [(0.0, 0.42, 7), (0.2, 0.62, 7), (0.42, 0.82, 6), (0.62, 0.97, 5), (0.82, 1.03, 3)]
    twist = 1.25  # radians of azimuth per unit height fraction
    for ri, (h0, h1, n) in enumerate(rows):
        off = rng.random() * math.pi
        for k in range(n):
            a0 = off + 2 * math.pi * k / n + (rng.random() - 0.5) * 0.25
            half = math.pi / n * 1.35
            hh0 = h0 + (rng.random() - 0.5) * 0.04
            hh1 = min(1.0, h1 + (rng.random() - 0.5) * 0.04)
            nu, nv = 11, 8
            pts, cols = [], []
            for i in range(nv + 1):
                v = i / nv  # 0 = upper tip, 1 = lower end (lifted, overlapping the plate below)
                h = hh1 - (hh1 - hh0) * v
                width = math.sin(math.pi * (0.12 + 0.8 * v)) ** 0.7
                row, crow = [], []
                for j in range(nu + 1):
                    u = -1 + 2 * j / nu
                    az = a0 + twist * (h - (hh0 + hh1) / 2) + u * half * width
                    base, axis = egg(az, min(h, 0.995))
                    out = base - axis
                    out = out.normalized() if out.length > 1e-4 else Vector((0, 0, 1))
                    lift = 0.04 + 0.34 * v ** 1.8          # lower end stands proud
                    bulge = 0.12 * math.cos(u * math.pi / 2)  # convex across the plate
                    crease = 0.06 * abs(math.sin(u * math.pi * 2.5))
                    p = base + out * (lift + bulge - crease) * (0.6 + 0.4 * width)
                    if h > 0.97:
                        p.z += 0.12
                    row.append(p)
                    shade = 0.5 + 0.4 * math.cos(u * math.pi / 2) - 0.45 * crease / 0.06
                    c = mix(PLATE_DARK, PLATE_LIGHT, max(0, min(1, shade)) * (0.85 + 0.15 * rng.random()))
                    if v > 0.82 or abs(u) > 0.85:
                        c = mix(c, PLATE_EDGE, 0.45)
                    crow.append(c)
                pts.append(row)
                cols.append(crow)
            b.grid(pts, cols)
    mat = vc_material("chrysalis", rough=0.85, double=True)
    o = b.build("chrysalis", [mat])
    o.location.z = -0.2
    return o


# --- bridge ---------------------------------------------------------------------------

WOOD_TINT, BEAM_TINT, BOLT = (1.0, 1.0, 1.0), (0.55, 0.5, 0.46), srgb("#6a625a")


def build_bridge(length=18.0, seed=3):
    """Span along Blender +Y (glTF -Z), top of the deck at z = 0, centred on the origin."""
    rng = random.Random(seed)
    b = Builder()
    planks = 7
    width = 3.15
    pw = width / planks
    for k in range(planks):
        x = -width / 2 + pw * (k + 0.5) + (rng.random() - 0.5) * 0.02
        l = length - rng.random() * 0.3
        y = (rng.random() - 0.5) * 0.25
        t = 0.11 + rng.random() * 0.03
        tint = mix(WOOD_TINT, (0.78, 0.74, 0.7), rng.random() * 0.6)
        b.box((x, y, -t / 2 + (rng.random() - 0.5) * 0.015), (pw - 0.025, l, t), tint, mat=0, uv_scale=1 / 2.2)
    # Two thick beams under the deck, along the span.
    for side in (-1, 1):
        b.box((side * 0.95, 0, -0.13 - 0.2), (0.34, length - 0.6, 0.4), BEAM_TINT, mat=0, uv_scale=1 / 2.2)
    # Bolts through the planks into the beams, every 1.5 m.
    n = int(length / 1.5)
    for i in range(n + 1):
        y = -length / 2 + 0.5 + i * (length - 1.0) / n
        for side in (-1, 1):
            for dx in (-0.1, 0.1):
                b.box((side * 0.95 + dx, y, 0.0), (0.05, 0.05, 0.02), BOLT, mat=0)
    mat = vc_material("bridge_wood", rough=0.92, image=ROOT / "public/textures/wood.jpg")
    return b.build("bridge", [mat], smooth=False)


# --- main ---------------------------------------------------------------------------------

def export(objs):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    kw = dict(filepath=str(OUT), export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_materials="EXPORT", export_image_format="JPEG")
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="ACTIVE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    print(f"exported {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


def main():
    reset_scene()
    closed = build_rockbud("rockbud_closed", False, 1)
    opened = build_rockbud("rockbud_open", True, 2)
    chrys = build_chrysalis()
    bridge = build_bridge()
    objs = [closed, opened, chrys, bridge]
    for o in objs:
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        print(f"{o.name}: {tris} triangles")
    export(objs)
    if "--no-render" in sys.argv:
        return
    # Preview: lay them out side by side on a ground plane.
    closed.location = (-1.0, 0, 0)
    opened.location = (0.2, 0, 0)
    chrys.location = (5, 3, 0)
    bridge.location = (-6, 5, 0)
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.01))
    ground = bpy.context.object
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.62, 0.5, 0.36, 1)
    ground.data.materials.append(gm)
    link(bpy.data.objects.new("preview_key", None))  # lib: skip its studio area lights
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.5
    so = link(bpy.data.objects.new("sun", sun))
    so.rotation_euler = (math.radians(35), 0, math.radians(30))
    bpy.context.scene.view_settings.exposure = -1.6
    render_views(RENDERS / "props", [
        ("rockbuds", (-0.2, 2.6, 1.2), (-0.4, 0.0, 0.25), None),
        ("chrysalis", (4, -10, 2.6), (5, 3, 2.6), None),
        ("all", (-2, -16, 7), (0, 3, 1), None),
    ], size=(900, 600), samples=24)


if __name__ == "__main__":
    main()
