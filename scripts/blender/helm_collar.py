"""The Shardplate helm and collar, built from measurements of their reference drawings.

Used by build_shardplate.py (build_helm, build_gorget). Game space: metres, +Y up,
+Z forward, +X = the character's left; the helm is in helm-local coordinates
(origin at the helm joint, world 2.00 m), the collar in torso coordinates (origin
at the waist).

Method (helm): the helm sheet (art/source/shardplate-helm) is read as a visual
hull. Its front and side silhouettes were traced (trace_silhouette.silhouette_mask)
every 10 px; at each height the front view gives the half-width and the side view
the front and back extents. Those tables (SIL_*, sheet pixels) define `Hull`, a
stack of sections that passes through the drawing's outline by construction. The
plates then lie on the hull as layers: skull (the hull itself), visor (+8 mm, its
edge is the trim line traced from both views of the sheet), cheek plates (+4 mm),
the neck guard's lame (+3 mm), the crown ridge (+4 mm). Enamel trim is a band of
faces in a plate's own surface along its edge, so it is flush and of even width.

Sheet scale: the helm is 0.31 m wide at its widest = 346 px (compare_reference.py
HELM_MPP); the top of the helm is at 2.37 m, sheet row 140.
"""
import math

import numpy as np
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

from plate_geom import Piece, tube
from lib import deg

TAU = math.tau
MPP = 0.31 / 346            # metres per helm-sheet pixel
TOP_ROW = 140               # sheet row of the helm's top (2.37 m)
FRONT_CX = 259.5            # sheet column of the helm's centre line, front view
SIDE_X0, SIDE_Z0 = 532, 0.276   # side view: column of the faceplate's prow and its z (game metres)
HELM_TOP = 0.37             # helm-local y of the top (helm joint at 2.00 m)


def fy(py):
    """Sheet row -> helm-local y."""
    return HELM_TOP - (np.asarray(py, float) - TOP_ROW) * MPP


def fx(px):
    """Front-view sheet column -> |x| from the centre line."""
    return np.abs(np.asarray(px, float) - FRONT_CX) * MPP


def sz(px):
    """Side-view sheet column -> z."""
    return SIDE_Z0 - (np.asarray(px, float) - SIDE_X0) * MPP


# --- Small numeric helpers ------------------------------------------------------------

def unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def pchip(xs, ys):
    """Monotone cubic interpolant through (xs ascending, ys); clamps outside."""
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    h = np.diff(xs)
    d = np.diff(ys) / h
    m = np.zeros_like(ys)
    for i in range(1, len(xs) - 1):
        if d[i - 1] * d[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    m[0], m[-1] = d[0], d[-1]

    def f(x):
        x = np.clip(np.asarray(x, float), xs[0], xs[-1])
        i = np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2)
        t = (x - xs[i]) / h[i]
        return ((2 * t ** 3 - 3 * t ** 2 + 1) * ys[i] + (t ** 3 - 2 * t ** 2 + t) * h[i] * m[i]
                + (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1] + (t ** 3 - t ** 2) * h[i] * m[i + 1])
    return f


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def arclen(P):
    P = np.asarray(P, float)
    return np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])


def resample(P, n=None, step=None):
    """Polyline resampled to n points (or one every `step`) evenly along its length."""
    P = np.asarray(P, float)
    s = arclen(P)
    if n is None:
        n = max(2, int(round(s[-1] / step)) + 1)
    u = np.linspace(0, s[-1], n)
    return np.stack([np.interp(u, s, P[:, k]) for k in range(P.shape[1])], 1)


def smooth(P, passes=1):
    """Light smoothing of an open polyline (end points fixed)."""
    P = np.asarray(P, float).copy()
    for _ in range(passes):
        P[1:-1] = 0.25 * P[:-2] + 0.5 * P[1:-1] + 0.25 * P[2:]
    return P


def simplify(P, tol):
    """Douglas-Peucker: indices of the points to keep."""
    P = np.asarray(P, float)
    keep = np.zeros(len(P), bool)
    keep[[0, -1]] = True
    stack = [(0, len(P) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ab = P[b] - P[a]
        L = np.linalg.norm(ab) or 1e-12
        rel = P[a + 1:b] - P[a]
        t = np.clip(rel @ ab / L ** 2, 0, 1)
        dist = np.linalg.norm(rel - t[:, None] * ab, axis=1)
        i = int(np.argmax(dist))
        if dist[i] > tol:
            keep[a + 1 + i] = True
            stack += [(a, a + 1 + i), (a + 1 + i, b)]
    return np.where(keep)[0]


def in_poly(pt, poly):
    """Point in polygon (2D, even-odd)."""
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def poly_area(poly):
    p = np.asarray(poly, float)
    return 0.5 * float(np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1]))


