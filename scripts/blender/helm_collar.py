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

import bpy  # noqa: F401  (mathutils needs bpy imported first)
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

    def param_off(self, q, off, n):
        """(y, phi) whose point at height `off` above the hull is q (n: a first guess of the normal there)."""
        yp = self.param(np.asarray(q, float) - np.asarray(n, float) * off)
        for _ in range(3 if off else 0):
            yp = self.param(q - self.normal(*yp) * off)
        return yp

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
        self._uvloop = [self.uv(p) for p in loop]

    def uv(self, p):
        return (-p[1] * self.R, p[0])      # -phi: counter-clockwise here = counter-clockwise seen from outside

    def yphi(self, uv):
        return (uv[1], -uv[0] / self.R)

    def span(self, sp):
        """A (first, last) index range given for the loop as passed in -> for the stored loop."""
        return (self.n - 1 - sp[1], self.n - 1 - sp[0]) if self.flipped else tuple(sp)

    def contains(self, y, phi):
        return in_poly(self.uv((y, phi)), self._uvloop)

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
        return self.h.param_off(q, self.off, self.h.normal(*self.loop[i]))

    def build(self, piece, mat="plate", trims=(), band=0.009, holes=(), steiner=(), lines=(), grid=None,
              trim_mat="trim"):
        """Triangulate and add to the piece. grid = (d_phi, d_y, margin): interior lattice points."""
        L = self.loop
        inner = {}            # loop index -> inner band point (y, phi)
        poly = []             # interior polygon, as ("L", i) loop points and ("I", i) inner points
        spans = []
        for (i0, i1) in [self.span(t) for t in trims]:
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
            us = [p[1] for p in outer_yp]
            vs = [p[0] for p in outer_yp]
            for a in np.arange(math.floor(min(us) / dphi) * dphi, max(us) + dphi, dphi):
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
        if span is not None:
            span = self.span(span)
        idx = list(range(self.n)) + [0] if span is None else list(range(span[0], span[1] + 1))
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


def hull_grid(piece, hull, rows, n, mat, off=0.0, ref=None, keep=None, phi0=0.0, cap=None):
    """Quads on a hull between rows (each a height or a function of phi), n columns round.
    keep(y, phi) -> False drops a sample (a face goes when all its samples are dropped).
    cap: 'top' / 'bottom' closes that end with a fan to the section centre."""
    phis = [phi0 + TAU * j / n for j in range(n)]
    Y = [[(r(a) if callable(r) else r) for a in phis] for r in rows]
    V = [hull.point(Y[i][j], phis[j], off) for i in range(len(rows)) for j in range(n)]
    F = []
    for i in range(len(rows) - 1):
        for j in range(n):
            j2 = (j + 1) % n
            if keep:
                a0, a1 = phis[j], phis[j] + TAU / n
                smp = [(Y[i][j] * (1 - v) + Y[i + 1][j] * v) * (1 - u) + (Y[i][j2] * (1 - v) + Y[i + 1][j2] * v) * u
                       for u in (0, 0.5, 1) for v in (0, 0.5, 1)]
                ang = [a0 + (a1 - a0) * u for u in (0, 0.5, 1) for v in (0, 0.5, 1)]
                if not any(keep(yy, aa) for yy, aa in zip(smp, ang)):
                    continue
            F.append((i * n + j, i * n + j2, (i + 1) * n + j2, (i + 1) * n + j))
    if cap:
        i = 0 if cap == "top" else len(rows) - 1
        yc = float(np.mean(Y[i]))
        V.append(np.array([0.0, yc, hull.sec(yc)[3]]))
        F += [(i * n + j, i * n + (j + 1) % n, len(V) - 1) for j in range(n)]
    piece.put(V, F, mat, ref)
    return V


# --- Helm sheet measurements (sheet pixels; see the module docstring) ---------------------

