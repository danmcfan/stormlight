"""Scripted geometry for the Shardplate (game space: metres, +Y up, +Z forward, +X = left).

Loft (stacked superellipse sections), tube/ring/path (raised enamel trim),
patch/shell (solid plates on a loft), slab/fin/leaf/disc/ellipsoid/hexgem, and
Piece, which collects sub-meshes with material names for one exported object.
Used by build_shardplate.py.
"""
import math

import bpy
import bmesh  # noqa: E402  (needs bpy imported first)
import numpy as np

from lib import deg, link

TAU = math.tau
FRONT = math.pi / 2      # loft angle facing +Z (forward)
BACK = -math.pi / 2
TRIM_R = 0.0085          # enamel bands: half-width (a 1.7 cm band, flat on the surface)

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


def tube(piece, mat, pts, r=0.008, sides=4, closed=False, nrm=None, flat=None):
    """A bar along a polyline (raised enamel trim, ridges).

    With surface normals `nrm` (one per point) and `flat` (height / width), the
    cross-section is a flat band lying on the surface: half-width r, half-height
    r * flat (the enamel inlay look) instead of a round bar.
    """
    pts = [np.asarray(p, float) for p in pts]
    n = len(pts)
    verts, faces = [], []
    prev_u = None
    band = nrm is not None and flat is not None
    for i, p in enumerate(pts):
        if closed:
            d = pts[(i + 1) % n] - pts[i - 1]
        else:
            d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        d = d / (np.linalg.norm(d) or 1)
        if band:
            ref = np.asarray(nrm[i], float)
        else:
            ref = prev_u if prev_u is not None else (np.array([0, 1, 0]) if abs(d[1]) < 0.9 else np.array([1, 0, 0]))
        u = ref - d * np.dot(ref, d)
        u /= np.linalg.norm(u) or 1
        prev_u = u
        v = np.cross(d, u)
        if band:
            h = r * flat
            for a, b in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
                verts.append(p + a * h * u + b * r * v)
        else:
            for k in range(sides):
                a = TAU * k / sides
                verts.append(p + r * (math.cos(a) * u + math.sin(a) * v))
    sides = 4 if band else sides
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


FLAT = 0.45   # enamel band height / width


def ring(piece, mat, loft, t, r=0.008, off=0.0, th0=0.0, th1=TAU, n=None, flat=FLAT):
    closed = abs(th1 - th0 - TAU) < 1e-6
    if n is None:  # about one segment per 6 cm of length
        probe = [loft.point(t, th) for th in np.linspace(th0, th1, 17)]
        n = max(10, int(sum(np.linalg.norm(b - a) for a, b in zip(probe, probe[1:])) / 0.06))
    ths = np.linspace(th0, th1, n, endpoint=not closed)
    tube(piece, mat, [loft.surf(t, th, off) for th in ths], r=r, closed=closed,
         nrm=[loft.normal(t, th) for th in ths] if flat else None, flat=flat)


def sample_path(loft, tths, n=8, off=0.0):
    """Points and surface normals along a smooth path through (t, th) points."""
    arr = np.array(tths, float)
    arr[:, 1] = np.unwrap(arr[:, 1])
    pts, nrm = [], []
    for k in range(n):
        u = k / (n - 1) * (len(arr) - 1)
        t, th = catmull(arr, u)
        pts.append(loft.surf(t, th, off))
        nrm.append(loft.normal(t, th))
    return pts, nrm


def path(piece, mat, loft, tths, r=0.008, off=0.0, n=8, flat=FLAT):
    """Trim along a path through (t, th) points, sampled smoothly on the surface."""
    pts, nrm = sample_path(loft, tths, n, off)
    tube(piece, mat, pts, r=r, nrm=nrm if flat else None, flat=flat)


def offset_line(pts, nrm, d):
    """A polyline beside another on the surface, d to its right (seen from outside)."""
    out = []
    for i, (p, nv) in enumerate(zip(pts, nrm)):
        tan = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        side = np.cross(tan, nv)
        side /= np.linalg.norm(side) or 1
        out.append(p + side * d)
    return out


