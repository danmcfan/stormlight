"""Build the Shardplate as rigid pieces that ride on the game skeleton.

Input:  the construction references in art/source/shardplate-*/nb21-v1
        (shapes only: the skeleton's proportions win over the stocky drawings)
Output: public/models/shardplate.glb and art/renders/shardplate/*.png

Every piece is one mesh object named for the bone it rides on, with its
origin at that bone's joint, in the body space src/render/humanoid.ts uses
(metres, +Y up, +Z forward, +X = the character's left). No skinning: the game
parents each piece to the matching group, so the procedural animation (arm IK,
walk cycle, sword poses) drives the Plate unchanged.

  piece          parent group (humanoid.ts)   origin
  helm           helm group                   torso y 0.92
  gorget         torso                        waist (torso origin)
  breastplate    torso                        waist
  abdomen        torso                        waist
  pauldron_l/r   torso                        shoulder (±0.42, 0.62)
  upperarm_l/r   arm upper                    shoulder
  forearm_l/r    arm lower                    elbow
  gauntlet_l/r   arm lower                    wrist (0.36 below the elbow)
  belt           body                         waist (0, 1.08, 0)
  fauld_front    body (swings with the legs)  (0, 1.0, 0.17)
  fauld_back     body (swings with the legs)  (0, 1.0, -0.15)
  thigh_l/r      leg upper                    hip (±0.17, 1.0)
  shin_l/r       leg lower                    knee (0.47 below the hip)
  boot_l/r       leg lower                    ankle (0.46 below the knee)
  helm_crest     helm group (enemy only)      as helm

Materials (names the game matches on): plate, plate_dark, trim, glow.

Geometry is scripted: lofted superellipse sections (smooth Catmull-Rom between
key sections), tubes for the raised enamel trim, solid shell patches for
tassets, and extruded leaf slabs for the fauld.

  .venv-blender/bin/python scripts/blender/build_shardplate.py [--no-render]
"""
import math
import sys

import bpy
import bmesh  # noqa: E402  (needs bpy imported first)
import numpy as np

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import ROOT, deg, export_glb, link, material, render_views, reset_scene  # noqa: E402

TAU = math.tau
FRONT = math.pi / 2      # loft angle facing +Z (forward)
BACK = -math.pi / 2

# Skeleton (body space), mirrors src/render/humanoid.ts.
HIP_Y, WAIST_Y = 1.0, 1.08
SHOULDER = (0.42, 0.62)            # from the waist
UPPER_ARM, LOWER_ARM = 0.40, 0.36
THIGH, SHIN = 0.47, 0.46
HELM_Y = 0.92                      # from the waist
LEG_X = 0.17


# --- Small linear-algebra helpers (game space, numpy) ------------------------------

def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


class Frame:
    """Rigid transform: p_world = R @ p_local + t (all in game space)."""

    def __init__(self, R=None, t=(0, 0, 0)):
        self.R = np.eye(3) if R is None else np.asarray(R, float)
        self.t = np.asarray(t, float)

    def __call__(self, p):
        return self.R @ np.asarray(p, float) + self.t


ID = Frame()


def catmull(vals, u):
    """Catmull-Rom through vals (rows) at continuous index u."""
    n = len(vals)
    i = min(int(math.floor(u)), n - 2)
    f = u - i
    p0 = vals[max(i - 1, 0)]
    p1, p2 = vals[i], vals[i + 1]
    p3 = vals[min(i + 2, n - 1)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f
                  + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)


def spow(v, e):
    return math.copysign(abs(v) ** e, v)


# --- Mesh accumulation --------------------------------------------------------------

MATS = {}


class Piece:
    """Collects closed sub-meshes (game space) for one exported object."""

    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []
        self.mats = []

    def add(self, verts, faces, mat):
        base = len(self.verts)
        self.verts.extend([tuple(map(float, v)) for v in verts])
        self.faces.extend([tuple(base + i for i in f) for f in faces])
        self.mats.extend([mat] * len(faces))

    def build(self):
        names = list(dict.fromkeys(self.mats))
        mesh = bpy.data.meshes.new(self.name)
        # Game (x, y, z) -> Blender (x, -z, y); the glTF exporter maps it back.
        mesh.from_pydata([(x, -z, y) for x, y, z in self.verts], [], self.faces)
        for n in names:
            mesh.materials.append(MATS[n])
        mesh.polygons.foreach_set("material_index", [names.index(m) for m in self.mats])
        mesh.polygons.foreach_set("use_smooth", [True] * len(self.faces))
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        obj = link(bpy.data.objects.new(self.name, mesh))
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_auto_smooth(angle=deg(40))
        return obj


# --- Primitives ---------------------------------------------------------------------