# row, front-view half-width, side-view front column, side-view back column. Rows from 490 down are
# hidden by the collar in the front view and continue the cheek line; the slit's notch (rows 375-412)
# is bridged here (it is cut into the visor instead).
SIL = [
    (150, 35, 686, 815), (160, 70, 660, 839), (170, 91, 640, 857), (180, 105.5, 623, 872),
    (190, 117.5, 611, 882), (200, 126.5, 600, 893), (210, 133.5, 591, 900), (220, 139, 583, 908),
    (230, 144, 575, 914), (240, 148, 569, 919), (250, 151, 563, 924), (260, 155, 558, 928),
    (270, 156.5, 553, 932), (280, 158.5, 549, 935), (290, 160, 546, 937), (300, 161.5, 543, 939),
    (310, 168, 540, 940), (320, 171, 538, 941), (330, 172.5, 537, 942), (340, 173, 535, 942),
    (350, 173.5, 535, 941), (360, 173.5, 535, 942), (370, 174, 536, 941), (380, 172, 535.5, 940),
    (390, 168.5, 534.5, 937), (400, 167, 533, 936), (410, 165, 531.5, 935), (420, 165, 531, 934),
    (430, 165.5, 531, 935), (440, 166.5, 532, 941), (450, 168.5, 534, 946), (460, 171.5, 535, 953),
    (470, 173, 537, 964), (480, 174, 538, 962), (490, 170.5, 540, 958), (500, 166, 543, 955),
    (520, 162, 547, 952), (540, 159, 553, 950), (560, 157, 559, 950), (580, 154, 566, 950),
    (600, 151, 573, 950), (620, 148, 580, 950), (640, 146, 588, 950),
]
# Blue trim centrelines, traced from the sheet (compare_metrics.ref_trim_mask, skeletonised).
FRONT_TRIM = [   # the line on the image's left, crown to chin
    (241, 150), (238, 164), (235, 178), (233, 192), (230, 206), (225, 220), (220, 233), (213, 245), (204, 256),
    (193, 266), (183, 276), (172, 285), (160, 293), (148, 300), (135, 307), (123, 314), (111, 321), (107, 335),
    (106, 349), (106, 364), (107, 378), (109, 392), (112, 406), (122, 416), (133, 425), (144, 434), (154, 444),
    (162, 456), (170, 468), (175, 481), (180, 495), (184, 508), (188, 522), (191, 536), (194, 550), (196, 564),
    (198, 578), (202, 592)]
SIDE_TRIM_UP = [(618, 194), (617, 208), (615, 222), (613, 236), (614, 250), (619, 264), (628, 275), (639, 284),
                (651, 292), (665, 297), (678, 301), (693, 304), (707, 307), (721, 309), (735, 311), (750, 311),
                (764, 311), (778, 310), (791, 315), (798, 323)]
SIDE_TRIM_PIVOT = [(798, 323), (802, 334), (803, 345), (801, 357), (796, 368), (790, 381), (785, 393)]
SIDE_TRIM_LOW = [(785, 393), (776, 400), (760, 402), (740, 406), (720, 412), (701, 420), (682, 431), (670, 440),
                 (659, 450), (649, 460), (642, 470), (638, 480), (633, 490), (630, 500), (628, 510), (626, 520),
                 (624, 535), (623, 550), (622, 570), (622, 590), (621, 600)]
LAME_TOP = [(789, 472), (935, 433)]                       # side view: the neck guard lame's upper edge
LAME_BOT = [(782, 508), (805, 514), (820, 517), (874, 503), (927, 485), (962, 476)]   # and its lower edge
RIVETS_SKULL = [(810, 453), (866, 437), (914, 420)]       # side view, above the lame
RIVET_PIVOT = (777, 337)
RIVET_CHEEK = (761, 505)
CHEEK_REAR = 783                                          # side-view column of the cheek plate's rear edge

VISOR_T, CHEEK_T, LAME_T, RIDGE_T = 0.008, 0.004, 0.003, 0.004     # plate heights above the skull
HELM_BAND = 0.010                                         # enamel band width on the helm


