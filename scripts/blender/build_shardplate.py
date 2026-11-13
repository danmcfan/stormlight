"""Build the Shardplate as rigid pieces that ride on the game skeleton.

Input:  the construction references in art/source/shardplate-*/nb21-v1. The
        front view is the primary target: sizes below were measured off its
        silhouette (compare_reference.py scores the match per view).
Output: public/models/shardplate.glb and art/renders/shardplate/*.png

Every piece is one mesh object named for the bone it rides on, with its
origin at that bone's joint, in the body space src/render/humanoid.ts uses
(metres, +Y up, +Z forward, +X = the character's left). No skinning: the game
parents each piece to the matching group, so the procedural animation (arm IK,
walk cycle, sword poses) drives the Plate unchanged. The skeleton constants are
read from humanoid.ts (skeleton.py).

  piece          parent group (humanoid.ts)       origin
  helm           helm group                       torso y HELM_Y
  gorget         torso                            waist (torso origin)
  breastplate    torso                            waist
  abdomen        torso                            waist
  pauldron_l/r   torso                            shoulder (±SHOULDER)
  upperarm_l/r   arm upper                        shoulder
  forearm_l/r    arm lower                        elbow
  gauntlet_l/r   arm lower                        wrist (LOWER_ARM below the elbow)
  belt           body                             waist (0, WAIST_Y, 0)
  fauld_front    body (swings with the legs)      (0, FAULD_Y, FAULD_FRONT_Z)
  fauld_back     body (swings with the legs)      (0, FAULD_Y, FAULD_BACK_Z)
  tasset_l/r     body (swings with its thigh)     (±TASSET_X, TASSET_Y, 0)
  thigh_l/r      leg upper                        hip (±LEG_X, HIP_Y)
  shin_l/r       leg lower                        knee (THIGH below the hip)
  boot_l/r       leg lower                        ankle (SHIN below the knee)
  helm_crest     helm group (enemy only)          as helm

Materials (names the game matches on): plate, plate_dark, trim, glow.

Geometry is scripted: lofted superellipse sections (smooth Catmull-Rom between
key sections), tubes for the raised enamel trim, solid shell patches for
tassets and the collar, and extruded leaf slabs for the fauld.

  .venv-blender/bin/python scripts/blender/build_shardplate.py [--no-render]
"""
import math
import sys

import bpy
import bmesh  # noqa: E402  (needs bpy imported first)
import numpy as np

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import ROOT, deg, export_glb, link, material, render_views, reset_scene  # noqa: E402
from skeleton import (FAULD_BACK_Z, FAULD_FRONT_Z, FAULD_Y, HELM_Y, HIP_Y, LEG_X, LOWER_ARM, SHIN,  # noqa: E402
                      SHOULDER, TASSET_X, TASSET_Y, THIGH, UPPER_ARM, WAIST_Y)

from plate_geom import *  # noqa: E402,F401,F403
from plate_geom import MATS, TRIM_R, FRONT, BACK, TAU  # noqa: E402

# --- The pieces ---------------------------------------------------------------------
# Sizes in metres, measured off the front reference scaled to the game height
# (helm top 2.37 m): the Plate is 1.7 m across the arms, 1.5 m across the
# pauldrons, its legs 0.34 m thick.

HELM_O = (0.0, WAIST_Y + HELM_Y, 0.0)     # helm joint, world (2.0 m)
CHEST_O = (0.0, WAIST_Y, 0.0)              # torso pieces' origin (the waist)


def rivet(p, centre, nrm, r=0.009):
    disc(p, "plate", centre, nrm, r, r * 0.9, seg=8)


def build_helm(enemy_crest=False):
    """Armet with a prow visor, measured off the helm sheet (helm_collar.py): skull, visor with the
    recessed eye slit, cheek plates, flared neck guard, crown ridge, flush trim. Origin: helm joint."""
    import helm_collar
    return helm_collar.make_helm(enemy_crest)


def build_gorget():
    """Standing flared collar, open in a V at the front over the dark padded neck, trim along
    the rim and a second band below it (helm_collar.make_gorget, measured off plate-helm-34).
    Origin: the waist."""
    import helm_collar
    return helm_collar.make_gorget()