class Loft:
    """A closed solid through key superellipse sections stacked along local y.

    Each section: dict(y, rx, rf, rb, cx=0, cz=0, p=2) — half-width rx, depth to
    the front rf (+z) and back rb (-z), centre offset, squareness p (2 = ellipse).
    Parameter t runs 0..len-1 through the sections; angle th: 0 = +x, pi/2 = +z.
    """

    KEYS = ("y", "rx", "rf", "rb", "cx", "cz", "p")

    def __init__(self, sections, frame=ID):
        rows = []
        for s in sections:
            s = {"cx": 0.0, "cz": 0.0, "p": 2.0, **s}
            rows.append([s[k] for k in self.KEYS])
        self.rows = np.array(rows, float)
        self.n = len(rows)
        self.frame = frame

    def sec(self, t):
        return catmull(self.rows, min(max(t, 0.0), self.n - 1.0))

    def local(self, t, th, off=0.0):
        y, rx, rf, rb, cx, cz, p = self.sec(t)
        c, s = math.cos(th), math.sin(th)
        e = 2.0 / max(p, 0.5)
        rz = rf if s >= 0 else rb
        x = cx + (max(rx, 0) + off) * spow(c, e)
        z = cz + (max(rz, 0) + off) * spow(s, e)
        return np.array([x, y, z])

    def point(self, t, th, off=0.0):
        return self.frame(self.local(t, th, off))

    def centre(self, t):
        y, _, _, _, cx, cz, _ = self.sec(t)
        return self.frame((cx, y, cz))

    def normal(self, t, th):
        h = 1e-3
        dt = self.point(t + h, th) - self.point(t - h, th)
        da = self.point(t, th + h) - self.point(t, th - h)
        n = np.cross(dt, da)
        ln = np.linalg.norm(n)
        if ln < 1e-9:
            n = self.point(t, th) - self.centre(t)
            ln = np.linalg.norm(n) or 1
        n = n / ln
        if np.dot(n, self.point(t, th) - self.centre(t)) < 0:
            n = -n
        return n

    def surf(self, t, th, off=0.0):
        """Point offset along the true surface normal (for trim and patches)."""
        return self.point(t, th) + self.normal(t, th) * off

    def mesh(self, piece, mat, seg=18, sub=2):
        ts = np.linspace(0, self.n - 1, (self.n - 1) * sub + 1)
        verts, faces = [], []
        for t in ts:
            for j in range(seg):
                verts.append(self.point(t, TAU * j / seg))
        R = len(ts)
        for i in range(R - 1):
            for j in range(seg):
                a, b = i * seg + j, i * seg + (j + 1) % seg
                faces.append((a, b, b + seg, a + seg))
        bot, top = len(verts), len(verts) + 1
        verts += [self.centre(0), self.centre(self.n - 1)]
        for j in range(seg):
            faces.append((bot, (j + 1) % seg, j))
            o = (R - 1) * seg
            faces.append((top, o + j, o + (j + 1) % seg))
        piece.add(verts, faces, mat)
        return self


def tube(piece, mat, pts, r=0.008, sides=4, closed=False):
    """A round bar along a polyline (raised enamel trim, ridges)."""
    pts = [np.asarray(p, float) for p in pts]
    n = len(pts)
    verts, faces = [], []
    prev_u = None
    for i, p in enumerate(pts):
        if closed:
            d = pts[(i + 1) % n] - pts[i - 1]
        else:
            d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        d = d / (np.linalg.norm(d) or 1)
        ref = prev_u if prev_u is not None else (np.array([0, 1, 0]) if abs(d[1]) < 0.9 else np.array([1, 0, 0]))
        u = ref - d * np.dot(ref, d)
        u /= np.linalg.norm(u) or 1
        prev_u = u
        v = np.cross(d, u)
        for k in range(sides):
            a = TAU * k / sides
            verts.append(p + r * (math.cos(a) * u + math.sin(a) * v))
    segs = n if closed else n - 1
    for i in range(segs):
        for k in range(sides):
            a = i * sides + k
            b = i * sides + (k + 1) % sides
            a2 = ((i + 1) % n) * sides + k
            b2 = ((i + 1) % n) * sides + (k + 1) % sides
            faces.append((a, b, b2, a2))
    if not closed:
        faces.append(tuple(range(sides))[::-1])
        faces.append(tuple((n - 1) * sides + k for k in range(sides)))
    piece.add(verts, faces, mat)


def ring(piece, mat, loft, t, r=0.008, off=0.0, th0=0.0, th1=TAU, n=None):
    closed = abs(th1 - th0 - TAU) < 1e-6
    if n is None:  # about one segment per 6 cm of length
        probe = [loft.point(t, th) for th in np.linspace(th0, th1, 17)]
        n = max(10, int(sum(np.linalg.norm(b - a) for a, b in zip(probe, probe[1:])) / 0.06))
    ths = np.linspace(th0, th1, n, endpoint=not closed)
    tube(piece, mat, [loft.surf(t, th, off) for th in ths], r=r, closed=closed)


def path(piece, mat, loft, tths, r=0.008, off=0.0, n=8):
    """Trim along a path through (t, th) points, sampled smoothly on the surface."""
    arr = np.array(tths, float)
    pts = []
    for k in range(n):
        u = k / (n - 1) * (len(arr) - 1)
        t, th = catmull(arr, u)
        pts.append(loft.surf(t, th, off))
    tube(piece, mat, pts, r=r)