def helm_hull():
    a = np.array(SIL, float)
    py = a[:, 0]
    side_t = np.where(py <= 300, 0.0, np.where(py < 400, 8.0, 4.5))        # visor / cheek over the skull
    front_t = np.interp(py, [190, 210], [4.5, 9.0])                        # crown ridge, then the visor
    back_t = np.where(py <= 425, 4.5, 3.5)                                 # crown ridge, then the lame
    cz = np.interp(py, [140, 160, 180, 200, 220, 240, 260, 280, 300], [.0807, .080, .076, .069, .060, .051, .044, .041, .040])
    pf = np.interp(py, [160, 180, 197, 220, 245, 283, 300, 340, 370, 410, 440, 460],
                   [2.0, 1.75, 1.5, 1.38, 1.33, 1.42, 1.48, 1.45, 1.38, 1.3, 1.23, 1.21])
    pb = np.interp(py, [160, 250], [2.0, 2.15])
    ys = np.append(fy(py), HELM_TOP - RIDGE_T)
    rx = np.append((a[:, 1] - side_t) * MPP, 0.0)
    zf = np.append(sz(a[:, 2] + front_t), cz[0])
    zb = np.append(sz(a[:, 3] - back_t), cz[0])
    return Hull(ys, rx, zf, zb, np.append(cz, cz[0]), np.append(pf, 2.0), np.append(pb, 2.0))


# The helm's lower edge by polar angle (degrees from the front): the chin's V, the cheek plates, the lame.
_YBOT = pchip([0, 23, 48.5, 75, 85, 93, 99, 119, 144, 180],
              [-0.055, -0.040, -0.013, 0.017, 0.028, 0.037, 0.032, 0.045, 0.061, 0.0695])


def helm_bottom(phi):
    a = abs((math.degrees(phi) + 180) % 360 - 180)
    return float(_YBOT(a))


def visor_edge(B):
    """The visor's edge = the trim centreline on the +x side, apex to chin, as (y, phi) on the hull.

    Each stretch (apex -> pivot, round the pivot, pivot -> chin) is read from both views and blended:
    the front view where the surface faces forward, the side view where it faces sideways.
    """
    k0 = 3                                       # the front trace above row 192 runs on the crown ridge
    top = min(range(len(FRONT_TRIM)), key=lambda i: abs(FRONT_TRIM[i][1] - 321))
    low = min(range(len(FRONT_TRIM)), key=lambda i: abs(FRONT_TRIM[i][1] - 392))
    segs = [(FRONT_TRIM[k0:top + 1], SIDE_TRIM_UP), (FRONT_TRIM[top:low + 1], SIDE_TRIM_PIVOT),
            (FRONT_TRIM[low:], SIDE_TRIM_LOW)]
    out = []
    for F, S in segs:
        f = resample(np.array([B.locate(fy(py), VISOR_T, x=fx(px)) for px, py in F]), n=40)
        s = resample(np.array([B.locate(fy(py), VISOR_T, z=sz(px)) for px, py in S]), n=40)
        for a, b in zip(f, s):
            w = smoothstep(deg(50), deg(78), b[1])
            out.append(a * (1 - w) + b * w)
    out = np.array(out)
    out[-1, 0] = helm_bottom(out[-1, 1]) + 0.001
    P = np.array([B.point(y, a, VISOR_T) for y, a in out])
    s = arclen(P)
    u = np.linspace(0, s[-1], int(s[-1] / 0.005))
    out = smooth(np.stack([np.interp(u, s, out[:, 0]), np.interp(u, s, out[:, 1])], 1), 3)
    P = np.array([B.point(y, a, VISOR_T) for y, a in out])
    return out[simplify(P, 0.0007)]


