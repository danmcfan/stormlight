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
    disc(p, "plate", centre, nrm, r, r * 0.9, seg=6)


def build_helm(enemy_crest=False):
    """Great helm (helm sheet + plate-helm-34): round, full crown with a flat rib front to back
    edged in trim; the trim splits at the brow and frames the faceplate down to the cheeks. The
    faceplate stands proud of the shell, faceted with a centre ridge and a V chin; the curved eye
    slit (dark recess, a thin glowing line inside) sits between its top edge and the brow.
    Origin: helm joint (world 2.0 m)."""
    p = Piece("helm")
    cz = 0.08
    L = Loft([
        dict(y=-0.10, rx=0.148, rf=0.15, rb=0.145, cz=cz),
        dict(y=0.02, rx=0.152, rf=0.165, rb=0.16, cz=cz, p=2.2),
        dict(y=0.10, rx=0.15, rf=0.172, rb=0.165, cz=cz, p=2.3),
        dict(y=0.20, rx=0.15, rf=0.188, rb=0.162, cz=cz, p=2.3),
        dict(y=0.28, rx=0.142, rf=0.178, rb=0.15, cz=cz, p=2.15),
        dict(y=0.335, rx=0.118, rf=0.142, rb=0.118, cz=cz),
        dict(y=0.37, rx=0.078, rf=0.092, rb=0.078, cz=cz),
        dict(y=0.385, rx=0.025, rf=0.025, rb=0.025, cz=cz),
    ]).mesh(p, "plate", seg=26, sub=2)
    # Faceplate: front-only loft, a forward wedge at the chin, faceted (p < 2).
    face = Loft([
        dict(y=-0.04, rx=0.13, rf=0.168, rb=0.0, p=1.5, cz=cz),
        dict(y=0.06, rx=0.142, rf=0.18, rb=0.0, p=1.55, cz=cz),
        dict(y=0.15, rx=0.148, rf=0.186, rb=0.0, p=1.75, cz=cz),
        dict(y=0.23, rx=0.142, rf=0.176, rb=0.0, p=2.0, cz=cz),
    ])
    TH = deg(64)
    dip = lambda v: 1 - (2 * v - 1) ** 2          # noqa: E731  1 at the centre, 0 at the ends
    vee = lambda v: abs(2 * v - 1)                 # noqa: E731
    top = lambda v: t_at(face, 0.19 - 0.016 * dip(v))             # noqa: E731  slit's lower edge
    chin = lambda v: t_at(face, 0.02 + 0.075 * vee(v))            # noqa: E731  V chin
    patch(p, "plate", face, chin, top, FRONT - TH, FRONT + TH, off=0.0, thick=0.014, nt=7, nth=12)
    # Eye slit: a dark recess on the shell between the faceplate and the brow, narrowing at the ends,
    # with a thin glowing line deep inside.
    lo = lambda v: t_at(L, 0.188 - 0.016 * dip(v))                # noqa: E731
    hi = lambda v: t_at(L, 0.188 - 0.016 * dip(v) + 0.036 * dip(v) ** 0.6 + 0.002)  # noqa: E731
    patch(p, "plate_dark", L, lo, hi, FRONT - deg(46), FRONT + deg(46), off=0.004, thick=0.003, nt=2, nth=12)
    glo = lambda v: t_at(L, 0.199 - 0.016 * dip(v))               # noqa: E731
    ghi = lambda v: t_at(L, 0.199 - 0.016 * dip(v) + 0.006 * dip(v) ** 0.6 + 0.001)  # noqa: E731
    patch(p, "glow", L, glo, ghi, FRONT - deg(32), FRONT + deg(32), off=0.0075, thick=0.001, nt=1, nth=10)
    # Centre ridge down the faceplate, from under the slit to the chin point.
    path(p, "plate", face, [(t_at(face, 0.165), FRONT), (t_at(face, 0.09), FRONT), (t_at(face, 0.025), FRONT)],
         r=0.008, off=0.012, n=6, flat=None)
    # Crown rib: a flat raised band from the nape over the top to the brow, trim along both edges
    # that splits at the brow and frames the faceplate down to the chin (helm sheet, measured).
    top_t = L.n - 1.0
    rib = [(t_at(L, y), BACK) for y in (0.0, 0.12, 0.24, 0.32, 0.36)] + [(top_t, FRONT + TAU)] + \
          [(t_at(L, y), FRONT + TAU) for y in (0.36, 0.32, 0.29)]
    rp, rn = sample_path(L, rib, 22, 0.0)
    tube(p, "plate", [q + nv * 0.004 for q, nv in zip(rp, rn)], r=0.02, nrm=rn, flat=0.3)
    back_n = 15     # rib samples up to the crown top
    oy = HELM_O[1]
    for sgn in (1, -1):
        edge = offset_line(rp[:back_n], rn[:back_n], -sgn * 0.025)
        en = rn[:back_n]
        front = [(0.024, 2.365), (0.027, 2.325), (0.034, 2.305), (0.047, 2.285), (0.067, 2.265), (0.094, 2.245)]
        side = [(0.12, 2.236), (0.06, 2.225), (0.04, 2.205), (0.04, 2.185), (0.05, 2.165), (0.09, 2.15),
                (0.145, 2.13)]
        chin = [(0.09, 2.105), (0.078, 2.085), (0.07, 2.065), (0.066, 2.045)]
        tths = proj(L, [(sgn * x, y) for x, y in front], "front", HELM_O) + \
            proj(L, side, "left" if sgn > 0 else "right", HELM_O) + \
            proj(L, [(sgn * x, y) for x, y in chin], "front", HELM_O)
        fp, fn = sample_path(L, tths, 40, 0.003)
        tube(p, "trim", [q + nv * 0.003 for q, nv in zip(edge, en)] + fp, r=0.0075, nrm=list(en) + fn, flat=0.45)
        # Rivets: the visor pivot and three along the cheek plate's lower edge (side view).
        for z, y, r in ((0.01, 2.245, 0.012), (-0.01, 2.085, 0.009), (-0.06, 2.085, 0.009), (-0.11, 2.09, 0.009)):
            t = t_at(L, y - oy)
            th = th_for(L, t, z, "left" if sgn > 0 else "right")
            rivet(p, L.surf(t, th, 0.002), L.normal(t, th), r)
    if enemy_crest:
        c = Piece("helm_crest")
        for sgn in (1, -1):
            tube(c, "plate", [L.surf(t_at(L, y), th, 0.0) + np.array([0, dy, 0]) for y, th, dy in (
                (0.28, FRONT + sgn * 0.5, 0.0), (0.35, sgn * 0.9 + (0 if sgn > 0 else math.pi), 0.03),
                (0.3, BACK + sgn * 0.6, 0.06), (0.17, BACK + sgn * 0.45, 0.10))], r=0.022)
        return p, c
    return p, None