def patch(piece, mat, loft, t0, t1, th0, th1, off=0.0, thick=0.012, nt=6, nth=8, flare=None):
    """A solid curved plate lying on (off the surface of) a loft region."""
    outer, inner = [], []
    for i in range(nt + 1):
        t = t0 + (t1 - t0) * i / nt
        extra = flare(i / nt) if flare else 0.0
        for j in range(nth + 1):
            th = th0 + (th1 - th0) * j / nth
            p, nrm = loft.point(t, th), loft.normal(t, th)
            outer.append(p + nrm * (off + extra + thick))
            inner.append(p + nrm * (off + extra))
    W = nth + 1
    N = len(outer)
    verts = outer + inner
    faces = []
    for i in range(nt):
        for j in range(nth):
            a = i * W + j
            faces.append((a, a + 1, a + W + 1, a + W))
            faces.append((N + a, N + a + W, N + a + W + 1, N + a + 1))
    border = [(0, j) for j in range(nth)] + [(i, nth) for i in range(nt)] + \
             [(nt, j) for j in range(nth, 0, -1)] + [(i, 0) for i in range(nt, 0, -1)]
    for k in range(len(border)):
        i0, j0 = border[k]
        i1, j1 = border[(k + 1) % len(border)]
        a, b = i0 * W + j0, i1 * W + j1
        faces.append((a, b, N + b, N + a))
    piece.add(verts, faces, mat)
    # Border points (outer surface) so trim can follow the plate's edge.
    return [outer[i * W + j] for i, j in border] + [outer[border[0][0] * W + border[0][1]]]


def slab(piece, mat, outline, thick, frame):
    """Extrude a 2D outline (local x, y) by `thick` along local z, then place it."""
    n = len(outline)
    verts = [frame((x, y, thick / 2)) for x, y in outline] + [frame((x, y, -thick / 2)) for x, y in outline]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    piece.add(verts, faces, mat)


