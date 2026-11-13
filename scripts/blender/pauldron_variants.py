"""Head-to-head pauldron variants built from the Trellis mesh of the plate-pauldron sheet.

  trellis  the Trellis mesh as the piece: cut off its arm stub, smoothed and decimated to the
           scripted pauldron's triangle budget, plate / plate_dark faces and enamel trim read
           from its texture (trellis_part.Part), fitted to the scripted pauldron's bounds.
  hybrid   the same Trellis surface, but with the scripted pauldron's measured trim moved onto
           it (each tube vertex keeps its offset from the surface it was built on).

Both are fitted per axis to the scripted pauldron's bounding box, which matches the
references to ~1 cm (art/rounds/2026-11-13-pauldron.md), so the comparison is of surface
shape and trim, not of size or placement.

Raw Trellis frame (Blender space of the imported GLB): -Y is the inner (neck) side where the
fin stands, +Y the outer side where the lames step down, +-X the front and back (a rondel on
each), +Z up; below z -0.25 is a stub of upper arm the sheet drew under the lames.
"""
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from lib import ROOT
from plate_geom import TRIM_R, Piece, add_part
from trellis_part import Part

SRC = ROOT / "art/source/plate-pauldron/trellis-v1/plate-pauldron-model_mesh-model.glb"
CUT_Z = -0.25
_cache = {}


def _raw(target_tris):
    if target_tris not in _cache:
        _cache[target_tris] = Part(SRC, keep=((-1, -1, CUT_Z), (1, 1, 1)), target_tris=target_tris, smooth=0.5)
    return _cache[target_tris]


def _bounds(piece):
    V = np.array(piece.verts)
    return V.min(0), V.max(0)


def _fitted(scripted, s, target_tris):
    """The Trellis part mapped into the scripted piece's frame and box (left side, mirrored by s)."""
    part = _raw(target_tris)
    to_game = lambda P: np.stack([P[:, 1], P[:, 2], P[:, 0]], 1)       # noqa: E731
    G = to_game(part.verts)
    lo, hi = G.min(0), G.max(0)
    tlo, thi = _bounds(scripted)
    if s < 0:   # the right piece is the left one mirrored: fit the left box, then mirror
        tlo, thi = np.array([-thi[0], tlo[1], tlo[2]]), np.array([-tlo[0], thi[1], thi[2]])
    k = (thi - tlo) / (hi - lo)
    m = np.array([s, 1.0, 1.0])

    def fn(P):
        return (tlo + (to_game(P) - lo) * k) * m

    def nfn(N):
        M = to_game(N) / k * m            # normals take the inverse scale
        return M / np.linalg.norm(M, axis=1, keepdims=True)
    verts = fn(part.verts)
    trim = [(fn(Q), nfn(N)) for Q, N in part.trim]
    return verts, part.faces, part.cls, trim


class _P:
    """Just the fields plate_geom.add_part reads."""

    def __init__(self, verts, faces, cls, trim):
        self.verts, self.faces, self.cls, self.trim = verts, faces, cls, trim


def _tris(piece):
    return sum(len(f) - 2 for f in piece.faces)


def trellis(scripted, s):
    budget = int(_tris(scripted) * 0.8)        # leave ~20% for the trim tubes
    verts, faces, cls, trim = _fitted(scripted, s, budget)
    p = Piece(scripted.name)
    add_part(p, _P(verts, faces, cls, trim), r=TRIM_R, off=0.002)
    return p


def hybrid(scripted, s):
    trim_faces = [i for i, m in enumerate(scripted.mats) if m == "trim"]
    surf_faces = [i for i, m in enumerate(scripted.mats) if m != "trim"]
    SV = np.array(scripted.verts)
    budget = _tris(scripted) - sum(len(scripted.faces[i]) - 2 for i in trim_faces)
    verts, faces, cls, _ = _fitted(scripted, s, budget)
    p = Piece(scripted.name)
    add_part(p, _P(verts, faces, cls, []))
    # BVHs: the scripted surface the trim was built on, and the Trellis surface it moves to.
    src = BVHTree.FromPolygons([Vector(v) for v in SV], [scripted.faces[i] for i in surf_faces])
    dst = BVHTree.FromPolygons([Vector(v) for v in verts], [tuple(f) for f in faces])
    used = sorted({v for i in trim_faces for v in scripted.faces[i]})
    moved = {}
    for vi in used:
        v = Vector(SV[vi])
        d, n_d, _, _ = src.find_nearest(v)
        if d is None:
            moved[vi] = v
            continue
        if n_d.dot(v - d) < 0:
            n_d = -n_d
        o = v - d
        h = o.dot(n_d)
        # Find the Trellis surface along the scripted normal (both ways), else the nearest point.
        hit = None
        for sign in (1, -1):
            loc, n_t, _, dist = dst.ray_cast(d + n_d * 0.08 * sign, -n_d * sign, 0.16)
            if loc is not None and (hit is None or dist < hit[2]):
                hit = (loc, n_t, dist)
        if hit is None:
            loc, n_t, _, _ = dst.find_nearest(d)
        else:
            loc, n_t = hit[0], hit[1]
        if n_t.dot(n_d) < 0:
            n_t = -n_t
        moved[vi] = loc + n_t * h + (o - n_d * h)
    remap = {vi: j for j, vi in enumerate(used)}
    p.add([tuple(moved[vi]) for vi in used], [tuple(remap[v] for v in scripted.faces[i]) for i in trim_faces], "trim")
    return p


VARIANTS = {"trellis": trellis, "hybrid": hybrid}