def build_gorget():
    """High flared collar, open in a V at the front over the dark padded neck. Origin: the waist."""
    p = Piece("gorget")
    L = Loft([
        dict(y=0.70, rx=0.34, rf=0.32, rb=0.28, cz=0.03),
        dict(y=0.86, rx=0.30, rf=0.285, rb=0.26, cz=0.04),
        dict(y=0.95, rx=0.25, rf=0.255, rb=0.235, cz=0.05),
        dict(y=1.02, rx=0.222, rf=0.235, rb=0.218, cz=0.05),
        dict(y=1.06, rx=0.226, rf=0.238, rb=0.222, cz=0.05),
        dict(y=1.085, rx=0.24, rf=0.25, rb=0.235, cz=0.05),
    ])
    t_rim = t_at(L, 1.085)
    t_v = t_at(L, 0.85)

    def top(th):
        d = abs(((th - FRONT + math.pi) % TAU) - math.pi)
        f = 0.5 * (1 + math.cos(math.pi * d / 0.78)) if d < 0.78 else 0.0
        return t_rim + (t_v - t_rim) * f ** 0.6
    rim = shell(p, L, top, 0.0, thick=0.018, nth=40, nu=5)
    tube(p, "trim", rim, r=TRIM_R, closed=True)
    # Dark padded neck inside the collar, under the helm (shows in the V).
    Loft([dict(y=0.72, rx=0.16, rf=0.17, rb=0.15, cz=0.06), dict(y=0.98, rx=0.14, rf=0.15, rb=0.13, cz=0.07)]
         ).mesh(p, "plate_dark", seg=14, sub=1)
    return p