def build_breastplate():
    """Barrel chest: hex sapphire at the sternum, trim V from the collar to it, an arc under the
    chest, two lines each side down the abdomen, a shallow V lower edge; back: the yoke arc and
    lines down to the belt (front/back references, world metres). Origin: the waist."""
    p = Piece("breastplate")
    L = Loft([
        dict(y=0.16, rx=0.3, rf=0.27, rb=0.3, cz=0.03, p=2.3),
        dict(y=0.32, rx=0.33, rf=0.31, rb=0.34, cz=0.03, p=2.4),
        dict(y=0.48, rx=0.37, rf=0.35, rb=0.34, cz=0.03, p=2.5),
        dict(y=0.62, rx=0.385, rf=0.37, rb=0.33, cz=0.03, p=2.5),
        dict(y=0.74, rx=0.375, rf=0.34, rb=0.31, cz=0.03, p=2.4),
        dict(y=0.84, rx=0.355, rf=0.29, rb=0.27, cz=0.03),
        dict(y=0.90, rx=0.29, rf=0.24, rb=0.23, cz=0.04),
    ]).mesh(p, "plate", seg=28, sub=2)
    t_gem = t_at(L, 0.7)
    hexgem(p, L.surf(t_gem, FRONT, -0.012), L.normal(t_gem, FRONT), 0.05, 0.08, 0.032)
    O = CHEST_O
    # Raised centre line from under the gem to the lower edge.
    ref_path(p, "plate", L, [(0.0, 1.635), (0.0, 1.5), (0.0, 1.37)], "front", O, r=0.008, mirror=False, flat=None)
    ref_path(p, "trim", L, [(0.235, 1.99), (0.12, 1.905), (0.05, 1.845)], "front", O)
    ref_path(p, "trim", L, [(0.0, 1.655), (0.1, 1.625), (0.2, 1.588), (0.28, 1.535), (0.345, 1.475), (0.375, 1.43)],
             "front", O)
    ref_path(p, "trim", L, [(0.2, 1.585), (0.18, 1.47), (0.13, 1.32)], "front", O)
    ref_path(p, "trim", L, [(0.3, 1.52), (0.3, 1.43), (0.27, 1.355)], "front", O)
    ref_path(p, "trim", L, [(0.0, 1.29), (0.15, 1.31), (0.3, 1.355), (0.37, 1.39)], "front", O)
    # Back: yoke V under the collar, the arch over the shoulder blades, two lines down.
    ref_path(p, "trim", L, [(0.0, 1.97), (0.12, 2.0), (0.22, 2.03)], "back", O)
    ref_path(p, "trim", L, [(0.0, 1.615), (0.12, 1.6), (0.25, 1.55), (0.35, 1.49), (0.38, 1.45)], "back", O)
    ref_path(p, "trim", L, [(0.19, 1.575), (0.18, 1.46), (0.16, 1.37)], "back", O)
    return p


def build_abdomen():
    """A lame under the breastplate's lower edge (shows when the torso leans). Origin: the waist."""
    p = Piece("abdomen")
    L = Loft([
        dict(y=-0.06, rx=0.3, rf=0.26, rb=0.24, cz=0.03, p=2.3),
        dict(y=0.08, rx=0.31, rf=0.27, rb=0.25, cz=0.03, p=2.3),
        dict(y=0.2, rx=0.3, rf=0.265, rb=0.245, cz=0.03, p=2.3),
    ]).mesh(p, "plate_dark", seg=20, sub=1)
    return p


def build_belt():
    """Belt band (1.22-1.38 m) dipping to a V at the centre front, trim on both edges; the dark
    padding (abdomen piece) shows below it between the tassets and the fauld. Origin: the waist."""
    p = Piece("belt")
    L = Loft([
        dict(y=0.29, rx=0.355, rf=0.325, rb=0.315, cz=0.03, p=2.5),
        dict(y=0.22, rx=0.37, rf=0.335, rb=0.325, cz=0.03, p=2.5),
        dict(y=0.12, rx=0.372, rf=0.338, rb=0.322, cz=0.03, p=2.5),
        dict(y=0.06, rx=0.37, rf=0.335, rb=0.32, cz=0.03, p=2.5),
    ])
    nth = 32

    def vee(v):
        d = abs(((v * TAU - FRONT + math.pi) % TAU) - math.pi)
        return max(0.0, 1 - d / 0.55)
    bot = lambda v: t_at(L, 0.18 - 0.05 * vee(v))       # noqa: E731
    top = t_at(L, 0.27)
    patch(p, "plate", L, bot, top, 0.0, TAU, off=0.0, thick=0.02, nt=3, nth=nth)
    yring(p, "trim", L, 0.258, off=0.02)
    path(p, "trim", L, [(bot(j / 48) - 0.1, TAU * j / 48) for j in range(49)], r=TRIM_R, off=0.02, n=44)
    return p


def leaf_rows(p, rows, back=False, dz=0.0):
    """Overlapping rows of long pointed leaves hanging from the origin, wrapping round the body."""
    sgn = -1 if back else 1
    for n, w, h, y, z, tilt in rows:
        for k in range(n):
            x = (k - (n - 1) / 2) * w * 0.86
            zz = z + dz - 1.6 * x * x - 0.004 * k
            fr = Frame(rot_y(0 if not back else math.pi) @ rot_y(-x * 2.2) @ rot_x(-tilt), (x, y, sgn * zz))
            leaf(p, "plate", w, h, 0.015, fr, nu=2, nv=3, bulge=0.012)


def build_fauld():
    """Fauld: rows of long pointed leaves with a centre ridge, each row behind and below the one
    above, the centre leaf to 0.58 m (front reference); the back one to 0.56 m."""
    front = Piece("fauld_front")
    # (count, width, height, top y, z, forward tilt) from the top row down; origin at FAULD_Y (1.22 m).
    leaf_rows(front, [(4, 0.096, 0.21, 0.03, 0.0, 0.16), (4, 0.096, 0.21, -0.1, -0.006, 0.2),
                      (3, 0.096, 0.215, -0.23, -0.012, 0.22), (1, 0.1, 0.22, -0.36, -0.018, 0.22)], dz=0.07)
    back = Piece("fauld_back")
    leaf_rows(back, [(4, 0.096, 0.21, 0.05, 0.0, 0.1), (4, 0.096, 0.205, -0.09, -0.006, 0.12),
                     (3, 0.096, 0.21, -0.24, -0.012, 0.14), (1, 0.1, 0.2, -0.36, -0.018, 0.15)], back=True, dz=0.0)
    return front, back