def offset_line(B, yp, off, d):
    """A (y, phi) polyline moved d to its left (seen from outside, walking along it) on the surface."""
    P = np.array([B.point(y, a, off) for y, a in yp])
    out = []
    for i, (y, a) in enumerate(yp):
        t = unit(P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)])
        n = B.normal(y, a)
        out.append(B.param_off(P[i] + np.cross(n, t) * d, off, n))
    return np.array(out)


def mirror(yp):
    return [(y, -a) for y, a in yp]


def make_helm(enemy_crest=False):
    """The helm (see the module docstring). Returns (helm piece, crest piece or None)."""
    B = helm_hull()
    p = OPiece("helm")
    half = HELM_BAND / 2

    # --- Visor: the plate inside the trim line, with the eye slit cut through it ---
    C = visor_edge(B)                              # trim centreline, +x side, apex -> chin
    A = offset_line(B, C, VISOR_T, half)           # the plate's edge (outside of the band)
    A[-1, 0] = helm_bottom(A[-1, 1])
    m = len(A)
    e = A[-1][1]
    bottom = [(helm_bottom(a), a) for a in np.linspace(e, -e, 9)[1:-1]]
    apex_y = A[0][0]
    loop = [tuple(q) for q in A] + bottom + mirror(A)[::-1] + [(apex_y, 0.0)]
    visor = Region(B, loop, VISOR_T)

    def vis(x, y, depth=0.0, lift=0.0):
        """A point of the visor at front-view (x, y), pushed `depth` back into the helm."""
        yb, a = B.locate(y, VISOR_T, x=abs(x))
        a = math.copysign(a, x) if x else 0.0
        q = B.point(yb, a, VISOR_T + lift)
        if depth:
            n = B.normal(yb, a)
            q = q - unit([n[0], 0.0, n[2]]) * depth
        return q, (yb, a)

    # Slit (front view of the sheet): nearly straight top edge sagging to the centre, lower edge a V.
    W1, W2 = 120 * MPP, 112 * MPP                  # half-width of the rim and of the dark opening
    top1 = lambda x: float(fy(355 + 21 * (1 - abs(x) / W1)))      # noqa: E731
    bot1 = lambda x: float(fy(387 + 37 * (1 - abs(x) / W1)))      # noqa: E731
    top2 = lambda x: float(fy(359 + 17 * (1 - abs(x) / W2)))      # noqa: E731
    bot2 = lambda x: float(fy(388 + 25 * (1 - abs(x) / W2)))      # noqa: E731
    NS = 11

    def slit_loop(w, top, bot, grow=0.0, **kw):
        xs = np.linspace(-w - grow, w + grow, NS)
        pts = [vis(x, top(min(abs(x), w) * np.sign(x)) + grow, **kw) for x in xs]
        pts += [vis(x, bot(min(abs(x), w) * np.sign(x)) - grow, **kw) for x in xs[::-1]]
        return pts
    r0 = slit_loop(W1, top1, bot1, grow=0.006)                    # where the raised rim starts
    r1 = slit_loop(W1, top1, bot1, lift=0.0025)                   # the rim's crest = the opening's edge
    r2 = slit_loop(W2, top2, bot2, depth=0.022)                   # the back of the recess
    ridge = [(y, 0.0) for y in np.linspace(r0[NS + NS // 2][1][0] - 0.012, helm_bottom(0) + 0.012, 5)]
    brow = [(y, a) for y in np.arange(r0[NS // 2][1][0] + 0.02, apex_y - 0.03, 0.03) for a in (-0.09, 0.09)]
    visor.build(p, trims=[(0, m - 1), (m + len(bottom), 2 * m + len(bottom) - 1)], band=HELM_BAND,
                holes=[[q[1] for q in r0]], lines=[ridge], steiner=brow, grid=(deg(13), 0.032, 0.014))
    visor.wall(p, base=-0.001)
    mid = lambda c: np.array([c[0] * 0.8, 0.5 * (top2(c[0]) + bot2(c[0])), c[2]]) - c   # noqa: E731
    p.strip([q[0] for q in r0], [q[0] for q in r1], "plate", closed=True)
    p.strip([q[0] for q in r1], [q[0] for q in r2], "plate", ref=mid, closed=True)
    back = [q[0] for q in r2]
    p.put(back, [(i, i + 1, 2 * NS - 2 - i, 2 * NS - 1 - i) for i in range(NS - 1)], "plate_dark", (0, 0, 1))
    # A thin line of Stormlight deep in the slit.
    gx = np.linspace(-0.06, 0.06, 7)
    gy = lambda x: 0.5 * (top2(x) + bot2(x)) - 0.003               # noqa: E731
    p.strip([vis(x, gy(x) + 0.0013, depth=0.0212)[0] for x in gx], [vis(x, gy(x) - 0.0013, depth=0.0212)[0] for x in gx],
            "glow", (0, 0, 1))

    # --- Cheek plates: behind the visor's lower edge, back to the ear, down to the jaw ---
    kp = max((i for i in range(m) if A[i][0] < 0.15), key=lambda i: A[i][1])      # the pivot's lower corner
    regions = [visor]
    for sgn in (1, -1):
        front = [tuple(q) for q in A[kp:]]
        a_rear = B.locate(0.03, CHEEK_T, z=sz(CHEEK_REAR))[1]
        under = [(helm_bottom(a), a) for a in np.linspace(front[-1][1], a_rear, 6)[1:]]
        rear = [B.locate(y, CHEEK_T, z=sz(CHEEK_REAR)) for y in np.linspace(under[-1][0], front[0][0], 6)[1:-1]]
        lp = front + under + rear
        if sgn < 0:
            lp = mirror(lp)
        ch = Region(B, lp, CHEEK_T).build(p, grid=(deg(14), 0.035, 0.012))
        ch.wall(p, base=-0.001, span=(len(front) - 1, len(lp) - 1))
        regions.append(ch)

    # --- Neck guard: a flared lame round the back with a trim band on its lower edge ---
    a0 = B.locate(0.07, LAME_T, z=sz(LAME_TOP[0][0]))[1]
    zt, yt = sz([q[0] for q in LAME_TOP])[::-1], fy([q[1] for q in LAME_TOP])[::-1]
    zb_, yb_ = sz([q[0] for q in LAME_BOT])[::-1], fy([q[1] for q in LAME_BOT])[::-1]
    ang = np.linspace(a0, TAU - a0, 21)
    zs = [B.base(0.08, a)[2] for a in ang]
    lame_top = [(float(np.interp(z, zt, yt)), a) for z, a in zip(zs, ang)]
    lame_bot = [(float(np.interp(z, zb_, yb_)), a) for z, a in zip(zs, ang)]
    lp = lame_bot + [(0.5 * (lame_bot[-1][0] + lame_top[-1][0]), ang[-1])] + lame_top[::-1] + \
        [(0.5 * (lame_bot[0][0] + lame_top[0][0]), ang[0])]
    lame = Region(B, lp, LAME_T)
    lame.build(p, trims=[(0, len(lame_bot) - 1)], band=HELM_BAND)
    lame.wall(p, base=-0.001)
    regions.append(lame)

    # --- Skull: the hull itself, where no plate covers it ---
    def shown(y, a):
        a1 = (a + math.pi) % TAU - math.pi
        return not (visor.contains(y, a1) or regions[1].contains(y, a1) or regions[2].contains(y, a1)
                    or lame.contains(y, a % TAU))
    yk = 0.155
    rows = [0.3625, 0.354, 0.340, 0.320, 0.293, 0.262, 0.228, 0.192, yk,
            lambda a: 0.5 * (yk + helm_bottom(a)), helm_bottom]
    NC = 28
    V = hull_grid(p, B, rows, NC, "plate", keep=shown)
    top = np.array([0.0, B.y1, B.sec(B.y1)[3]])
    p.put([top] + V[:NC], [(0, 1 + j, 1 + (j + 1) % NC) for j in range(NC)], "plate")
    rim = V[-NC:]

    # --- Crown ridge: a raised strip from the nape over the crown to the visor's apex, trim on both edges ---
    y_nape, y_end = 0.128, apex_y - 0.004
    us = np.linspace(-1, 1, 81)
    cen = []
    for u in us:
        y = B.y1 - (B.y1 - (y_nape if u < 0 else y_end)) * u * u
        rx, rf, rb, cz, _, _ = B.sec(y)
        cen.append((0.0, y, cz - rb if u < 0 else cz + rf))
    cen = resample(np.array(cen), n=19)
    wmid = lambda q: 0.0175 + 0.0062 * (smoothstep(0.36, 0.325, q[1]) if q[2] > 0.1 else 0.0)   # noqa: E731
    rowsr = []
    for i, c in enumerate(cen):
        t = unit(cen[min(i + 1, len(cen) - 1)] - cen[max(i - 1, 0)])
        n = np.array([0.0, -t[2], t[1]])
        if n @ (c - p.C0) < 0:
            n = -n
        wm = wmid(c)
        row = []
        for x, h in ((-wm - half, -0.001), (-wm - half, RIDGE_T), (-wm + half, RIDGE_T), (0.0, RIDGE_T + 0.0025),
                     (wm - half, RIDGE_T), (wm + half, RIDGE_T), (wm + half, -0.001)):
            _, q = B.drop(c + np.array([x, 0.0, 0.0]), n)
            row.append(q + n * h)
        rowsr.append(row)
    R = np.array(rowsr)
    for k, (mat, ref) in enumerate((("plate", (-1, 0, 0)), ("trim", None), ("plate", None), ("plate", None),
                                    ("trim", None), ("plate", (1, 0, 0)))):
        p.strip(R[:, k], R[:, k + 1], mat, ref)
    p.put(R[0], [tuple(range(7))], "plate", -(cen[1] - cen[0]))         # the square end at the nape

    # --- Rivets: the visor pivot, three above the lame, one on the cheek (side view) ---
    for sgn in (1, -1):
        for (px, py), off, r in [(RIVET_PIVOT, VISOR_T, 0.0095), (RIVET_CHEEK, CHEEK_T, 0.0065)] + \
                [(q, 0.0, 0.0065) for q in RIVETS_SKULL]:
            y, a = B.locate(float(fy(py)), off, z=float(sz(px)))
            dome(p, "plate", B.point(y, sgn * a, off), B.normal(y, sgn * a), r)

    # --- Padded collar under the helm (dark): fills the gap down to the gorget ---
    pad = Hull([-0.058, 0.008, 0.018, 0.028, 0.037, 0.06, 0.10],
               [0.170, 0.172, 0.168, 0.155, 0.143, 0.130, 0.118],
               [0.190, 0.200, 0.200, 0.200, 0.200, 0.196, 0.19],
               [-0.100, -0.100, -0.099, -0.095, -0.074, -0.056, -0.045],
               [0.04] * 7, [1.05] * 7, [2.0] * 7)
    hull_grid(p, pad, [0.065, 0.037, 0.028, 0.014, -0.055], 16, "plate_dark", cap="bottom")
    # The helm's underside, from its lower edge in to the padding.
    inner = [pad.point(min(helm_bottom(TAU * j / NC) + 0.016, 0.09), TAU * j / NC) for j in range(NC)]
    p.strip(rim, inner, "plate_dark", (0, -1, 0), closed=True)

    crest = None
    if enemy_crest:
        crest = Piece("helm_crest")
        for sgn in (1, -1):
            tube(crest, "plate", [B.point(y, sgn * a) + np.array([0, dy, 0]) for y, a, dy in (
                (0.28, deg(30), 0.0), (0.345, deg(75), 0.02), (0.30, deg(145), 0.05), (0.17, deg(155), 0.09))], r=0.022)
    return p, crest