def build_breastplate():
    """Barrel chest: hex sapphire at the sternum, trim V from the collar to it, an arc under the
    chest, two lines each side down the abdomen, a shallow V lower edge; back: the yoke arc and
    lines down to the belt (front/back references, world metres). Origin: the waist."""
    p = Piece("breastplate")
    L = Loft([
        dict(y=0.16, rx=0.3, rf=0.27, rb=0.25, cz=0.03, p=2.3),
        dict(y=0.32, rx=0.33, rf=0.31, rb=0.27, cz=0.03, p=2.4),
        dict(y=0.48, rx=0.37, rf=0.35, rb=0.29, cz=0.03, p=2.5),
        dict(y=0.62, rx=0.385, rf=0.36, rb=0.30, cz=0.03, p=2.5),
        dict(y=0.74, rx=0.375, rf=0.335, rb=0.29, cz=0.03, p=2.4),
        dict(y=0.84, rx=0.33, rf=0.285, rb=0.26, cz=0.03),
        dict(y=0.90, rx=0.22, rf=0.2, rb=0.2, cz=0.04),
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
    ]).mesh(p, "plate_dark", seg=28, sub=2)
    return p


def build_belt():
    """Hip belt on the body (doesn't twist with the torso). Origin: the waist."""
    p = Piece("belt")
    L = Loft([
        dict(y=0.29, rx=0.355, rf=0.32, rb=0.285, cz=0.03, p=2.5),
        dict(y=0.23, rx=0.385, rf=0.345, rb=0.3, cz=0.03, p=2.5),
        dict(y=0.15, rx=0.395, rf=0.35, rb=0.3, cz=0.03, p=2.5),
        dict(y=0.06, rx=0.37, rf=0.32, rb=0.28, cz=0.03, p=2.5),
        dict(y=0.0, rx=0.35, rf=0.3, rb=0.27, cz=0.03, p=2.5),
    ]).mesh(p, "plate", seg=32, sub=2)
    yring(p, "trim", L, 0.27)
    yring(p, "trim", L, 0.155)
    return p


def leaf_rows(p, rows, back=False):
    """Overlapping rows of long pointed leaves hanging from the origin, wrapping round the body."""
    sgn = -1 if back else 1
    for n, w, h, y, z, tilt in rows:
        for k in range(n):
            x = (k - (n - 1) / 2) * w * 0.98
            zz = z - 0.9 * x * x
            fr = Frame(rot_y(0 if not back else math.pi) @ rot_y(-x * 1.6) @ rot_x(-tilt), (x, y, sgn * zz))
            leaf(p, "plate", w, h, 0.011, fr, nu=2, nv=3, bulge=0.01)


def build_fauld():
    """Fauld: rows of long pointed leaves with a centre ridge, each row behind and below the one
    above, the centre leaf to 0.58 m (front reference); the back one to 0.56 m."""
    front = Piece("fauld_front")
    # (count, width, height, top y, z, forward tilt) from the top row down; origin at FAULD_Y (1.22 m).
    leaf_rows(front, [(5, 0.084, 0.215, -0.02, 0.0, 0.1), (4, 0.084, 0.225, -0.13, -0.008, 0.12),
                      (3, 0.086, 0.235, -0.24, -0.016, 0.14), (2, 0.086, 0.225, -0.35, -0.024, 0.16),
                      (1, 0.09, 0.26, -0.40, -0.03, 0.17)])
    back = Piece("fauld_back")
    leaf_rows(back, [(5, 0.084, 0.215, 0.02, 0.0, 0.12), (4, 0.084, 0.225, -0.1, -0.008, 0.14),
                     (3, 0.086, 0.235, -0.22, -0.016, 0.16), (2, 0.086, 0.225, -0.33, -0.024, 0.18),
                     (1, 0.09, 0.26, -0.40, -0.03, 0.19)], back=True)
    return front, back