def build_tasset(s):
    """Shield-shaped plate over the outside of the hip, hanging from the belt and flaring out:
    narrow at the top, widest two-thirds down, a rounded bottom lowest in the middle, a trim line
    set in from its edge; dark padding shows between it and the fauld. Origin: its hinge."""
    p = Piece(f"tasset_{'l' if s > 0 else 'r'}")
    o = np.array([s * TASSET_X, TASSET_Y, 0.0])
    L = Loft([
        dict(y=1.3, rx=0.39, rf=0.27, rb=0.26, cz=0.02, p=2.4),
        dict(y=1.08, rx=0.47, rf=0.3, rb=0.29, cz=0.02, p=2.4),
        dict(y=0.84, rx=0.53, rf=0.33, rb=0.32, cz=0.02, p=2.4),
    ], Frame(None, -o))
    c = 0.0 if s > 0 else math.pi          # the outside of the hip
    wide = lambda u: math.sin(math.pi * min(1.0, u / 1.35)) ** 0.7                # noqa: E731
    fr = lambda u: deg(22 + 34 * wide(u))                                         # noqa: E731
    bk = lambda u: deg(-18 - 32 * wide(u))                                        # noqa: E731
    th0 = (lambda u: c + bk(u)) if s > 0 else (lambda u: c - fr(u))
    th1 = (lambda u: c + fr(u)) if s > 0 else (lambda u: c - bk(u))
    T1 = lambda v: 1.82 + 0.18 * math.sin(math.pi * v)                            # noqa: E731
    patch(p, "plate", L, 0.0, T1, th0, th1, off=0.0, thick=0.016, nt=8, nth=12)
    th = lambda u, v: th0(u) + (th1(u) - th0(u)) * v                              # noqa: E731
    loop = [(u * T1(0.07), th(u, 0.07)) for u in np.linspace(0.1, 0.9, 7)]
    loop += [(0.9 * T1(v), th(0.9, v)) for v in np.linspace(0.07, 0.93, 9)[1:]]
    loop += [(u * T1(0.93), th(u, 0.93)) for u in np.linspace(0.9, 0.1, 7)[1:]]
    path(p, "trim", L, loop, r=TRIM_R * 0.85, off=0.017, n=36)
    return p


def band(p, mat, loft, y, r=TRIM_R, th0=0.0, th1=TAU, n=None, **kw):
    """A trim band at a local height on a loft (rings take t, which drifts as sections move)."""
    ring(p, mat, loft, t_at(loft, y), r=r, th0=th0, th1=th1, n=n, **kw)


def rim(p, mat, loft, yf, n=40, r=TRIM_R, off=0.0):
    """A closed band round a loft whose height varies with angle: yf(th) -> local y.

    The pauldron's rim is cut high over the outside of the arm and low at the front and back, so it
    reads as a rising line in the front view rather than the horizontal ring a flat section gives.
    """
    ths = np.linspace(0, TAU, n, endpoint=False)
    pts = [loft.surf(t_at(loft, yf(th)), th, off) for th in ths]
    nrm = [loft.normal(t_at(loft, yf(th)), th) for th in ths]
    tube(p, mat, pts, r=r, closed=True, nrm=nrm, flat=FLAT)


# The references draw the arms out from the body, and compare_reference.py poses the model to
# match (POSE arm 45, elbow -37), so trim read off the front reference is in that posed frame.
REF_ARM, REF_ELBOW = deg(45), deg(-37)
ELBOW = (SHOULDER[0] + UPPER_ARM * math.sin(REF_ARM), WAIST_Y + SHOULDER[1] - UPPER_ARM * math.cos(REF_ARM))
ELBOW_ROLL = REF_ARM + REF_ELBOW                                   # the vambrace hangs 8 deg out
WRIST = (ELBOW[0] + LOWER_ARM * math.sin(ELBOW_ROLL), ELBOW[1] - LOWER_ARM * math.cos(ELBOW_ROLL))


def posed(pts, o, roll):
    """Front-view reference points (x, h in world metres) -> (x, y) in a piece whose origin is at
    `o` and which the compare pose rolls `roll` about +z. proj/ref_path ignore rotation, so the
    arm pieces (which are posed) need this first."""
    c, s = math.cos(roll), math.sin(roll)
    return [(c * (x - o[0]) + s * (h - o[1]), -s * (x - o[0]) + c * (h - o[1])) for x, h in pts]


def posed_path(p, mat, loft, pts, o, roll, **kw):
    """Trim along reference points read off the front view, in the piece's own (posed) frame."""
    path(p, mat, loft, [(t_at(loft, y), th_for(loft, t_at(loft, y), x, "front")) for x, y in posed(pts, o, roll)], **kw)


def th_near(loft, t, x, z):
    """The loft angle whose section point is closest to local (x, z), for trim that both the front
    and the side reference pin down (a line on the outer face, at a known depth)."""
    ths = np.linspace(0, TAU, 361)
    pts = np.array([loft.local(t, th) for th in ths])
    return float(ths[int(np.argmin((pts[:, 0] - x) ** 2 + (pts[:, 2] - z) ** 2))])