def seg_dist(pt, poly):
    """Distance from a 2D point to a closed polyline."""
    p = np.asarray(poly, float)
    a, b = p, np.roll(p, -1, axis=0)
    ab = b - a
    t = np.clip(np.einsum("ij,ij->i", pt - a, ab) / np.maximum(np.einsum("ij,ij->i", ab, ab), 1e-18), 0, 1)
    return float(np.min(np.linalg.norm(a + t[:, None] * ab - pt, axis=1)))


# --- The hull: sections through the drawing's silhouettes ---------------------------------

class Hull:
    """A surface of stacked sections, P(y, phi): y up, phi the polar angle about the section's
    centre (0, cz), 0 = forward (+z), pi/2 = +x (the character's left), pi = back.

    Each section is a superellipse with its own front and back halves: half-width rx, depth
    to the front rf and back rb from cz, exponents pf / pb (2 = ellipse, 1 = a straight wedge).
    The tables are interpolated (monotone cubic, radii as squares so the crown closes round).
    """

    def __init__(self, ys, rx, zf, zb, cz, pf, pb, dy=0.0005):
        ys = np.asarray(ys, float)
        o = np.argsort(ys)
        ys = ys[o]
        rx, zf, zb, cz, pf, pb = (np.asarray(a, float)[o] for a in (rx, zf, zb, cz, pf, pb))
        self.y0, self.y1, self.dy = ys[0], ys[-1], dy
        g = np.arange(self.y0, self.y1 + dy / 2, dy)
        sq = lambda a: np.sqrt(np.maximum(pchip(ys, a * a)(g), 0.0))  # noqa: E731
        czg = pchip(ys, cz)(g)
        self.tab = np.stack([sq(rx), sq(zf - cz), sq(cz - zb), czg, pchip(ys, pf)(g), pchip(ys, pb)(g)], 1)

    def sec(self, y):
        """(rx, rf, rb, cz, pf, pb) at height y."""
        u = (min(max(y, self.y0), self.y1) - self.y0) / self.dy
        i = min(int(u), len(self.tab) - 2)
        f = u - i
        return self.tab[i] * (1 - f) + self.tab[i + 1] * f

    def radius(self, y, phi):
        rx, rf, rb, cz, pf, pb = self.sec(y)
        s, c = abs(math.sin(phi)), math.cos(phi)
        rz, p = (rf, pf) if c >= 0 else (rb, pb)
        if rx < 1e-6 or rz < 1e-6:
            return 0.0, cz
        return ((s / rx) ** p + (abs(c) / rz) ** p) ** (-1.0 / p), cz

    def base(self, y, phi):
        r, cz = self.radius(y, phi)
        return np.array([r * math.sin(phi), y, cz + r * math.cos(phi)])

    def normal(self, y, phi):
        h, a = 0.002, 0.02
        dy = self.base(min(y + h, self.y1), phi) - self.base(max(y - h, self.y0), phi)
        da = self.base(y, phi + a) - self.base(y, phi - a)
        n = np.cross(da, dy)
        ln = np.linalg.norm(n)
        if ln < 1e-10:
            return np.array([0.0, 1.0, 0.0])
        n /= ln
        radial = np.array([math.sin(phi), 0.25, math.cos(phi)])
        return n if n @ radial > 0 else -n

    def point(self, y, phi, off=0.0):
        p = self.base(y, phi)
        return p + self.normal(y, phi) * off if off else p

    def inside(self, p):
        """True if a point is inside the hull."""
        if p[1] >= self.y1 or p[1] <= self.y0:
            return p[1] <= self.y0
        rx, rf, rb, cz, pf, pb = self.sec(p[1])
        dz = p[2] - cz
        rz, pw = (rf, pf) if dz >= 0 else (rb, pb)
        if rx < 1e-6 or rz < 1e-6:
            return False
        return (abs(p[0]) / rx) ** pw + (abs(dz) / rz) ** pw < 1.0

    def param(self, p):
        """(y, phi) of the hull point radially under / over a point."""
        y = min(max(p[1], self.y0), self.y1)
        cz = self.sec(y)[3]
        return y, math.atan2(p[0], p[2] - cz)

    def drop(self, q, n, lo=-0.06, hi=0.06):
        """Slide a point along n onto the hull: (y, phi) and the surface point."""
        q, n = np.asarray(q, float), np.asarray(n, float)
        a, b = lo, hi          # inside at lo (n points outward), outside at hi
        for _ in range(40):
            m = 0.5 * (a + b)
            if self.inside(q + n * m):
                a = m
            else:
                b = m
        p = q + n * 0.5 * (a + b)
        return self.param(p), p

    def phi_x(self, y, x, back=False):
        """Angle on the front (or back) half whose base point has this x (>= 0)."""
        a, b = (math.pi, math.pi / 2) if back else (0.0, math.pi / 2)
        for _ in range(40):
            m = 0.5 * (a + b)
            if self.base(y, m)[0] < x:
                a = m
            else:
                b = m
        return 0.5 * (a + b)

    def phi_z(self, y, z):
        """Angle on the +x side whose base point has this z."""
        a, b = 0.0, math.pi
        for _ in range(40):
            m = 0.5 * (a + b)
            if self.base(y, m)[2] > z:
                a = m
            else:
                b = m
        return 0.5 * (a + b)

    def locate(self, y, off=0.0, x=None, z=None, back=False):
        """(y_base, phi) such that point(y_base, phi, off) sits at height y with the given
        x (seen from the front / back) or z (seen from the side, on the +x side)."""
        yb, phi = y, 0.0
        tx, tz = x, z
        for _ in range(4 if off else 1):
            phi = self.phi_x(yb, max(tx, 0.0), back) if x is not None else self.phi_z(yb, tz)
            if not off:
                break
            n = self.normal(yb, phi)
            yb = y - n[1] * off
            if x is not None:
                tx = x - n[0] * off
            else:
                tz = z - n[2] * off
        return yb, phi