def build_tasset(s):
    """Shield-shaped plate over the outside of the hip, splaying out from the belt: narrow under the
    belt with a pointed upper front corner, widest near the bottom, rounded lower corners, a trim
    line set in from its edge. Origin: its hinge on the belt."""
    p = Piece(f"tasset_{'l' if s > 0 else 'r'}")
    o = np.array([s * TASSET_X, TASSET_Y, 0.0])
    L = Loft([
        dict(y=1.27, rx=0.4, rf=0.27, rb=0.26, cz=0.02, p=2.6),
        dict(y=1.08, rx=0.46, rf=0.285, rb=0.275, cz=0.02, p=2.6),
        dict(y=0.87, rx=0.515, rf=0.3, rb=0.29, cz=0.02, p=2.6),
    ], Frame(None, -o))
    c = 0.0 if s > 0 else math.pi          # the outside of the hip
    front = lambda u: deg(36 + 30 * min(1, u / 0.7) - 14 * max(0, (u - 0.82) / 0.18) ** 2)   # noqa: E731
    rear = lambda u: deg(-40 - 20 * min(1, u / 0.7) + 12 * max(0, (u - 0.82) / 0.18) ** 2)   # noqa: E731
    th0 = (lambda u: c + rear(u)) if s > 0 else (lambda u: c - front(u))
    th1 = (lambda u: c + front(u)) if s > 0 else (lambda u: c - rear(u))
    patch(p, "plate", L, 0.0, 2.0, th0, th1, off=0.0, thick=0.016, nt=8, nth=12)
    # Inset trim: round the sides and bottom, a few cm in from the edge.
    loop = []
    for k in range(9):          # down the rear edge
        u = 0.08 + 0.84 * k / 8
        loop.append((u * 2.0, th0(u) + (th1(u) - th0(u)) * 0.06))
    for k in range(1, 10):      # along the bottom
        v = 0.06 + 0.88 * k / 9
        u = 0.92
        loop.append((u * 2.0, th0(u) + (th1(u) - th0(u)) * v))
    for k in range(1, 9):       # up the front edge
        u = 0.92 - 0.84 * k / 8
        loop.append((u * 2.0, th0(u) + (th1(u) - th0(u)) * 0.94))
    path(p, "trim", L, loop, r=TRIM_R * 0.85, off=0.016, n=40)
    return p


def build_pauldron(s):
    """Pauldron (front/side/back references, plate-pauldron sheet): an upright dome whose outer face
    drops nearly straight over the arm, a trimmed rim, two lames below it wrapping the outside of the
    arm, an arched flange (the "horn" seen from the front) along its inner edge, and round bosses
    where it meets the chest and back. Built for the left side and mirrored. Origin: the shoulder."""
    p = Piece(f"pauldron_{'l' if s > 0 else 'r'}")
    M = Frame(np.diag([s, 1.0, 1.0]))
    mx = lambda v: np.array([s * v[0], v[1], v[2]])   # noqa: E731
    cx, cz = 0.095, -0.07
    dome = Loft([
        dict(y=0.055, rx=0.212, rf=0.262, rb=0.27, cx=cx, cz=cz, p=2.4),
        dict(y=0.095, rx=0.222, rf=0.272, rb=0.28, cx=cx, cz=cz, p=2.4),
        dict(y=0.18, rx=0.214, rf=0.265, rb=0.272, cx=cx, cz=cz, p=2.35),
        dict(y=0.26, rx=0.182, rf=0.232, rb=0.242, cx=cx, cz=cz, p=2.2),
        dict(y=0.32, rx=0.125, rf=0.165, rb=0.172, cx=cx, cz=cz),
        dict(y=0.352, rx=0.06, rf=0.08, rb=0.085, cx=cx, cz=cz),
        dict(y=0.362, rx=0.01, rf=0.01, rb=0.01, cx=cx, cz=cz),
    ], M).mesh(p, "plate", seg=26, sub=2)
    ring(p, "trim", dome, t_at(dome, 0.085), r=TRIM_R)
    # Lames: partial bands round the outside of the arm, each tucked under the one above,
    # lower edge flared and trimmed.
    for y0, y1, k in ((-0.005, 0.07, 0.0), (-0.085, -0.01, 0.012)):
        lame = Loft([dict(y=y1, rx=0.2 - k, rf=0.245 - k, rb=0.25 - k, cx=cx + 0.005, cz=cz, p=2.3),
                     dict(y=y0, rx=0.214 - k, rf=0.258 - k, rb=0.262 - k, cx=cx + 0.005, cz=cz, p=2.3)], M)
        patch(p, "plate", lame, 0.0, 1.0, deg(-112), deg(112), off=0.0, thick=0.014, nt=2, nth=16)
        ring(p, "trim", lame, 0.92, r=TRIM_R * 0.9, off=0.014, th0=deg(-108), th1=deg(108), n=18)
    # The arched flange along the inner edge: outline in (z, y), bent to follow the dome's edge,
    # leaning a little toward the head. Its top arc carries a trim line on the outer face.
    arc = [(0.165, 0.33), (0.14, 0.42), (0.08, 0.49), (0.0, 0.525), (-0.1, 0.535), (-0.2, 0.51),
           (-0.28, 0.44), (-0.33, 0.35), (-0.345, 0.26)]
    base = [(-0.3, 0.2), (-0.15, 0.24), (0.0, 0.25), (0.13, 0.27)]
    outline = arc + base
    lean = rot_z(s * deg(4))

    def fl(z, y, x=0.0):
        return lean @ mx((-0.04 + x + 1.2 * (z - cz) ** 2, y, z))
    thick = 0.045
    n = len(outline)
    verts = [fl(z, y, thick / 2) for z, y in outline] + [fl(z, y, -thick / 2) for z, y in outline]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    p.add(verts, faces, "plate")
    inset = [(z * 0.93 + cz * 0.07, y - 0.035) for z, y in arc[:-1]]
    pts = [fl(z, y, thick / 2 + 0.002) for z, y in inset]
    tube(p, "trim", pts, r=TRIM_R * 0.85, nrm=[lean @ mx((1, 0, 0))] * len(pts), flat=0.45)
    # Round bosses where the pauldron meets the chest (front) and the back plate.
    for z, nz in ((0.205, 1.0), (-0.335, -1.0)):
        c = mx((-0.075, 0.1, z))
        nrm = mx((-0.35, 0.05, nz))
        disc(p, "plate", c, nrm, 0.082, 0.045, seg=18)
        disc(p, "plate", c + 0.022 * nrm / np.linalg.norm(nrm), nrm, 0.058, 0.03, seg=18)
    return p