def build_pauldron(s):
    """Pauldron (front/side/back references, plate-pauldron sheet): an upright dome whose outer face
    drops nearly straight over the arm, a rim trim band 2 cm above its lower edge (x +-0.73 at
    h 1.80 in the front view), two lames below it wrapping the outside of the arm with trim along
    their lower edges (out to x 0.71 at h 1.70 and 0.70 at 1.62), an arched flange (the "horn") along
    its inner edge, and round bosses where it meets the chest and back. The lames stop at x 0.70
    below 1.68: the reference's pauldron pinches in over the elbow there.
    Built for the left side and mirrored. Origin: the shoulder."""
    p = Piece(f"pauldron_{'l' if s > 0 else 'r'}")
    M = Frame(np.diag([s, 1.0, 1.0]))
    mx = lambda v: np.array([s * v[0], v[1], v[2]])   # noqa: E731
    cx, cz = 0.095, -0.07
    dome = Loft([
        dict(y=0.055, rx=0.228, rf=0.242, rb=0.25, cx=cx, cz=cz, p=2.3),
        dict(y=0.095, rx=0.238, rf=0.252, rb=0.26, cx=cx, cz=cz, p=2.3),
        dict(y=0.18, rx=0.228, rf=0.234, rb=0.24, cx=cx, cz=cz, p=2.25),
        dict(y=0.26, rx=0.186, rf=0.192, rb=0.198, cx=cx, cz=cz, p=2.15),
        dict(y=0.32, rx=0.116, rf=0.128, rb=0.134, cx=cx, cz=cz),
        dict(y=0.352, rx=0.055, rf=0.07, rb=0.075, cx=cx, cz=cz),
        dict(y=0.362, rx=0.01, rf=0.01, rb=0.01, cx=cx, cz=cz),
    ], M).mesh(p, "plate", seg=26, sub=2)
    # The dome's trim is one continuous outline, as the front reference draws it: up the inner edge
    # (x 0.34 from h 1.97 down to 1.88), out along the rim to x 0.44 at h 1.73, then sweeping out and
    # up over the outside of the arm to x 0.70 at h 1.82 — the band the brief measures at +-0.73
    # around h 1.80. Local y = world h - 1.70, local x = world x - 0.42 (the shoulder).
    o = (s * 0.42, 1.70)
    arch = [(0.320, 1.945), (0.322, 1.910), (0.330, 1.880), (0.355, 1.850), (0.395, 1.815),
            (0.428, 1.790)]
    q = posed([(s * ax, ah) for ax, ah in arch], o, 0.0)
    if s < 0:
        q = [(-ax, ay) for ax, ay in q]
    path(p, "trim", dome, [(t_at(dome, y), th_for(dome, t_at(dome, y), x, "left" if s > 0 else "right"))
                           for x, y in q], r=TRIM_R, n=20)
    # The rim proper: an arc along the dome's lower edge from the front (x 0.42, h 1.74) round the
    # outside of the arm (x 0.71 at h 1.82, the band the brief measures at +-0.73 round h 1.80) to
    # the back. In the dome's own angles th 0 is the outside of the arm and +-80 deg the front and
    # back edges, so the band is lowest at the edges and highest over the outside.
    rim(p, "trim", dome, lambda th: 0.030 + 0.062 * math.cos(th) ** 3, n=44)
    # Lames: partial bands round the outside of the arm, each tucked under the one above, the lower
    # edge flared and trimmed. Over the *outside* of the arm the reference's lames are a straight
    # wall in the front view (x 0.70-0.73, nearly vertical); their lower edges dip in the side view
    # and hook up at the front and back, so `edge` is a t that is greatest over the outside.
    for y0, y1, k in ((-0.03, 0.07, 0.0), (-0.105, -0.005, 0.012)):
        lame = Loft([dict(y=y1, rx=0.2 - k, rf=0.228 - k, rb=0.235 - k, cx=cx + 0.005, cz=cz, p=2.2),
                     dict(y=y0, rx=0.205 - k, rf=0.236 - k, rb=0.243 - k, cx=cx + 0.005, cz=cz, p=2.2)], M)
        # Side view: the lame's lower edge sits at h 1.72 / 1.62 from the outer face round to the
        # front, and rides up to 1.78 / 1.68 where the next lame tucks under at the front and back.
        edge = lambda v: 0.34 + 0.52 * math.sin(math.pi * v) ** 0.55          # noqa: E731
        patch(p, "plate", lame, 0.0, edge, deg(-112), deg(112), off=0.0, thick=0.014, nt=3, nth=18)
        path(p, "trim", lame, [(edge(v) - 0.075, deg(-108) + deg(216) * v) for v in np.linspace(0.02, 0.98, 14)],
             r=TRIM_R * 0.9, off=0.014, n=22)
    # The arched flange along the inner edge: outline in (z, y), bent to follow the dome's edge,
    # leaning a little toward the head. Its top arc carries a trim line on the outer face.
    # A rounded half-disc: centre (z -0.09, y 0.27), radii 0.255 (z) x 0.26 (y), base buried in the dome.
    arc = [(-0.09 + 0.255 * math.cos(a), 0.27 + 0.26 * math.sin(a)) for a in np.linspace(deg(8), deg(172), 15)]
    base = [(-0.3, 0.15), (-0.09, 0.17), (0.12, 0.15)]
    outline = arc + base
    lean = rot_z(s * deg(4))
    yaw = rot_y(deg(22))         # front end swung out: the front view sees a broad fin

    def fl(z, y, x=0.0):
        return lean @ mx(yaw @ np.array((-0.04 + x + 1.2 * (z - cz) ** 2, y, z - cz)) + np.array((0, 0, cz)))
    thick = 0.032
    n = len(outline)
    verts = [fl(z, y, thick / 2) for z, y in outline] + [fl(z, y, -thick / 2) for z, y in outline]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    p.add(verts, faces, "plate")
    inset = [(-0.09 + (z + 0.09) * 0.86, 0.27 + (y - 0.27) * 0.86) for z, y in arc[1:-1]]
    pts = [fl(z, y, thick / 2 + 0.002) for z, y in inset]
    tube(p, "trim", pts, r=TRIM_R * 0.85, nrm=[lean @ mx((1, 0, 0))] * len(pts), flat=0.45)
    # Trim down the dome's inner front edge, from the fin to the rondel (reference: the vertical
    # line at x 0.32-0.37 running h 1.68 down to 1.56 on the inner side of the arm).
    path(p, "trim", dome, [(t_at(dome, 0.3), deg(150)), (t_at(dome, 0.22), deg(132)), (t_at(dome, 0.13), deg(118))],
         r=TRIM_R, n=10)
    for z, nz in ((0.235, 1.0), (-0.355, -1.0)):
        c = mx((-0.065, 0.1, z))
        nrm = mx((-0.35, 0.05, nz))
        disc(p, "plate", c, nrm, 0.09, 0.04, seg=16, rondel=True)
    return p