def disc(piece, mat, centre, normal, r, thick, seg=12, rim=None):
    """A round boss (pauldron disc, couter): cylinder facing `normal`, domed top."""
    nrm = np.asarray(normal, float)
    nrm /= np.linalg.norm(nrm)
    ref = np.array([0, 1, 0]) if abs(nrm[1]) < 0.9 else np.array([1, 0, 0])
    u = np.cross(nrm, ref)
    u /= np.linalg.norm(u)
    v = np.cross(nrm, u)
    c = np.asarray(centre, float)
    rings = [(-thick * 0.5, r), (thick * 0.5, r), (thick * 0.8, r * 0.75), (thick, 0.0)]
    verts, faces = [], []
    for h, rr in rings:
        for k in range(seg):
            a = TAU * k / seg
            verts.append(c + nrm * h + rr * (math.cos(a) * u + math.sin(a) * v))
    for i in range(len(rings) - 1):
        for k in range(seg):
            a, b = i * seg + k, i * seg + (k + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    faces.append(tuple(range(seg))[::-1])
    piece.add(verts, faces, mat)
    if rim:
        pts = [c + nrm * (thick * 0.5) + r * (math.cos(a) * u + math.sin(a) * v)
               for a in np.linspace(0, TAU, seg, endpoint=False)]
        tube(piece, rim, pts, r=0.007, closed=True)


def ellipsoid(piece, mat, centre, radii, seg=16, rings=8, frame=ID):
    secs = []
    for i in range(rings + 1):
        a = -math.pi / 2 + math.pi * i / rings
        r = math.cos(a)
        secs.append(dict(y=centre[1] + radii[1] * math.sin(a), rx=radii[0] * r, rf=radii[2] * r,
                         rb=radii[2] * r, cx=centre[0], cz=centre[2]))
    L = Loft(secs, frame)
    L.mesh(piece, mat, seg=seg, sub=1)
    return L


# --- The pieces ---------------------------------------------------------------------
# All sizes in metres. Proportions follow the game skeleton; shapes follow the
# references (front, side/back, helm).

def build_helm(enemy_crest=False):
    p = Piece("helm")
    L = Loft([
        dict(y=-0.07, rx=0.125, rf=0.145, rb=0.135),
        dict(y=0.04, rx=0.145, rf=0.165, rb=0.152, p=2.3),
        dict(y=0.16, rx=0.155, rf=0.172, rb=0.16, p=2.2),
        dict(y=0.26, rx=0.14, rf=0.15, rb=0.152),
        dict(y=0.315, rx=0.1, rf=0.105, rb=0.115),
        dict(y=0.345, rx=0.03, rf=0.03, rb=0.035),
    ]).mesh(p, "plate", seg=24, sub=3)
    # Faceted faceplate: a raised, slightly pointed visor over the front.
    face = Loft([
        dict(y=-0.07, rx=0.13, rf=0.175, rb=0.0, p=1.5),
        dict(y=0.08, rx=0.148, rf=0.195, rb=0.0, p=1.5),
        dict(y=0.22, rx=0.15, rf=0.185, rb=0.0, p=1.7),
        dict(y=0.29, rx=0.11, rf=0.13, rb=0.0, p=2.0),
    ])
    # Only the front half matters: a shell patch over it.
    patch(p, "plate", face, 0.0, 3.0, deg(15), deg(165), off=-0.006, thick=0.012, nt=8, nth=10)
    # Eye slit: a dark recess with the glowing slit inside it.
    t_slit = 1.6
    patch(p, "plate_dark", face, t_slit - 0.17, t_slit + 0.17, FRONT - deg(46), FRONT + deg(46),
          off=0.006, thick=0.003, nt=2, nth=10)
    patch(p, "glow", face, t_slit - 0.08, t_slit + 0.08, FRONT - deg(40), FRONT + deg(40),
          off=0.0085, thick=0.002, nt=1, nth=10)
    # Centre ridge down the faceplate and over the crown.
    path(p, "plate", face, [(t_slit - 0.3, FRONT), (0.9, FRONT), (0.1, FRONT)], r=0.009, off=0.006, n=10)
    crown = [L.surf(t, FRONT) for t in np.linspace(3.0, 4.95, 6)] + \
            [L.surf(t, BACK) for t in np.linspace(4.95, 1.2, 9)]
    tube(p, "plate", crown, r=0.013)
    # Enamel lines framing the faceplate (helm reference).
    for s in (1, -1):
        path(p, "trim", face, [(3.0, FRONT + s * deg(10)), (2.7, FRONT + s * deg(35)),
                               (2.0, FRONT + s * deg(62)), (1.0, FRONT + s * deg(72)), (0.05, FRONT + s * deg(70))],
             r=0.0065, off=0.006, n=18)
    ring(p, "trim", L, 0.25, r=0.0075)
    if enemy_crest:
        c = Piece("helm_crest")
        for s in (1, -1):
            tube(c, "plate", [L.surf(t, th, 0.0) + np.array([0, dy, 0]) for t, th, dy in (
                (3.7, FRONT + s * 0.5, 0.0), (4.2, s * 0.9 + (0 if s > 0 else math.pi), 0.03),
                (4.0, BACK + s * 0.6, 0.06), (3.0, BACK + s * 0.45, 0.10))], r=0.02)
        return p, c
    return p, None


def build_gorget():
    p = Piece("gorget")
    L = Loft([
        dict(y=0.73, rx=0.3, rf=0.245, rb=0.2, p=2.2),
        dict(y=0.79, rx=0.245, rf=0.205, rb=0.185),
        dict(y=0.86, rx=0.195, rf=0.19, rb=0.185),
        dict(y=0.92, rx=0.18, rf=0.185, rb=0.18),
        dict(y=0.932, rx=0.165, rf=0.17, rb=0.165),
    ]).mesh(p, "plate", seg=28, sub=2)
    ring(p, "trim", L, 0.12, r=0.008)
    ring(p, "trim", L, 3.7, r=0.007)
    # The V-shaped front of the collar (helm reference).
    for s in (1, -1):
        path(p, "trim", L, [(2.6, FRONT + s * deg(48)), (1.3, FRONT + s * deg(30)), (0.5, FRONT + s * deg(8))],
             r=0.0065, n=12)
    return p


def build_breastplate():
    p = Piece("breastplate")
    L = Loft([
        dict(y=0.18, rx=0.255, rf=0.165, rb=0.145, p=2.2),
        dict(y=0.30, rx=0.29, rf=0.205, rb=0.155, p=2.3),
        dict(y=0.44, rx=0.33, rf=0.245, rb=0.17, p=2.4),
        dict(y=0.58, rx=0.345, rf=0.25, rb=0.175, p=2.5),
        dict(y=0.70, rx=0.33, rf=0.215, rb=0.17, p=2.4),
        dict(y=0.79, rx=0.25, rf=0.155, rb=0.145),
        dict(y=0.83, rx=0.12, rf=0.09, rb=0.09),
    ]).mesh(p, "plate", seg=28, sub=2)
    # Sapphire, fist-sized, in a raised setting at the centre of the chest.
    t_gem = 2.85
    c = L.surf(t_gem, FRONT, 0.0)
    nrm = L.normal(t_gem, FRONT)
    disc(p, "plate", c, nrm, 0.07, 0.03, seg=6, rim="trim")
    gem = Piece("gem")  # scratch: built at the origin, then set into the chest
    ellipsoid(gem, "glow", (0, 0, 0), (0.042, 0.055, 0.03), seg=6, rings=4)
    R = np.column_stack([np.cross([0, 1, 0], nrm), [0, 1, 0], nrm])
    R[:, 1] = np.cross(nrm, R[:, 0])
    p.add([R @ np.asarray(v) + c + nrm * 0.03 for v in gem.verts], gem.faces, "glow")
    # Enamel lines: from the collar down to the gem, under the chest, down the
    # abdomen (front reference), and the back's yoke and waist lines.
    for s in (1, -1):
        path(p, "trim", L, [(5.4, FRONT + s * deg(55)), (4.4, FRONT + s * deg(32)), (3.3, FRONT + s * deg(10))], n=16)
        path(p, "trim", L, [(2.5, FRONT + s * deg(4)), (2.15, FRONT + s * deg(30)), (2.3, FRONT + s * deg(62)),
                            (2.9, FRONT + s * deg(85))], n=18)
        path(p, "trim", L, [(2.12, FRONT + s * deg(18)), (1.0, FRONT + s * deg(22)), (0.1, FRONT + s * deg(24))], n=12)
        path(p, "trim", L, [(5.2, BACK + s * deg(60)), (4.5, BACK + s * deg(30)), (4.3, BACK)], n=14)
        path(p, "trim", L, [(2.2, BACK + s * deg(80)), (2.6, BACK + s * deg(30)), (2.5, BACK)], n=14)
    ring(p, "trim", L, 0.12, r=0.008)
    return p


def build_abdomen():
    p = Piece("abdomen")
    # Two overlapping lames: each a little wider at the top so it sits over the next.
    for y0, y1, w in ((-0.08, 0.12, 0.245), (0.07, 0.25, 0.26)):
        L = Loft([
            dict(y=y0, rx=w - 0.01, rf=0.155, rb=0.135, p=2.2),
            dict(y=(y0 + y1) / 2, rx=w, rf=0.165, rb=0.14, p=2.2),
            dict(y=y1, rx=w + 0.012, rf=0.172, rb=0.145, p=2.2),
        ]).mesh(p, "plate", seg=28, sub=2)
        ring(p, "plate", L, 0.08, r=0.009)
    return p


def build_belt():
    """Hip belt on the body (doesn't twist with the torso). Origin: the waist."""
    p = Piece("belt")
    L = Loft([
        dict(y=0.03, rx=0.27, rf=0.18, rb=0.16, p=2.4),
        dict(y=-0.05, rx=0.285, rf=0.185, rb=0.165, p=2.4),
        dict(y=-0.13, rx=0.29, rf=0.18, rb=0.165, p=2.4),
    ]).mesh(p, "plate", seg=28, sub=2)
    ring(p, "trim", L, 0.25, r=0.0085)
    ring(p, "trim", L, 1.85, r=0.0085)
    return p


def leaf(piece, mat, w, h, thick, frame, nu=2, nv=4, bulge=0.012):
    """A leaf-shaped plate, convex across its width so it doesn't flash like a mirror.

    Local: top edge centred on the origin, hanging down -y, facing +z.
    """
    def hw(v):  # half-width down the leaf: straight sides, then a rounded point
        return 0.5 if v < 0.45 else 0.5 * math.cos((v - 0.45) / 0.55 * math.pi / 2) + 0.004
    grid = []
    for side, sgn in (("front", 1), ("back", -1)):
        for i in range(nv + 1):
            v = i / nv
            for j in range(nu + 1):
                u = j / nu * 2 - 1
                z = sgn * thick / 2 + bulge * (1 - u * u) * (1 - 0.5 * v)
                grid.append(frame((u * hw(v) * w, -v * h, z)))
    W, N = nu + 1, (nu + 1) * (nv + 1)
    faces = []
    for i in range(nv):
        for j in range(nu):
            a = i * W + j
            faces.append((a, a + 1, a + W + 1, a + W))
            faces.append((N + a, N + a + W, N + a + W + 1, N + a + 1))
    border = [(0, j) for j in range(nu)] + [(i, nu) for i in range(nv)] + \
             [(nv, j) for j in range(nu, 0, -1)] + [(i, 0) for i in range(nv, 0, -1)]
    for k in range(len(border)):
        (i0, j0), (i1, j1) = border[k], border[(k + 1) % len(border)]
        a, b = i0 * W + j0, i1 * W + j1
        faces.append((a, b, N + b, N + a))
    piece.add(grid, faces, mat)


def leaves(p, rows, back=False):
    """Fish-scale rows of leaf plates hanging from the origin (front or back)."""
    sgn = -1 if back else 1
    for n, w, h, y, z in rows:
        for k in range(n):
            x = (k - (n - 1) / 2) * w * 0.82
            # Lower rows sit behind the ones above; leaves hang plumb (tilted up, they mirror the sun).
            fr = Frame(rot_y(0 if not back else math.pi) @ rot_x(0.04) @ rot_y(-x * 0.9), (x, y, sgn * z))
            leaf(p, "plate", w, h, 0.012, fr)


def build_fauld():
    front = Piece("fauld_front")
    # (count, width, height, top y, z offset) from the top row down.
    leaves(front, [(4, 0.1, 0.2, 0.0, 0.0), (3, 0.1, 0.21, -0.085, -0.012),
                   (2, 0.1, 0.22, -0.17, -0.024), (1, 0.11, 0.24, -0.25, -0.036)])
    back = Piece("fauld_back")
    leaves(back, [(4, 0.1, 0.19, 0.0, 0.0), (3, 0.1, 0.2, -0.085, -0.012),
                  (2, 0.1, 0.21, -0.17, -0.024)], back=True)
    return front, back


def build_pauldron(s):
    """s = +1 left (+x), -1 right. Origin: the shoulder joint."""
    p = Piece(f"pauldron_{'l' if s > 0 else 'r'}")
    tilt = Frame(rot_z(-s * deg(24)), (s * 0.05, 0.03, 0.0))
    dome = Loft([
        dict(y=-0.17, rx=0.185, rf=0.2, rb=0.19, p=2.3),
        dict(y=-0.06, rx=0.2, rf=0.21, rb=0.2, p=2.3),
        dict(y=0.06, rx=0.175, rf=0.185, rb=0.18),
        dict(y=0.13, rx=0.11, rf=0.12, rb=0.115),
        dict(y=0.16, rx=0.02, rf=0.02, rb=0.02),
    ], tilt).mesh(p, "plate", seg=24, sub=2)
    ring(p, "trim", dome, 0.15, r=0.0085)
    ring(p, "trim", dome, 1.0, r=0.0075)
    # Two lames stepping down over the upper arm.
    for k, (y0, y1, r) in enumerate(((-0.25, -0.15, 0.178), (-0.32, -0.22, 0.165))):
        fr = Frame(rot_z(-s * deg(24 - 6 * (k + 1))), (s * (0.05 + 0.012 * (k + 1)), 0.03, 0.0))
        lame = Loft([dict(y=y0, rx=r, rf=r + 0.012, rb=r + 0.005, p=2.3),
                     dict(y=y1, rx=r + 0.012, rf=r + 0.022, rb=r + 0.015, p=2.3)], fr).mesh(p, "plate", seg=20, sub=2)
        ring(p, "trim", lame, 0.12, r=0.0075)
    # Raised flange on the inner top edge (haute-piece) and the round discs.
    fl = Loft([dict(y=0.0, rx=0.016, rf=0.15, rb=0.15, p=2.5),
               dict(y=0.09, rx=0.014, rf=0.14, rb=0.14, p=2.5),
               dict(y=0.15, rx=0.01, rf=0.11, rb=0.11, p=2.5)],
              Frame(rot_z(s * deg(12)), (-s * 0.06, 0.08, 0.0))).mesh(p, "plate", seg=18, sub=2)
    path(p, "trim", fl, [(0.3, FRONT + 0.2), (1.9, FRONT), (2.0, 0), (1.9, BACK), (0.3, BACK - 0.2)], r=0.006, n=18)
    for th in (FRONT + s * deg(30), BACK - s * deg(30)):   # front and back, toward the arm
        disc(p, "plate", dome.surf(0.9, th, -0.01), dome.normal(0.9, th), 0.065, 0.03, rim="plate")
    return p


def build_upperarm(s):
    p = Piece(f"upperarm_{'l' if s > 0 else 'r'}")
    L = Loft([
        dict(y=0.07, rx=0.03, rf=0.03, rb=0.03),
        dict(y=0.04, rx=0.085, rf=0.085, rb=0.085),
        dict(y=-0.04, rx=0.1, rf=0.1, rb=0.1),
        dict(y=-0.2, rx=0.097, rf=0.097, rb=0.097),
        dict(y=-0.33, rx=0.088, rf=0.09, rb=0.09),
        dict(y=-0.39, rx=0.075, rf=0.075, rb=0.075),
    ]).mesh(p, "plate", seg=18, sub=2)
    ring(p, "plate", L, 2.5, r=0.009)
    ring(p, "trim", L, 3.6, r=0.007)
    return p


def build_forearm(s):
    """Couter (elbow) + vambrace. Origin: the elbow; the arm hangs along -y."""
    p = Piece(f"forearm_{'l' if s > 0 else 'r'}")
    ellipsoid(p, "plate", (0, 0.0, -0.01), (0.1, 0.1, 0.105), seg=16, rings=8)
    # Fan on the point of the elbow (back, slightly outward).
    disc(p, "plate", (s * 0.03, 0.0, -0.095), (s * 0.35, 0, -1), 0.06, 0.03, rim="trim")
    L = Loft([
        dict(y=-0.04, rx=0.085, rf=0.085, rb=0.085),
        dict(y=-0.14, rx=0.088, rf=0.09, rb=0.09),
        dict(y=-0.27, rx=0.108, rf=0.11, rb=0.108),
        dict(y=-0.33, rx=0.116, rf=0.118, rb=0.116),
        dict(y=-0.345, rx=0.1, rf=0.1, rb=0.1),
    ]).mesh(p, "plate", seg=18, sub=2)
    ring(p, "trim", L, 0.4, r=0.007)
    ring(p, "trim", L, 3.0, r=0.0075)
    outer = 0.0 if s > 0 else math.pi   # loft angle facing away from the body
    path(p, "trim", L, [(2.9, outer), (1.6, outer + s * 0.1), (1.2, outer - s * 0.5)], r=0.006, n=10)
    return p


def build_gauntlet(s):
    """Origin: the wrist (0.36 below the elbow). The grip passes ~0.06 below it."""
    p = Piece(f"gauntlet_{'l' if s > 0 else 'r'}")
    cuff = Loft([
        dict(y=0.06, rx=0.104, rf=0.106, rb=0.104),
        dict(y=0.0, rx=0.112, rf=0.116, rb=0.112),
        dict(y=-0.035, rx=0.085, rf=0.09, rb=0.085),
    ]).mesh(p, "plate", seg=24, sub=2)
    ring(p, "trim", cuff, 0.9, r=0.0065)
    fist = Loft([
        dict(y=-0.02, rx=0.075, rf=0.08, rb=0.07, p=2.6),
        dict(y=-0.075, rx=0.083, rf=0.1, rb=0.074, p=3.0),
        dict(y=-0.14, rx=0.08, rf=0.1, rb=0.07, p=3.0),
        dict(y=-0.175, rx=0.062, rf=0.074, rb=0.056, p=2.6),
    ]).mesh(p, "plate", seg=18, sub=2)
    # Knuckle ridges across the back of the fingers and a thumb.
    for t in (1.1, 1.9, 2.6):
        path(p, "plate_dark", fist, [(t, FRONT - deg(70)), (t, FRONT), (t, FRONT + deg(70))], r=0.006, off=-0.002, n=6)
    Loft([dict(y=-0.03, rx=0.03, rf=0.03, rb=0.03),
          dict(y=-0.09, rx=0.028, rf=0.028, rb=0.028),
          dict(y=-0.11, rx=0.01, rf=0.01, rb=0.01)],
         Frame(rot_z(s * 0.35), (-s * 0.06, -0.01, 0.03))).mesh(p, "plate", seg=10, sub=2)
    return p


def build_thigh(s):
    """Cuisse + the side tasset. Origin: the hip joint."""
    p = Piece(f"thigh_{'l' if s > 0 else 'r'}")
    L = Loft([
        dict(y=0.09, rx=0.05, rf=0.05, rb=0.05),
        dict(y=0.05, rx=0.12, rf=0.125, rb=0.12),
        dict(y=-0.05, rx=0.142, rf=0.148, rb=0.142),
        dict(y=-0.25, rx=0.134, rf=0.135, rb=0.134),
        dict(y=-0.40, rx=0.112, rf=0.115, rb=0.11),
        dict(y=-0.45, rx=0.085, rf=0.09, rb=0.085),
    ]).mesh(p, "plate", seg=24, sub=2)
    ring(p, "trim", L, 3.75, r=0.0075)
    path(p, "trim", L, [(3.7, FRONT + s * 0.45), (2.4, FRONT + s * 0.5), (1.3, FRONT + s * 0.6)], r=0.006, n=10)
    # Tasset: a broad curved plate over the outside of the hip (front/back refs).
    outer = 0.0 if s > 0 else math.pi
    edge = patch(p, "plate", L, 1.15, 2.85, outer - deg(70), outer + deg(70), off=0.03, thick=0.014,
                 nt=6, nth=8, flare=lambda u: 0.03 * u * u)
    tube(p, "trim", edge[::2] + [edge[0]], r=0.0065)
    return p


def build_shin(s):
    """Poleyn (knee) + greave. Origin: the knee."""
    p = Piece(f"shin_{'l' if s > 0 else 'r'}")
    ellipsoid(p, "plate", (0, 0.0, 0.025), (0.115, 0.11, 0.11), seg=16, rings=8)
    # Knee wing on the outside and a boss on the cap.
    disc(p, "plate", (s * 0.1, 0.0, 0.02), (s, 0, 0.25), 0.06, 0.025)
    knee = Loft([dict(y=-0.08, rx=0.10, rf=0.115, rb=0.0), dict(y=0.0, rx=0.115, rf=0.14, rb=0.0),
                 dict(y=0.08, rx=0.09, rf=0.115, rb=0.0)], Frame(None, (0, 0, 0.02)))
    edge = patch(p, "plate", knee, 0.0, 2.0, deg(20), deg(160), off=0.0, thick=0.014, nt=6, nth=8)
    tube(p, "trim", edge[::2] + [edge[0]], r=0.0065)
    L = Loft([
        dict(y=-0.03, rx=0.1, rf=0.105, rb=0.105),
        dict(y=-0.15, rx=0.108, rf=0.11, rb=0.13),
        dict(y=-0.3, rx=0.098, rf=0.102, rb=0.105),
        dict(y=-0.40, rx=0.085, rf=0.09, rb=0.088),
        dict(y=-0.44, rx=0.08, rf=0.085, rb=0.08),
    ]).mesh(p, "plate", seg=18, sub=2)
    ring(p, "trim", L, 0.35, r=0.007)
    ring(p, "trim", L, 3.4, r=0.007)
    return p


def build_boot(s):
    """Sabaton. Origin: the ankle; the sole sits 0.1 below it."""
    p = Piece(f"boot_{'l' if s > 0 else 'r'}")
    Loft([
        dict(y=0.08, rx=0.09, rf=0.095, rb=0.09),
        dict(y=0.0, rx=0.098, rf=0.105, rb=0.1),
        dict(y=-0.05, rx=0.1, rf=0.11, rb=0.1),
    ]).mesh(p, "plate", seg=24, sub=2)
    # Foot: sections run heel -> toe along +z (loft y mapped to game z).
    R = np.array([[1, 0, 0], [0, 0, 1], [0, 1, 0]], float)   # local y -> game z, local z -> game y
    to_foot = Frame(R, (0, -0.045, 0))
    foot = Loft([
        dict(y=-0.13, rx=0.075, rf=0.05, rb=0.05, p=2.3),
        dict(y=-0.08, rx=0.09, rf=0.08, rb=0.055, p=2.4),
        dict(y=0.02, rx=0.1, rf=0.08, rb=0.055, p=2.5),
        dict(y=0.14, rx=0.1, rf=0.055, rb=0.055, p=2.5),
        dict(y=0.24, rx=0.085, rf=0.04, rb=0.055, p=2.3),
        dict(y=0.28, rx=0.05, rf=0.025, rb=0.04, p=2.1),
    ], to_foot).mesh(p, "plate", seg=18, sub=2)
    # Toe lames and the sole edge.
    for t in (2.5, 3.2, 3.8):
        path(p, "plate", foot, [(t, deg(-10)), (t, deg(90)), (t, deg(190))], r=0.007, n=8)
    ring(p, "trim", foot, 1.2, r=0.0065, th0=deg(-15), th1=deg(195), n=20)
    return p


# --- Assemble -----------------------------------------------------------------------

reset_scene()
MATS.update({
    "plate": material("plate", (0.16, 0.2, 0.25), metallic=0.6, roughness=0.4),
    "plate_dark": material("plate_dark", (0.075, 0.095, 0.12), metallic=0.6, roughness=0.5),
    "trim": material("trim", (0.012, 0.035, 0.32), metallic=0.1, roughness=0.45),
    "glow": material("glow", (0.69, 0.89, 1.0), roughness=0.3, emission=(0.35, 0.72, 1.0), strength=4.0),
})

pieces = []
helm, crest = build_helm(enemy_crest=True)
pieces += [helm, crest, build_gorget(), build_breastplate(), build_abdomen(), build_belt(), *build_fauld()]
for s in (1, -1):
    pieces += [build_pauldron(s), build_upperarm(s), build_forearm(s), build_gauntlet(s),
               build_thigh(s), build_shin(s), build_boot(s)]

objs = {pc.name: pc.build() for pc in pieces}
tris = 0
for name, o in objs.items():
    n = sum(len(pl.vertices) - 2 for pl in o.data.polygons)
    tris += n
    print(f"  {name:13s} {n:6d} tris")
by_mat = {}
for pc in pieces:
    for face, m in zip(pc.faces, pc.mats):
        by_mat[m] = by_mat.get(m, 0) + len(face) - 2
print(f"total {tris} triangles in {len(objs)} pieces; by material {by_mat}")

export_glb(ROOT / "public/models/shardplate.glb", list(objs.values()))

if "--no-render" in sys.argv:
    sys.exit(0)

# --- Preview: place the pieces on the rest skeleton ----------------------------------
# Game body space -> Blender: (x, y, z) -> (x, -z, y).

def place(name, pos, roll=0.0):
    """Put a piece at a game-space position, rolled `roll` about game +z (forward)."""
    o = objs[name]
    x, y, z = pos
    o.location = (x, -z, y)
    o.rotation_euler = (0, -roll, 0)   # game +z is Blender -y


bpy.data.objects.remove(objs.pop("helm_crest"))
W = WAIST_Y
place("helm", (0, W + HELM_Y, 0))
for n in ("gorget", "breastplate", "abdomen", "belt"):
    place(n, (0, W, 0))
place("fauld_front", (0, HIP_Y, 0.17))
place("fauld_back", (0, HIP_Y, -0.15))
ABDUCT = deg(10)
for s, side in ((1, "l"), (-1, "r")):
    sh = np.array([s * SHOULDER[0], W + SHOULDER[1], 0])
    place(f"pauldron_{side}", sh)
    place(f"upperarm_{side}", sh, s * ABDUCT)
    elbow = sh + UPPER_ARM * np.array([s * math.sin(ABDUCT), -math.cos(ABDUCT), 0])
    place(f"forearm_{side}", elbow, s * ABDUCT)
    wrist = elbow + LOWER_ARM * np.array([s * math.sin(ABDUCT), -math.cos(ABDUCT), 0])
    place(f"gauntlet_{side}", wrist, s * ABDUCT)
    hip = np.array([s * LEG_X, HIP_Y, 0])
    place(f"thigh_{side}", hip)
    place(f"shin_{side}", hip - [0, THIGH, 0])
    place(f"boot_{side}", hip - [0, THIGH + SHIN, 0])

mid = (0, 0, 1.2)
paths = render_views(ROOT / "art/renders/shardplate/shardplate", [
    ("front", (0, -8, 1.2), mid, 2.6),
    ("side", (8, 0, 1.2), mid, 2.6),
    ("back", (0, 8, 1.2), mid, 2.6),
    ("three-quarter", (2.6, -3.6, 1.9), (0, 0, 1.2), None),
    ("closeup", (1.1, -2.0, 1.95), (0, 0, 1.65), None),
], size=(900, 1000), samples=40)
for pth in paths:
    print("render", pth.relative_to(ROOT))