def build_upperarm(s):
    p = Piece(f"upperarm_{'l' if s > 0 else 'r'}")
    Loft([
        dict(y=0.07, rx=0.04, rf=0.04, rb=0.04),
        dict(y=0.03, rx=0.115, rf=0.115, rb=0.115),
        dict(y=-0.1, rx=0.122, rf=0.122, rb=0.122),
        dict(y=-0.36, rx=0.11, rf=0.11, rb=0.11),
    ]).mesh(p, "plate_dark", seg=16, sub=1)
    # Rerebrace: a plate cylinder over the lower half, trimmed at its top edge.
    L = Loft([
        dict(y=-0.13, rx=0.133, rf=0.135, rb=0.135),
        dict(y=-0.26, rx=0.13, rf=0.132, rb=0.132),
        dict(y=-0.37, rx=0.12, rf=0.12, rb=0.12),
    ]).mesh(p, "plate", seg=20, sub=2)
    ring(p, "trim", L, 0.1, r=TRIM_R * 0.85)
    return p


def build_forearm(s):
    """Couter (round elbow cop with a disc on the outside) + a heavy vambrace flared toward the
    elbow, trim bands at both ends and the stepped line down the outside. Origin: the elbow."""
    p = Piece(f"forearm_{'l' if s > 0 else 'r'}")
    # The elbow cop rides high: the references draw the elbow well up under the lames.
    ellipsoid(p, "plate", (s * 0.012, 0.05, -0.01), (0.145, 0.13, 0.14), seg=16, rings=6)
    disc(p, "plate", (s * 0.135, 0.09, -0.03), (s, 0.15, -0.3), 0.07, 0.04, seg=16)
    disc(p, "plate", (s * 0.155, 0.094, -0.036), (s, 0.15, -0.3), 0.045, 0.03, seg=16)
    L = Loft([
        dict(y=0.03, rx=0.165, rf=0.15, rb=0.15),
        dict(y=-0.05, rx=0.18, rf=0.158, rb=0.158),
        dict(y=-0.2, rx=0.17, rf=0.15, rb=0.15),
        dict(y=-0.31, rx=0.158, rf=0.142, rb=0.142),
        dict(y=-0.345, rx=0.15, rf=0.136, rb=0.136),
    ]).mesh(p, "plate", seg=22, sub=2)
    ring(p, "trim", L, 0.55, r=TRIM_R)
    ring(p, "trim", L, 3.45, r=TRIM_R)
    outer = 0.0 if s > 0 else math.pi   # loft angle facing away from the body
    path(p, "trim", L, [(0.75, outer + s * 0.32), (1.5, outer + s * 0.32), (1.8, outer - s * 0.05),
                        (3.25, outer - s * 0.05)], r=TRIM_R * 0.9, n=14)
    return p