def build_upperarm(s):
    """Dark padded arm with a rerebrace over its lower half (mostly under the pauldron). Origin: shoulder."""
    p = Piece(f"upperarm_{'l' if s > 0 else 'r'}")
    k = UPPER_ARM / 0.4
    Loft([
        dict(y=0.07, rx=0.04, rf=0.04, rb=0.04),
        dict(y=0.03, rx=0.115, rf=0.115, rb=0.115),
        dict(y=-0.1 * k, rx=0.122, rf=0.122, rb=0.122),
        dict(y=-0.36 * k, rx=0.11, rf=0.11, rb=0.11),
    ]).mesh(p, "plate_dark", seg=16, sub=1)
    # Rerebrace: a plate cylinder over the lower half, trimmed at its top edge.
    L = Loft([
        dict(y=-0.15 * k, rx=0.133, rf=0.135, rb=0.135),
        dict(y=-0.26 * k, rx=0.13, rf=0.132, rb=0.132),
        dict(y=-0.37 * k, rx=0.12, rf=0.12, rb=0.12),
    ]).mesh(p, "plate", seg=18, sub=2)
    ring(p, "trim", L, 0.1, r=TRIM_R * 0.85)
    return p


def build_forearm(s):
    """Couter (round elbow cop with a disc on the outside) + a heavy vambrace flared toward the
    elbow, with the reference's two trim bands and the stepped line down the outside. Origin: the
    elbow.

    Front reference: the vambrace is widest at its top (x 0.48-0.86 at h 1.40) and tapers to the
    wrist; the bands ring it at 1.38-1.42 and 1.11-1.15 (centres 1.40 and 1.13); the stepped line
    jogs from x 0.58 at h 1.36 out to 0.65 at 1.26, then drops straight to the lower band."""
    p = Piece(f"forearm_{'l' if s > 0 else 'r'}")
    # The elbow cop rides high: the references draw the elbow well up under the lames, inside the
    # vambrace's own width (the front reference is 0.70 wide at h 1.57 and 0.73 at 1.62, both of
    # which the vambrace's flared top already fills), so the cop is small and the disc sits on it.
    ellipsoid(p, "plate", (s * 0.01, 0.035, -0.01), (0.1, 0.105, 0.105), seg=14, rings=5)
    disc(p, "plate", (s * 0.098, 0.075, -0.02), (s, 0.15, -0.3), 0.052, 0.032, seg=14)
    disc(p, "plate", (s * 0.114, 0.079, -0.025), (s, 0.15, -0.3), 0.034, 0.024, seg=12)
    L = Loft([
        dict(y=0.02, rx=0.155, rf=0.145, rb=0.145),
        dict(y=-0.05, rx=0.168, rf=0.152, rb=0.152),
        dict(y=-0.2, rx=0.152, rf=0.138, rb=0.138),
        dict(y=-0.31, rx=0.138, rf=0.126, rb=0.126),
        dict(y=-0.345, rx=0.132, rf=0.122, rb=0.122),
    ]).mesh(p, "plate", seg=22, sub=2)
    band(p, "trim", L, -0.05, r=TRIM_R)          # centred on h 1.40 in the compare pose
    band(p, "trim", L, -0.3, r=TRIM_R)           # centred on h 1.13, just above the wrist
    # The stepped line down the outer face, read off the front reference: x 0.58 at h 1.36,
    # stepping out to 0.65 at 1.26 and 0.655 at 1.15. th_for's "front" face solves local x from a
    # front-view reading, which is the measurement the brief gives.
    pts = [(0.578, 1.36), (0.600, 1.322), (0.640, 1.285), (0.648, 1.22), (0.655, 1.15)]
    q = posed(pts, (ELBOW[0], ELBOW[1]), ELBOW_ROLL)
    if s < 0:
        q = [(-x, y) for x, y in q]
    path(p, "trim", L, [(t_at(L, y), th_for(L, t_at(L, y), x, "front")) for x, y in q], r=TRIM_R * 0.9, n=18)
    return p