def patch(piece, mat, loft, t0, t1, th0, th1, off=0.0, thick=0.012, nt=6, nth=8, flare=None):
    """A solid curved plate lying on (off the surface of) a loft region.

    t0/t1 may be functions of v (0..1 across the angle range) and th0/th1
    functions of u (0..1 along t), for curved or shield-shaped outlines.
    """
    F = lambda x: x if callable(x) else (lambda _w: x)  # noqa: E731
    T0, T1, TH0, TH1 = F(t0), F(t1), F(th0), F(th1)
    outer, inner = [], []
    for i in range(nt + 1):
        uu = i / nt
        extra = flare(uu) if flare else 0.0
        for j in range(nth + 1):
            vv = j / nth
            th = TH0(uu) + (TH1(uu) - TH0(uu)) * vv
            t = T0(vv) + (T1(vv) - T0(vv)) * uu
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


def disc(piece, mat, centre, normal, r, thick, seg=12, rim=None, rondel=False):
    """A round boss (pauldron disc, couter): cylinder facing `normal`, domed top; or with
    rondel=True a flat disc with a raised rim round a shallow recess."""
    nrm = np.asarray(normal, float)
    nrm /= np.linalg.norm(nrm)
    ref = np.array([0, 1, 0]) if abs(nrm[1]) < 0.9 else np.array([1, 0, 0])
    u = np.cross(nrm, ref)
    u /= np.linalg.norm(u)
    v = np.cross(nrm, u)
    c = np.asarray(centre, float)
    rings = [(-thick * 0.5, r), (thick * 0.5, r), (thick * 0.8, r * 0.75), (thick, 0.0)]
    if rondel:
        rings = [(-thick * 0.5, r), (thick * 0.45, r), (thick * 0.5, r * 0.9), (thick * 0.1, r * 0.78),
                 (thick * 0.15, r * 0.5), (thick * 0.25, 0.0)]
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
                z = sgn * thick / 2 + bulge * (1 - abs(u)) * (1 - 0.5 * v)
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



def t_at(loft, y):
    """Loft parameter t whose section sits at local height y (sections may run either way)."""
    lo, hi = 0.0, loft.n - 1.0
    up = loft.sec(hi)[0] > loft.sec(lo)[0]
    for _ in range(40):
        mid = (lo + hi) / 2
        if (loft.sec(mid)[0] < y) == up:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def ypath(piece, mat, loft, yths, r=TRIM_R, off=0.0, n=14):
    """Trim along (local y, angle) points on a loft."""
    path(piece, mat, loft, [(t_at(loft, y), th) for y, th in yths], r=r, off=off, n=n)


def yring(piece, mat, loft, y, r=TRIM_R, **kw):
    ring(piece, mat, loft, t_at(loft, y), r=r, **kw)


def shell(piece, loft, top, t0, thick=0.02, nth=48, nu=6, inner="plate_dark"):
    """An open-topped plate shell from loft t0 up to top(th) (a t per angle); dark inside."""
    outer, inn = [], []
    for j in range(nth):
        th = TAU * j / nth
        t1 = top(th)
        for i in range(nu + 1):
            t = t0 + (t1 - t0) * i / nu
            p = loft.point(t, th)
            outer.append(p)
            inn.append(p - loft.normal(t, th) * thick)
    W = nu + 1
    N = len(outer)
    verts = outer + inn
    of, inf_ = [], []
    for j in range(nth):
        j2 = (j + 1) % nth
        for i in range(nu):
            a, b = j * W + i, j2 * W + i
            of.append((a, a + 1, b + 1, b))
            inf_.append((N + a, N + b, N + b + 1, N + a + 1))
        # top lip and bottom edge
        of.append((j * W + nu, N + j * W + nu, N + j2 * W + nu, j2 * W + nu))
        of.append((j * W, j2 * W, N + j2 * W, N + j * W))
    piece.add(verts, of, "plate")
    piece.add(verts, inf_, inner)
    return [outer[j * W + nu] for j in range(nth)]


def fin(piece, mat, outline, thick, frame):
    """A flat plate in the local (x, y) plane, `thick` along local z (pauldron flange)."""
    slab(piece, mat, outline, thick, frame)