# --- Meshes with explicit winding ---------------------------------------------------------
# The game culls back faces, and thin open plates give Blender's "recalculate normals" nothing
# to go on, so every face here is wound by a reference direction instead.

class OPiece(Piece):
    """A Piece whose faces are already wound outward (no normal recalculation on build)."""

    C0 = np.array([0.0, 0.18, 0.06])     # a point well inside; default reference = away from it

    def put(self, verts, faces, mat, ref=None):
        """Add faces wound to face `ref`: None = away from C0, a vector, or f(centroid) -> vector."""
        V = np.asarray(verts, float)
        out = []
        for f in faces:
            pts = V[list(f)]
            c = pts.mean(0)
            n = np.zeros(3)
            for i in range(len(pts)):          # Newell normal
                a, b = pts[i], pts[(i + 1) % len(pts)]
                n += np.cross(a, b)
            if np.linalg.norm(n) < 1e-14:
                continue
            r = (c - self.C0) if ref is None else (ref(c) if callable(ref) else np.asarray(ref, float))
            out.append(tuple(f) if n @ r >= 0 else tuple(f)[::-1])
        self.add(V, out, mat)

    def strip(self, A, B, mat, ref=None, closed=False):
        """Quads between two polylines of equal length."""
        A, B = np.asarray(A, float), np.asarray(B, float)
        n = len(A)
        faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n if closed else n - 1)]
        self.put(np.vstack([A, B]), faces, mat, ref)

    def build(self):
        import bmesh
        import bpy
        from lib import link
        from plate_geom import MATS
        names = list(dict.fromkeys(self.mats))
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata([(x, -z, y) for x, y, z in self.verts], [], self.faces)
        for n in names:
            mesh.materials.append(MATS[n])
        mesh.polygons.foreach_set("material_index", [names.index(m) for m in self.mats])
        mesh.polygons.foreach_set("use_smooth", [True] * len(self.faces))
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(mesh)
        bm.free()
        obj = link(bpy.data.objects.new(self.name, mesh))
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_auto_smooth(angle=deg(40))
        return obj