HAND_K = 1.25      # fist scale (the references draw huge gauntlets)
GRIP_Y = -0.17 * HAND_K   # the grip passes through the fist this far below the wrist (humanoid.ts PLATE_HAND)
# The fingers, in the gauntlet's own frame in *metres* (+x out of the back of the hand, y down the
# arm; the wrist is the origin), converted from the front reference's silhouette per 2 cm of height:
#   local y  outer x  inner x        (the piece is rolled 8 deg, so world h ~= 1.096 + y)
#   -0.117   +0.084   -0.058         h 0.94: 0.18 m across the knuckles
#   -0.198   +0.060   -0.057         h 0.86
#   -0.260   +0.041   -0.070         h 0.84
#   -0.301   +0.012   -0.095         h 0.80
#   -0.334   -0.032   -0.099         h 0.76
#   -0.350   -0.053   -0.077         h 0.74, the tips
# So the knuckle row is 0.14 m wide, the fingers lean inboard as they drop (the drawing curls them
# under the palm), the middle ones are longest, and the tips gather into a 4 cm band at h 0.73-0.75.
FINGERS = ((0.085, -0.050, -0.330), (0.045, -0.068, -0.350),
           (0.005, -0.082, -0.345), (-0.035, -0.096, -0.310))
KNUCKLE_Y = -0.117


def build_gauntlet(s):
    """Heavy gauntlet (plate-gauntlet sheet, front reference): a flared cuff with the enamel band
    under its lower rim, a plate over the back of the hand with the sheet's inked border, knuckle
    domes, four fingers of three plates hanging across the hand and curling in under the palm to
    the tips at h 0.73, a thumb of two plates down the inner side to h 0.86, dark leather at the
    palm. The back of the hand faces out (+x on the left hand). Origin: the wrist; the grip runs
    through the fist, GRIP_Y below the wrist."""
    p = Piece(f"gauntlet_{'l' if s > 0 else 'r'}")
    mx = lambda v: np.array([s * v[0], v[1], v[2]])   # noqa: E731
    cuff = Loft([
        dict(y=0.036, rx=0.098, rf=0.088, rb=0.086),
        dict(y=-0.004, rx=0.094, rf=0.084, rb=0.082),
        dict(y=-0.032, rx=0.082, rf=0.076, rb=0.074),
    ]).mesh(p, "plate", seg=22, sub=1)
    band(p, "trim", cuff, -0.007, r=TRIM_R * 0.85, n=26)  # the enamel band under the cuff (h ~1.09)
    # Hand: dark leather core from the cuff to the knuckles, a plate over its back, trim round the
    # plate's border (the sheet inks the whole plate).
    hand = Loft([
        dict(y=-0.03, rx=0.079, rf=0.072, rb=0.075, cx=-0.004, p=2.6),
        dict(y=-0.075, rx=0.077, rf=0.082, rb=0.085, cx=-0.004, p=2.8),
        dict(y=-0.118, rx=0.066, rf=0.082, rb=0.078, cx=-0.006, p=2.6),
    ]).mesh(p, "plate_dark", seg=16, sub=1)
    edge = patch(p, "plate", hand, 0.0, 2.0, deg(-84), deg(84), off=0.0, thick=0.012, nt=3, nth=8)
    # The sheet inks the whole back-of-hand plate, and the side reference reads that border as two
    # lines down the hand (z -0.21 and +0.17). Run the enamel round the plate's edge as a band on
    # the hand loft, just outside the plate, so it reads from the front and from the side.
    loop = [(0.0, th) for th in np.linspace(deg(-84), deg(84), 13)]
    loop += [(2.0, th) for th in np.linspace(deg(84), deg(-84), 5)[1:]]
    path(p, "trim", hand, loop, r=0.0065, off=0.019, n=26)
    # Knuckle domes and the four fingers: three plates each, curling from the knuckle to the tip.
    # They sit across the back of the hand (x) and spread a little along z so the hand reads from
    # the side too; the reference side view is only 0.2 m deep at the fingers.
    for k, (fx, tx, ty) in enumerate(FINGERS):
        zz = (k - 1.5) * 0.021
        pts = [mx((fx, KNUCKLE_Y, zz)),
               mx((fx * 0.94 + tx * 0.06, KNUCKLE_Y - 0.072, zz * 1.2)),
               mx((fx * 0.55 + tx * 0.45, KNUCKLE_Y - 0.140, zz * 1.35)),
               mx((tx, ty, zz * 1.4))]
        ellipsoid(p, "plate", pts[0] + mx((0.004, -0.01, 0.0)),
                  tuple((0.023, 0.026, 0.032)), seg=8, rings=4)
        for i in range(3):
            d = pts[i + 1] - pts[i]
            l = np.linalg.norm(d)
            R = np.column_stack([np.cross(d / l, [0, 0, 1]), -d / l, [0, 0, 1]])
            w = 0.025 - 0.0025 * i
            Loft([dict(y=0.005, rx=w, rf=w * 1.15, rb=w * 1.15, p=2.6),
                  dict(y=-l - 0.005, rx=w * 0.9, rf=w, rb=w, p=2.6)],
                 Frame(R, pts[i])).mesh(p, "plate", seg=6, sub=1)
    # Dark leather behind the fingers (the grip fills it in game; empty, it reads as a hole).
    Loft([dict(y=0.05, rx=0.05, rf=0.026, rb=0.026), dict(y=-0.14, rx=0.042, rf=0.026, rb=0.026)],
         Frame(rot_x(math.pi / 2), mx((-0.02, -0.175, 0.0)))).mesh(p, "plate_dark", seg=10, sub=1)
    # Thumb: two plates down the inner side from the cuff to h 0.86, the reference's inner lobe.
    th = [mx((-0.068, -0.02, 0.0)), mx((-0.112, -0.095, 0.0)), mx((-0.128, -0.175, 0.0))]
    for i in range(2):
        a0, a1 = th[i], th[i + 1]
        d = a1 - a0
        l = np.linalg.norm(d)
        up = np.cross(d / l, [1, 0, 0])
        up /= np.linalg.norm(up)
        R = np.column_stack([np.cross(-d / l, up), -d / l, up])
        Loft([dict(y=0.008, rx=0.03 - 0.002 * i, rf=0.036 - 0.002 * i, rb=0.027, p=2.5),
              dict(y=-l, rx=0.026 - 0.002 * i, rf=0.032 - 0.002 * i, rb=0.024, p=2.5)],
             Frame(R, a0)).mesh(p, "plate", seg=6, sub=1)
    return p