HAND_K = 1.35      # fist scale (the references draw huge gauntlets)
GRIP_Y = -0.17 * HAND_K   # the grip passes through the fist this far below the wrist (humanoid.ts PLATE_HAND)


def build_gauntlet(s):
    """Heavy gauntlet (plate-gauntlet sheet): a short flared cuff, a back-of-hand plate with a
    trimmed lower edge, a row of knuckle domes, four fingers of three plates curled round the
    grip, a thumb of two plates over them, dark leather at the palm. The back of the hand faces
    out (+x on the left hand), the thumb forward. Origin: the wrist; the grip runs through the
    fist along z, GRIP_Y below the wrist."""
    p = Piece(f"gauntlet_{'l' if s > 0 else 'r'}")
    M = Frame(np.diag([s, 1.0, 1.0]) * HAND_K)
    mx = lambda v: np.array([s * v[0], v[1], v[2]]) * HAND_K   # noqa: E731
    cuff = Loft([
        dict(y=0.05, rx=0.13, rf=0.122, rb=0.122),
        dict(y=0.0, rx=0.128, rf=0.118, rb=0.118),
        dict(y=-0.045, rx=0.1, rf=0.105, rb=0.1),
    ], M).mesh(p, "plate", seg=22, sub=1)
    ring(p, "trim", cuff, 0.15, r=TRIM_R * 0.85)
    # Hand: dark leather body, a plate over its back.
    hand = Loft([
        dict(y=-0.02, rx=0.06, rf=0.092, rb=0.085, cx=0.0, p=2.6),
        dict(y=-0.08, rx=0.062, rf=0.1, rb=0.09, cx=0.005, p=2.8),
        dict(y=-0.14, rx=0.055, rf=0.098, rb=0.088, cx=0.01, p=2.6),
    ], M).mesh(p, "plate_dark", seg=16, sub=1)
    edge = patch(p, "plate", hand, 0.0, 2.0, deg(-75), deg(75), off=0.0, thick=0.014, nt=3, nth=8)
    tube(p, "trim", [e for e in edge if e[1] < -0.12][:9], r=0.006)
    # Knuckle domes and fingers: each finger three plates wrapping the grip axis (along z).
    gx, gy = -0.005, GRIP_Y / HAND_K
    zs = (-0.066, -0.022, 0.022, 0.066)
    for k, z in enumerate(zs):
        ellipsoid(p, "plate", mx((0.05, -0.145, z)), tuple(HAND_K * np.array((0.024, 0.022, 0.021))), seg=8, rings=4)
        rad = 0.056 - 0.003 * abs(k - 1.5)
        angs = [deg(a) for a in (26, -28, -88, -140)]     # down round the grip from the knuckles
        pts = [mx((gx + rad * math.cos(a), gy + rad * math.sin(a), z)) for a in angs]
        for i in range(3):
            a0, a1 = pts[i], pts[i + 1]
            d = a1 - a0
            ln = np.linalg.norm(d)
            R = np.column_stack([np.cross(d / ln, [0, 0, 1]), -d / ln, [0, 0, 1]])
            w = (0.019 - 0.002 * i) * HAND_K
            Loft([dict(y=0.004, rx=w, rf=w * 1.05, rb=w * 1.05, p=2.6),
                  dict(y=-ln - 0.004, rx=w * 0.92, rf=w, rb=w, p=2.6)],
                 Frame(R, a0)).mesh(p, "plate", seg=8, sub=1)
    # Thumb: from the inside front of the hand, across the front of the fingers.
    th = [mx((-0.035, -0.05, 0.075)), mx((-0.06, -0.13, 0.098)), mx((-0.035, -0.2, 0.09))]
    for i in range(2):
        a0, a1 = th[i], th[i + 1]
        d = a1 - a0
        ln = np.linalg.norm(d)
        up = np.cross(d / ln, [1, 0, 0])
        up /= np.linalg.norm(up)
        R = np.column_stack([np.cross(-d / ln, up), -d / ln, up])
        k = HAND_K
        Loft([dict(y=0.006, rx=(0.026 - 0.004 * i) * k, rf=0.024 * k, rb=0.024 * k, p=2.5),
              dict(y=-ln, rx=(0.022 - 0.004 * i) * k, rf=0.02 * k, rb=0.02 * k, p=2.5)], Frame(R, a0)).mesh(p, "plate", seg=8, sub=1)
    return p