def cdt(outer, holes=(), steiner=(), lines=()):
    """Constrained Delaunay triangulation of a 2D region.

    outer / holes: closed loops of points; steiner: extra interior points; lines: open
    polylines that must appear as edges (creases). Returns (points, triangles, n_fixed):
    the first n_fixed points are outer + holes + lines points in input order.
    """
    pts, edges = [], []

    def loop(L, closed=True):
        b = len(pts)
        pts.extend([tuple(map(float, p)) for p in L])
        n = len(L)
        edges.extend([(b + i, b + (i + 1) % n) for i in range(n if closed else n - 1)])
    loop(outer)
    for h in holes:
        loop(h)
    for ln in lines:
        loop(ln, closed=False)
    nfix = len(pts)
    pts.extend([tuple(map(float, p)) for p in steiner])
    vs, _, fs, ov, _, _ = delaunay_2d_cdt([Vector(p) for p in pts], edges, [], 0, 1e-7)
    out_pts = [tuple(v) for v in vs]
    # Map back to the input points where the triangulator kept them.
    remap = {}
    for k, src in enumerate(ov):
        if src:
            remap[k] = src[0]
    tris = []
    for f in fs:
        c = np.mean([out_pts[i] for i in f], axis=0)
        if not in_poly(c, outer) or any(in_poly(c, h) for h in holes):
            continue
        tris.append(tuple(f))
    return out_pts, tris, remap, nfix