def build_thigh(s):
    """Cuisse, mostly under the tassets and fauld; a trim line down its inner front. Origin: the hip."""
    p = Piece(f"thigh_{'l' if s > 0 else 'r'}")
    L = Loft([
        dict(y=0.1, rx=0.06, rf=0.06, rb=0.06),
        dict(y=0.05, rx=0.15, rf=0.16, rb=0.15),
        dict(y=-0.08, rx=0.18, rf=0.175, rb=0.168),
        dict(y=-0.26, rx=0.172, rf=0.168, rb=0.16),
        dict(y=-0.36, rx=0.138, rf=0.148, rb=0.14),
        dict(y=-0.41, rx=0.11, rf=0.115, rb=0.11),
    ]).mesh(p, "plate", seg=16, sub=2)
    ypath(p, "trim", L, [(-0.33, FRONT + s * 0.3), (-0.18, FRONT + s * 0.3), (-0.04, FRONT + s * 0.3)], n=8)
    yring(p, "trim", L, -0.04, th0=FRONT - 1.1, th1=FRONT + 1.1, n=10)
    return p


def build_shin(s):
    """Knee cop (a round dome standing well forward of the greave, trim on its top and bottom
    edges, a centre ridge) over a dark padded knee, and a plain greave with a calf. Origin: the knee."""
    p = Piece(f"shin_{'l' if s > 0 else 'r'}")
    ellipsoid(p, "plate_dark", (0, 0.02, -0.01), (0.14, 0.11, 0.15), seg=12, rings=4)
    cx = s * 0.005
    cop = Loft([dict(y=-0.1, rx=0.13, rf=0.19, rb=0.0, cx=cx, cz=0.02), dict(y=-0.02, rx=0.175, rf=0.2, rb=0.0, cx=cx, cz=0.02),
                dict(y=0.08, rx=0.178, rf=0.203, rb=0.0, cx=cx, cz=0.02), dict(y=0.17, rx=0.125, rf=0.205, rb=0.0, cx=cx, cz=0.02),
                dict(y=0.215, rx=0.07, rf=0.12, rb=0.0, cx=cx, cz=0.02)])
    patch(p, "plate", cop, 0.0, 4.0, deg(-12), deg(192), off=-0.02, thick=0.02, nt=8, nth=10)
    ring(p, "trim", cop, 0.35, r=TRIM_R, off=0.004, th0=deg(-8), th1=deg(188), n=16)
    ring(p, "trim", cop, 2.9, r=TRIM_R, off=0.004, th0=deg(-8), th1=deg(188), n=14)
    path(p, "plate", cop, [(0.6, FRONT), (2.0, FRONT), (3.2, FRONT)], r=0.007, off=0.0, n=8, flat=None)
    L = Loft([
        dict(y=-0.05, rx=0.145, rf=0.15, rb=0.13),
        dict(y=-0.15, rx=0.148, rf=0.158, rb=0.195),
        dict(y=-0.3, rx=0.138, rf=0.155, rb=0.18),
        dict(y=-0.42, rx=0.132, rf=0.15, rb=0.144),
        dict(y=-0.48, rx=0.148, rf=0.16, rb=0.15),
    ]).mesh(p, "plate", seg=20, sub=2)
    return p