def build_thigh(s):
    """Cuisse, mostly under the tassets and fauld; a trim line down its inner front. Origin: the hip."""
    p = Piece(f"thigh_{'l' if s > 0 else 'r'}")
    L = Loft([
        dict(y=0.1, rx=0.06, rf=0.06, rb=0.06),
        dict(y=0.05, rx=0.15, rf=0.16, rb=0.15),
        dict(y=-0.08, rx=0.165, rf=0.172, rb=0.165),
        dict(y=-0.26, rx=0.155, rf=0.165, rb=0.158),
        dict(y=-0.36, rx=0.138, rf=0.148, rb=0.14),
        dict(y=-0.41, rx=0.11, rf=0.115, rb=0.11),
    ]).mesh(p, "plate", seg=18, sub=2)
    ypath(p, "trim", L, [(-0.34, FRONT + s * 0.5), (-0.2, FRONT + s * 0.52), (-0.02, FRONT + s * 0.55)], n=10)
    return p


def build_shin(s):
    """Knee cop (a round dome standing well forward of the greave, trim on its top and bottom
    edges, a centre ridge) over a dark padded knee, and a plain greave with a calf. Origin: the knee."""
    p = Piece(f"shin_{'l' if s > 0 else 'r'}")
    ellipsoid(p, "plate_dark", (0, 0.02, -0.01), (0.14, 0.11, 0.15), seg=12, rings=4)
    cx = s * 0.005
    cop = Loft([dict(y=-0.1, rx=0.12, rf=0.19, rb=0.0, cx=cx, cz=0.02), dict(y=-0.02, rx=0.155, rf=0.245, rb=0.0, cx=cx, cz=0.02),
                dict(y=0.08, rx=0.16, rf=0.25, rb=0.0, cx=cx, cz=0.02), dict(y=0.17, rx=0.125, rf=0.205, rb=0.0, cx=cx, cz=0.02),
                dict(y=0.215, rx=0.07, rf=0.12, rb=0.0, cx=cx, cz=0.02)])
    patch(p, "plate", cop, 0.0, 4.0, deg(-12), deg(192), off=-0.02, thick=0.02, nt=10, nth=12)
    ring(p, "trim", cop, 0.35, r=TRIM_R, th0=deg(-8), th1=deg(188), n=16)
    ring(p, "trim", cop, 3.35, r=TRIM_R, th0=deg(-8), th1=deg(188), n=14)
    path(p, "plate", cop, [(0.6, FRONT), (2.0, FRONT), (3.2, FRONT)], r=0.007, off=0.0, n=8, flat=None)
    disc(p, "plate", (s * 0.165, 0.05, 0.0), (s, 0, 0.25), 0.06, 0.03, seg=12)
    L = Loft([
        dict(y=-0.05, rx=0.13, rf=0.15, rb=0.13, cx=s * 0.0),
        dict(y=-0.15, rx=0.132, rf=0.158, rb=0.17, cx=s * 0.0),
        dict(y=-0.3, rx=0.126, rf=0.155, rb=0.165, cx=s * 0.0),
        dict(y=-0.42, rx=0.118, rf=0.148, rb=0.142, cx=s * 0.0),
        dict(y=-0.48, rx=0.12, rf=0.15, rb=0.14, cx=s * 0.0),
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
    for t in (2.5, 3.2):
        path(p, "plate_dark", foot, [(t, deg(-6)), (t, deg(90)), (t, deg(186))], r=0.007, n=8, flat=None)
    ring(p, "plate_dark", foot, 1.2, r=0.01, th0=deg(-10), th1=deg(190), n=16, flat=None)
    # Heel cup.
    ellipsoid(p, "plate", to_foot((0.0, -0.13, 0.02)), (0.11, 0.06, 0.07), seg=10, rings=4)
    return p


# --- Assemble -----------------------------------------------------------------------

reset_scene()
def lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


MATS.update({   # the game's colours (humanoid.ts buildModelledPlate), linear
    "plate": material("plate", lin("#8a939c"), metallic=0.55, roughness=0.42),
    "plate_dark": material("plate_dark", lin("#2b2724"), metallic=0.05, roughness=0.85),
    "trim": material("trim", lin("#36438c"), metallic=0.25, roughness=0.38),
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