class Region:
    """A plate lying on a hull: a closed outline in (y, phi), triangulated, at a height above it.

    loop: (y, phi) points, any winding. trims: list of (i0, i1) index ranges of the loop (inclusive,
    in loop order) whose edge carries an enamel band of width `band`.
    """

    def __init__(self, hull, loop, off, R=0.17):
        self.h, self.off, self.R = hull, off, R
        loop = [tuple(p) for p in loop]
        if poly_area([self.uv(p) for p in loop]) < 0:
            loop = loop[::-1]
            self.flipped = True
        else:
            self.flipped = False
        self.loop = loop
        self.n = len(loop)

    def uv(self, p):
        return (p[1] * self.R, p[0])

    def yphi(self, uv):
        return (uv[1], uv[0] / self.R)

    def P(self, p, off=None):
        return self.h.point(p[0], p[1], self.off if off is None else off)

    def inward(self, i):
        """In-surface unit vector at loop vertex i pointing into the region, and a mitre factor."""
        a, b, c = self.P(self.loop[i - 1]), self.P(self.loop[i]), self.P(self.loop[(i + 1) % self.n])
        nrm = self.h.normal(*self.loop[i])
        t1, t2 = unit(b - a), unit(c - b)
        t = unit(t1 + t2)
        # the loop is counter-clockwise seen from outside, so the inside is to the left: n x t
        k = 1.0 / max(0.5, math.sqrt(max(0.0, (1 + t1 @ t2) / 2)))
        return unit(np.cross(nrm, t)), k

    def offset_pt(self, i, d, ends=None):
        """The loop vertex moved d into the region along the surface: (y, phi)."""
        if ends is not None:      # at a band's end: square to the band, not the mitre of the loop corner
            a, b = self.P(self.loop[ends[0]]), self.P(self.loop[ends[1]])
            nrm = self.h.normal(*self.loop[i])
            v, k = unit(np.cross(nrm, unit(b - a))), 1.0
        else:
            v, k = self.inward(i)
        q = self.P(self.loop[i]) + v * d * k
        nrm = self.h.normal(*self.loop[i])
        return self.h.param(q - nrm * self.off)

    def build(self, piece, mat="plate", trims=(), band=0.009, holes=(), steiner=(), lines=(), grid=None,
              trim_mat="trim"):
        """Triangulate and add to the piece. grid = (d_phi, d_y, margin): interior lattice points."""
        L = self.loop
        inner = {}            # loop index -> inner band point (y, phi)
        poly = []             # interior polygon, as ("L", i) loop points and ("I", i) inner points
        spans = []
        for (i0, i1) in trims:
            idx = list(range(i0, i1 + 1)) if i1 >= i0 else list(range(i0, self.n)) + list(range(0, i1 + 1))
            spans.append(idx)
        in_span = {}
        for s, idx in enumerate(spans):
            for k, i in enumerate(idx):
                in_span[i] = (s, k)
                e = None
                if k == 0:
                    e = (idx[0], idx[1])
                elif k == len(idx) - 1:
                    e = (idx[-2], idx[-1])
                inner[i] = self.offset_pt(i, band, e)
        i = 0
        while i < self.n:
            if i in in_span and in_span[i][1] == 0:
                idx = spans[in_span[i][0]]
                poly.append(("L", idx[0]))
                poly.extend(("I", j) for j in idx)
                poly.append(("L", idx[-1]))
                i += len(idx)
                if idx[-1] < idx[0]:
                    break
            elif i in in_span:
                i += 1        # inside a wrapped span that started before index 0 (handled at its start)
            else:
                poly.append(("L", i))
                i += 1
        # a wrapped span: drop the leading loop points it covers
        for idx in spans:
            if idx[-1] < idx[0]:
                poly = [q for q in poly if not (q[0] == "L" and q[1] in idx[1:-1] and q[1] <= idx[-1])]
        key = lambda q: L[q[1]] if q[0] == "L" else inner[q[1]]   # noqa: E731
        outer_yp = [key(q) for q in poly]
        outer_uv = [self.uv(p) for p in outer_yp]
        holes_uv = [[self.uv(p) for p in h] for h in holes]
        lines_uv = [[self.uv(p) for p in ln] for ln in lines]
        st = [self.uv(p) for p in steiner]
        if grid:
            dphi, dy, margin = grid
            us = [p[0] for p in outer_uv]
            vs = [p[1] for p in outer_uv]
            for a in np.arange(math.floor(min(us) / self.R / dphi) * dphi, max(us) / self.R + dphi, dphi):
                for yv in np.arange(math.floor(min(vs) / dy) * dy, max(vs) + dy, dy):
                    q = np.array(self.uv((yv, a)))
                    if not in_poly(q, outer_uv) or any(in_poly(q, h) for h in holes_uv):
                        continue
                    if seg_dist(q, outer_uv) < margin or any(seg_dist(q, h) < margin for h in holes_uv):
                        continue
                    if any(seg_dist(q, ln + ln[::-1]) < margin * 0.6 for ln in lines_uv):
                        continue
                    st.append(tuple(q))
        pts, tris, remap, nfix = cdt(outer_uv, holes_uv, st, lines_uv)
        fixed = outer_yp + [p for h in holes for p in h] + [p for ln in lines for p in ln]
        V = []
        for k, uvp in enumerate(pts):
            src = remap.get(k)
            yp = fixed[src] if src is not None and src < nfix else self.yphi(uvp)
            V.append(self.P(yp))
        piece.put(V, tris, mat)
        for idx in spans:
            piece.strip([self.P(L[i]) for i in idx], [self.P(inner[i]) for i in idx], trim_mat)
        self.inner = inner
        return self

    def wall(self, piece, base=0.0, mat="plate", span=None):
        """The plate's edge: a strip from its surface down to `base` above the hull, facing out."""
        idx = list(range(self.n)) + [0] if span is None else (
            list(range(span[0], span[1] + 1)) if span[1] >= span[0]
            else list(range(span[0], self.n)) + list(range(0, span[1] + 1)))
        A = np.array([self.P(self.loop[i % self.n]) for i in idx])
        B = np.array([self.P(self.loop[i % self.n], base) for i in idx])
        V = np.vstack([A, B])
        n = len(idx)
        for k in range(n - 1):
            i = idx[k] % self.n
            nrm = self.h.normal(*self.loop[i])
            out = np.cross(unit(A[k + 1] - A[k]), nrm)     # counter-clockwise loop: outside is t x n
            piece.put(V, [(k, k + 1, n + k + 1, n + k)], mat, out)


def dome(piece, mat, c, nrm, r, seg=6):
    """A round rivet head: a low six-sided dome."""
    nrm = unit(nrm)
    ref = np.array([0, 1, 0]) if abs(nrm[1]) < 0.9 else np.array([1, 0, 0])
    u = unit(np.cross(nrm, ref))
    v = np.cross(nrm, u)
    c = np.asarray(c, float)
    V = [c + r * (math.cos(TAU * k / seg) * u + math.sin(TAU * k / seg) * v) - nrm * 0.001 for k in range(seg)]
    V += [c + 0.62 * r * (math.cos(TAU * k / seg) * u + math.sin(TAU * k / seg) * v) + nrm * 0.5 * r for k in range(seg)]
    V.append(c + nrm * 0.68 * r)
    F = [(k, (k + 1) % seg, seg + (k + 1) % seg, seg + k) for k in range(seg)]
    F += [(seg + k, seg + (k + 1) % seg, 2 * seg) for k in range(seg)]
    piece.put(V, F, mat, lambda q: (q - c) + nrm * r * 0.6)