def build_boot(s):
    """Sabaton: an ankle lame with a rivet over a dark gap, a raised instep, overlapping toe lames
    and a domed toe cap, a heel cup; toes turned out a little. Origin: the ankle; the sole is 0.07 below."""
    p = Piece(f"boot_{'l' if s > 0 else 'r'}")
    cuff = Loft([
        dict(y=0.14, rx=0.13, rf=0.155, rb=0.15),
        dict(y=0.07, rx=0.142, rf=0.165, rb=0.158),
        dict(y=0.02, rx=0.148, rf=0.17, rb=0.162),
    ]).mesh(p, "plate", seg=18, sub=1)
    Loft([dict(y=0.03, rx=0.13, rf=0.15, rb=0.15), dict(y=-0.04, rx=0.13, rf=0.15, rb=0.15)]
         ).mesh(p, "plate_dark", seg=14, sub=1)
    rivet(p, (s * 0.15, 0.08, 0.0), (s, 0, 0), 0.012)
    # Foot: sections run heel -> toe along +z (loft y mapped to game z; loft z up).
    R = np.array([[1, 0, 0], [0, 0, 1], [0, 1, 0]], float)
    to_foot = Frame(rot_y(s * deg(14)) @ R, (s * 0.02, -0.02, 0))
    foot = Loft([
        dict(y=-0.16, rx=0.12, rf=0.06, rb=0.05, p=2.4),
        dict(y=-0.09, rx=0.155, rf=0.1, rb=0.05, p=2.6),
        dict(y=0.04, rx=0.17, rf=0.13, rb=0.05, p=2.8),
        dict(y=0.15, rx=0.175, rf=0.105, rb=0.05, p=2.8),
        dict(y=0.25, rx=0.165, rf=0.08, rb=0.05, p=2.6),
        dict(y=0.32, rx=0.12, rf=0.06, rb=0.045, p=2.3),
        dict(y=0.345, rx=0.05, rf=0.03, rb=0.03),
    ], to_foot).mesh(p, "plate", seg=16, sub=2)
    # Two instep lames over the top of the foot, each stepping onto the next, riveted at the ends.
    for t0, t1 in ((1.9, 2.55), (2.5, 3.15)):
        patch(p, "plate", foot, t0, t1, deg(-4), deg(184), off=0.0, thick=0.012, nt=2, nth=8)
        for th in (deg(4), deg(176)):
            tt = (t0 + t1) / 2
            rivet(p, foot.surf(tt, th, 0.012), foot.normal(tt, th), 0.009)
    path(p, "plate_dark", foot, [(3.6, deg(-6)), (3.6, deg(90)), (3.6, deg(186))], r=0.006, n=8, flat=None)
    # Dark strap over the heel, under the ankle lame.
    ring(p, "plate_dark", foot, 0.45, r=0.012, th0=deg(-20), th1=deg(200), n=12, flat=None)
    # Heel cup.
    ellipsoid(p, "plate", to_foot((0.0, -0.13, 0.02)), (0.11, 0.06, 0.07), seg=10, rings=4)
    return p


# --- Assemble -----------------------------------------------------------------------

reset_scene()
def lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


MATS.update({   # the game's colours (humanoid.ts buildModelledPlate), linear
    "plate": material("plate", lin("#8d959d"), metallic=0.55, roughness=0.42),
    "plate_dark": material("plate_dark", lin("#2b2724"), metallic=0.05, roughness=0.85),
    "trim": material("trim", lin("#323b6e"), metallic=0.25, roughness=0.38),
    "glow": material("glow", lin("#a9ccff"), roughness=0.3, emission=lin("#5aa2ff"), strength=2.2),
})

pieces = []
helm, crest = build_helm(enemy_crest=True)
pieces += [helm, crest, build_gorget(), build_breastplate(), build_abdomen(), build_belt(), *build_fauld()]
for s in (1, -1):
    pieces += [build_pauldron(s), build_upperarm(s), build_forearm(s), build_gauntlet(s),
               build_tasset(s), build_thigh(s), build_shin(s), build_boot(s)]

objs = {pc.name: pc.build() for pc in pieces}
tris = 0
for name, o in objs.items():
    n = sum(len(pl.vertices) - 2 for pl in o.data.polygons)
    tris += n
    print(f"  {name:13s} {n:6d} tris")
print(f"total {tris} triangles in {len(objs)} pieces")

export_glb(ROOT / "public/models/shardplate.glb", list(objs.values()))

if "--no-render" in sys.argv:
    sys.exit(0)

# --- Preview renders (the rest pose; compare_reference.py does the reference views) ---
bpy.data.objects.remove(objs.pop("helm_crest"))


def place(name, pos, roll=0.0):
    o = objs[name]
    x, y, z = pos
    o.location = (x, -z, y)
    o.rotation_euler = (0, -roll, 0)


W = WAIST_Y
place("helm", (0, W + HELM_Y, 0))
for n in ("gorget", "breastplate", "abdomen", "belt"):
    place(n, (0, W, 0))
place("fauld_front", (0, FAULD_Y, FAULD_FRONT_Z))
place("fauld_back", (0, FAULD_Y, FAULD_BACK_Z))
ABDUCT = deg(22)
for s, side in ((1, "l"), (-1, "r")):
    sh = np.array([s * SHOULDER[0], W + SHOULDER[1], 0])
    place(f"pauldron_{side}", sh)
    place(f"upperarm_{side}", sh, s * ABDUCT)
    elbow = sh + UPPER_ARM * np.array([s * math.sin(ABDUCT), -math.cos(ABDUCT), 0])
    place(f"forearm_{side}", elbow, s * ABDUCT * 0.5)
    wrist = elbow + LOWER_ARM * np.array([s * math.sin(ABDUCT * 0.5), -math.cos(ABDUCT * 0.5), 0])
    place(f"gauntlet_{side}", wrist, s * ABDUCT * 0.5)
    hip = np.array([s * LEG_X, HIP_Y, 0])
    place(f"tasset_{side}", (s * TASSET_X, TASSET_Y, 0))
    place(f"thigh_{side}", hip)
    place(f"shin_{side}", hip - [0, THIGH, 0])
    place(f"boot_{side}", hip - [0, THIGH + SHIN, 0])

paths = render_views(ROOT / "art/renders/shardplate/shardplate", [
    ("three-quarter", (2.9, -4.0, 2.0), (0, 0, 1.2), None),
    ("closeup", (1.2, -2.2, 2.0), (0, 0, 1.75), None),
], size=(900, 1000), samples=40)
for pth in paths:
    print("render", pth.relative_to(ROOT))