def hexgem(piece, centre, nrm, w, h, depth):
    """A faceted hexagonal sapphire (glow) on a hex setting (plate) with a trim rim."""
    nrm = np.asarray(nrm, float) / np.linalg.norm(nrm)
    u = np.cross([0, 1, 0], nrm)
    u /= np.linalg.norm(u)
    v = np.cross(nrm, u)
    c = np.asarray(centre, float)
    hexpts = lambda sx, sy: [c + u * sx * math.sin(a) + v * sy * math.cos(a) for a in np.linspace(0, TAU, 6, endpoint=False)]
    # Setting: a hex slab.
    base = hexpts(w * 0.95, h * 0.95)
    top = [p + nrm * depth * 0.6 for p in base]
    verts = base + top
    faces = [tuple(range(5, -1, -1)), tuple(range(6, 12))] + [(i, (i + 1) % 6, 6 + (i + 1) % 6, 6 + i) for i in range(6)]
    piece.add(verts, faces, "plate")
    tube(piece, "trim", [p + nrm * depth * 0.6 for p in hexpts(w * 0.95, h * 0.95)], r=TRIM_R * 0.8, closed=True)
    # Gem: hex girdle, table on top.
    g0 = [p + nrm * depth * 0.6 for p in hexpts(w * 0.72, h * 0.72)]
    g1 = [p + nrm * depth * 1.15 for p in hexpts(w * 0.62, h * 0.62)]
    g2 = [p + nrm * depth * 1.45 for p in hexpts(w * 0.34, h * 0.34)]
    verts = g0 + g1 + g2
    # Sapphire: deep blue facets (trim enamel colour) round a glowing table.
    sides = [tuple(range(5, -1, -1))]
    for a, b in ((0, 6), (6, 12)):
        sides += [(a + i, a + (i + 1) % 6, b + (i + 1) % 6, b + i) for i in range(6)]
    piece.add(verts, sides, "trim")
    piece.add(verts, [tuple(range(12, 18))], "glow")




def add_part(piece, part, r=0.009, off=0.002, face_mat=None):
    """Add a trellis_part.Part (already in the piece frame): faces by class, trim as tubes.

    face_mat(centroid, cls) -> material name, to override (e.g. the visor slit -> glow).
    """
    names = ("plate", "plate_dark")
    V = part.verts
    groups = {}
    for f, c in zip(part.faces, part.cls):
        m = names[c]
        if face_mat:
            m = face_mat(V[list(f)].mean(0), c) or m
        groups.setdefault(m, []).append(f)
    for m, fs in groups.items():
        piece.add(V, fs, m)
    for Q, N in part.trim:
        tube(piece, "trim", Q + N * off, r=r)


def th_for(loft, t, coord, face):
    """Angle on loft section t whose point has local x (face 'front'/'back') or local z
    (face 'left'/'right', the +x / -x side) equal to coord."""
    rng = {"front": (0.0, math.pi), "back": (math.pi, TAU), "left": (-math.pi / 2, math.pi / 2),
           "right": (math.pi / 2, 1.5 * math.pi)}[face]
    k = 0 if face in ("front", "back") else 2

    def err(th):
        return loft.local(t, th)[k] - coord

    # A coarse sweep to bracket the answer (the coordinate is not monotone in the angle on
    # every face), then bisect. A flat 97-sample sweep leaves up to ~1 cm of quantisation on
    # a 0.35 m section, which is a third of the trim tolerance.
    ths = np.linspace(rng[0], rng[1], 97)
    vals = np.array([err(th) for th in ths])
    i = int(np.argmin(np.abs(vals)))
    lo, hi = ths[max(i - 1, 0)], ths[min(i + 1, len(ths) - 1)]
    a, b = err(lo), err(hi)
    if a == 0 or b == 0 or a * b > 0:
        return float(ths[i])
    for _ in range(30):
        m = 0.5 * (lo + hi)
        c = err(m)
        if c == 0:
            return float(m)
        if a * c < 0:
            hi, b = m, c
        else:
            lo, a = m, c
    return float(0.5 * (lo + hi))


def proj(loft, pts, face="front", origin=(0, 0, 0)):
    """(t, th) on a loft for points given in a reference view, world metres: front/back views
    give (x, y), side views give (z, y). origin: the piece origin in world space (x, y, z)."""
    ox, oy, oz = origin
    out = []
    for a, y in pts:
        t = t_at(loft, y - oy)
        out.append((t, th_for(loft, t, a - (ox if face in ("front", "back") else oz), face)))
    return out


def ref_path(piece, mat, loft, pts, face="front", origin=(0, 0, 0), r=None, n=None, mirror=True, **kw):
    """Trim along a path read off a reference view (world metres), mirrored for the other side."""
    r = TRIM_R if r is None else r
    sides = (1, -1) if mirror else (1,)
    for sgn in sides:
        q = [(sgn * a if face in ("front", "back") else a, y) for a, y in pts]
        tths = proj(loft, q, face, origin)
        if face in ("left", "right") and sgn < 0:
            tths = proj(loft, q, "right" if face == "left" else "left", origin)
        path(piece, mat, loft, tths, r=r, n=n or max(8, 3 * len(pts)), **kw)
