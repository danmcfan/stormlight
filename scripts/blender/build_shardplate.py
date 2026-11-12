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
from trellis_part import Part, similarity  # noqa: E402

# --- The pieces ---------------------------------------------------------------------
# Sizes in metres, measured off the front reference scaled to the game height
# (helm top 2.37 m): the Plate is 1.7 m across the arms, 1.5 m across the
# pauldrons, its legs 0.34 m thick.

def build_helm(enemy_crest=False):
    """Rounded great helm with a faceplate, one eye slit and a centre ridge. Origin: helm joint."""
    p = Piece("helm")
    cz = 0.09   # the head sits forward of the spine line, like the side reference
    L = Loft([
        dict(y=-0.09, rx=0.125, rf=0.15, rb=0.15, cz=cz),
        dict(y=0.04, rx=0.142, rf=0.17, rb=0.165, cz=cz, p=2.2),
        dict(y=0.17, rx=0.15, rf=0.178, rb=0.172, cz=cz, p=2.2),
        dict(y=0.26, rx=0.138, rf=0.162, rb=0.165, cz=cz),
        dict(y=0.325, rx=0.11, rf=0.125, rb=0.135, cz=cz),
        dict(y=0.37, rx=0.06, rf=0.07, rb=0.075, cz=cz),
        dict(y=0.385, rx=0.01, rf=0.01, rb=0.01, cz=cz),
    ]).mesh(p, "plate", seg=24, sub=3)
    # Faceplate: a raised, slightly pointed visor over the front.
    face = Loft([
        dict(y=-0.09, rx=0.128, rf=0.17, rb=0.0, p=1.5, cz=cz),
        dict(y=0.06, rx=0.145, rf=0.2, rb=0.0, p=1.45, cz=cz),
        dict(y=0.19, rx=0.152, rf=0.215, rb=0.0, p=1.6, cz=cz),
        dict(y=0.29, rx=0.12, rf=0.14, rb=0.0, p=2.0, cz=cz),
    ])
    patch(p, "plate", face, 0.0, 3.0, deg(18), deg(162), off=-0.006, thick=0.012, nt=8, nth=10)
    # Eye slit: a dark recess with the glowing slit inside it (a slight downward curve).
    t_slit = t_at(face, 0.18)
    patch(p, "plate_dark", face, t_slit - 0.2, t_slit + 0.16, FRONT - deg(42), FRONT + deg(42),
          off=0.006, thick=0.003, nt=2, nth=10)
    patch(p, "glow", face, t_slit - 0.09, t_slit + 0.07, FRONT - deg(36), FRONT + deg(36),
          off=0.0085, thick=0.002, nt=1, nth=10)
    # Centre ridge down the faceplate and over the crown to the back.
    path(p, "plate", face, [(t_slit - 0.35, FRONT), (1.0, FRONT), (0.05, FRONT)], r=0.01, off=0.006, n=10)
    crown = [L.surf(t, FRONT) for t in np.linspace(3.2, 5.9, 7)] + [L.surf(t, BACK) for t in np.linspace(5.9, 1.0, 10)]
    tube(p, "plate", crown, r=0.014)
    # Enamel lines framing the faceplate: from the crown, out round the slit, down the cheeks.
    for s in (1, -1):
        path(p, "trim", face, [(3.0, FRONT + s * deg(9)), (2.75, FRONT + s * deg(30)),
                               (2.1, FRONT + s * deg(60)), (1.0, FRONT + s * deg(70)), (0.05, FRONT + s * deg(66))],
             r=0.009, off=0.006, n=18)
    # Cheek plates' back edge (side reference): a trim curve from the temple down behind the face.
    for s in (1, -1):
        side = 0.0 if s > 0 else math.pi
        ypath(p, "trim", L, [(0.3, FRONT - s * deg(35)), (0.22, side + s * deg(40)), (0.16, side + s * deg(5)),
                             (0.13, side - s * deg(20)), (0.05, side - s * deg(30)), (-0.06, side - s * deg(20))],
              r=0.008, n=18)
    if enemy_crest:
        c = Piece("helm_crest")
        for s in (1, -1):
            tube(c, "plate", [L.surf(t, th, 0.0) + np.array([0, dy, 0]) for t, th, dy in (
                (4.0, FRONT + s * 0.5, 0.0), (4.6, s * 0.9 + (0 if s > 0 else math.pi), 0.03),
                (4.3, BACK + s * 0.6, 0.06), (3.2, BACK + s * 0.45, 0.10))], r=0.022)
        return p, c
    return p, None


def build_gorget():
    """High flared collar with a V opening at the front. Origin: the waist."""
    p = Piece("gorget")
    L = Loft([
        dict(y=0.70, rx=0.34, rf=0.32, rb=0.28, cz=0.03),
        dict(y=0.86, rx=0.30, rf=0.285, rb=0.26, cz=0.04),
        dict(y=0.96, rx=0.255, rf=0.255, rb=0.235, cz=0.05),
        dict(y=1.04, rx=0.222, rf=0.232, rb=0.215, cz=0.05),
        dict(y=1.10, rx=0.214, rf=0.226, rb=0.21, cz=0.05),
        dict(y=1.13, rx=0.222, rf=0.236, rb=0.218, cz=0.05),
    ])
    t_rim = t_at(L, 1.13)
    t_v = t_at(L, 0.86)

    def top(th):
        d = abs(((th - FRONT + math.pi) % TAU) - math.pi)
        f = 0.5 * (1 + math.cos(math.pi * d / 0.75)) if d < 0.75 else 0.0
        return t_rim + (t_v - t_rim) * f
    rim = shell(p, L, top, 0.0, thick=0.02, nth=40, nu=5)
    tube(p, "trim", rim, r=TRIM_R, closed=True)
    # A second band just below the rim, following its V (helm reference).
    inner = []
    for j in range(40):
        th = TAU * j / 40
        inner.append(L.surf(top(th) - 0.35, th, 0.002))
    tube(p, "trim", inner, r=TRIM_R * 0.8, closed=True)
    # Dark padded neck inside the collar, under the helm.
    Loft([dict(y=0.72, rx=0.15, rf=0.16, rb=0.15, cz=0.05), dict(y=0.98, rx=0.13, rf=0.14, rb=0.13, cz=0.06)]
         ).mesh(p, "plate_dark", seg=14, sub=1)
    return p


def build_breastplate():
    """Barrel chest with the V of trim to the sapphire, a raised centre line. Origin: the waist."""
    p = Piece("breastplate")
    L = Loft([
        dict(y=0.16, rx=0.3, rf=0.27, rb=0.25, cz=0.03, p=2.3),
        dict(y=0.32, rx=0.32, rf=0.31, rb=0.27, cz=0.03, p=2.4),
        dict(y=0.48, rx=0.37, rf=0.35, rb=0.29, cz=0.03, p=2.5),
        dict(y=0.62, rx=0.395, rf=0.36, rb=0.30, cz=0.03, p=2.5),
        dict(y=0.74, rx=0.385, rf=0.335, rb=0.29, cz=0.03, p=2.4),
        dict(y=0.84, rx=0.33, rf=0.285, rb=0.26, cz=0.03),
        dict(y=0.90, rx=0.22, rf=0.2, rb=0.2, cz=0.04),
    ]).mesh(p, "plate", seg=28, sub=2)
    # Sapphire high on the chest, in a hexagonal setting.
    t_gem = t_at(L, 0.69)
    hexgem(p, L.surf(t_gem, FRONT, -0.01), L.normal(t_gem, FRONT), 0.05, 0.068, 0.03)
    # Raised centre line from the gem down to the belt.
    ypath(p, "plate", L, [(0.6, FRONT), (0.4, FRONT), (0.17, FRONT)], r=0.011, n=10)
    for s in (1, -1):
        # The V from the collar's sides down to the gem.
        ypath(p, "trim", L, [(0.86, FRONT + s * deg(50)), (0.8, FRONT + s * deg(30)), (0.72, FRONT + s * deg(9))], n=14)
        # Under the chest: a shallow V from under the pauldrons to the centre line.
        ypath(p, "trim", L, [(0.57, FRONT + s * deg(2)), (0.6, FRONT + s * deg(30)), (0.63, FRONT + s * deg(60)),
                             (0.62, FRONT + s * deg(88))], n=18)
        # Two lines down the abdomen, splaying toward the belt.
        ypath(p, "trim", L, [(0.56, FRONT + s * deg(14)), (0.38, FRONT + s * deg(19)), (0.18, FRONT + s * deg(25))], n=12)
        ypath(p, "trim", L, [(0.6, FRONT + s * deg(62)), (0.4, FRONT + s * deg(55)), (0.18, FRONT + s * deg(50))], n=12)
        # Back: yoke curve and the lines down to the waist (back reference).
        ypath(p, "trim", L, [(0.8, BACK + s * deg(70)), (0.62, BACK + s * deg(35)), (0.58, BACK)], n=16)
        ypath(p, "trim", L, [(0.6, BACK + s * deg(22)), (0.4, BACK + s * deg(25)), (0.18, BACK + s * deg(28))], n=12)
    yring(p, "trim", L, 0.19)
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
    """Fish-scale rows of leaf plates hanging from the origin, wrapping round the body."""
    sgn = -1 if back else 1
    for n, w, h, y, z, tilt in rows:
        for k in range(n):
            x = (k - (n - 1) / 2) * w * 0.8
            zz = z - 0.9 * x * x
            # Lower rows sit behind the ones above and splay out a little (side reference).
            fr = Frame(rot_y(0 if not back else math.pi) @ rot_y(-x * 1.6) @ rot_x(-tilt), (x, y, sgn * zz))
            leaf(p, "plate", w, h, 0.012, fr)


def build_fauld():
    front = Piece("fauld_front")
    # (count, width, height, top y, z, forward tilt) from the top row down.
    leaf_rows(front, [(4, 0.125, 0.24, 0.0, 0.0, 0.16), (3, 0.125, 0.26, -0.12, -0.007, 0.19),
                      (2, 0.13, 0.28, -0.24, -0.014, 0.22), (1, 0.135, 0.3, -0.33, -0.021, 0.25)])
    back = Piece("fauld_back")
    leaf_rows(back, [(5, 0.105, 0.21, 0.0, 0.0, 0.18), (4, 0.105, 0.22, -0.1, -0.006, 0.21),
                     (3, 0.105, 0.23, -0.2, -0.012, 0.24), (2, 0.11, 0.24, -0.3, -0.018, 0.27)], back=True)
    return front, back


def build_tasset(s):
    """Broad curved plate over the outside of the hip, hung from the belt. Origin: its hinge."""
    p = Piece(f"tasset_{'l' if s > 0 else 'r'}")
    o = np.array([s * TASSET_X, TASSET_Y, 0.0])
    L = Loft([
        dict(y=1.27, rx=0.4, rf=0.34, rb=0.3, cz=0.02, p=2.6),
        dict(y=1.08, rx=0.46, rf=0.36, rb=0.32, cz=0.02, p=2.6),
        dict(y=0.9, rx=0.51, rf=0.38, rb=0.34, cz=0.02, p=2.6),
    ], Frame(None, -o))
    if s > 0:
        th0, th1 = deg(-48), deg(60)
    else:
        th0, th1 = deg(120), deg(228)
    # Lower edge slants up toward the front (front reference).
    edge = patch(p, "plate", L, 0.0, 2.0, th0, th1, off=0.0, thick=0.016, nt=6, nth=12)
    tube(p, "trim", edge[1::2] + [edge[1]], r=TRIM_R * 0.85)
    # Inner trim line parallel to the front edge.
    front_th = th1 if s > 0 else th0
    path(p, "trim", L, [(0.15, front_th - s * deg(9)), (1.0, front_th - s * deg(11)), (1.85, front_th - s * deg(14))],
         r=TRIM_R * 0.8, off=0.016, n=10)
    return p


def build_pauldron(s):
    """Massive rounded pauldron: dome, upright flange, disc boss, two lames. Origin: the shoulder."""
    p = Piece(f"pauldron_{'l' if s > 0 else 'r'}")
    tilt = Frame(rot_z(-s * deg(28)), (s * 0.07, 0.0, -0.035))
    dome = Loft([
        dict(y=0.06, rx=0.235, rf=0.29, rb=0.33, p=2.3),
        dict(y=0.17, rx=0.24, rf=0.3, rb=0.34, p=2.3),
        dict(y=0.28, rx=0.2, rf=0.27, rb=0.3, p=2.2),
        dict(y=0.36, rx=0.135, rf=0.19, rb=0.21),
        dict(y=0.405, rx=0.06, rf=0.08, rb=0.085),
        dict(y=0.415, rx=0.01, rf=0.01, rb=0.01),
    ], tilt).mesh(p, "plate", seg=24, sub=2)
    ring(p, "trim", dome, 0.15, r=TRIM_R)
    ring(p, "trim", dome, 0.95, r=TRIM_R * 0.9)
    # Two lames stepping down and out over the upper arm.
    for k, (y0, y1, r) in enumerate(((-0.02, 0.09, 0.245), (-0.1, 0.01, 0.25))):
        fr = Frame(rot_z(-s * deg(24 + 5 * (k + 1))), (s * (0.09 + 0.012 * (k + 1)), 0.0, -0.035))
        lame = Loft([dict(y=y0, rx=r, rf=r * 1.18, rb=r * 1.22, p=2.3),
                     dict(y=y1, rx=r + 0.012, rf=r * 1.18 + 0.012, rb=r * 1.22 + 0.012, p=2.3)], fr)
        lame.mesh(p, "plate", seg=20, sub=2)
        ring(p, "trim", lame, 0.15, r=TRIM_R * 0.9)
    # Upright flange on the inner top edge (front reference: a horn rising past the helm's jaw).
    outline = [(0.22, 0.22), (0.17, 0.33), (0.09, 0.43), (0.0, 0.5), (-0.06, 0.535), (-0.09, 0.56),
               (-0.075, 0.5), (-0.1, 0.42), (-0.16, 0.34), (-0.22, 0.24)]
    R = np.column_stack([[0, 0, 1], [0, 1, 0], [1, 0, 0]]).astype(float)   # local x -> z, local z -> x
    fr = Frame(rot_y(s * deg(14)) @ rot_z(-s * deg(4)) @ R, (-s * 0.08, -0.03, -0.02))
    fin(p, "plate", outline, 0.05, fr)
    tube(p, "trim", [fr((x, y - 0.03, 0)) + np.array([s * 0.004, 0, 0]) for x, y in outline[1:-1]], r=TRIM_R * 0.8)
    # Round disc bosses where the pauldron meets the chest, front and back.
    for th in (FRONT + s * deg(52), BACK - s * deg(52)):
        t = 0.75
        disc(p, "plate", dome.surf(t, th, -0.012), dome.normal(t, th), 0.085, 0.045, seg=16, rim="trim")
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
    """Couter (round elbow boss) + flared vambrace. Origin: the elbow; the arm hangs along -y."""
    p = Piece(f"forearm_{'l' if s > 0 else 'r'}")
    ellipsoid(p, "plate", (s * 0.015, 0.0, -0.01), (0.138, 0.13, 0.135), seg=16, rings=6)
    # Disc on the outside of the elbow (front reference).
    disc(p, "plate", (s * 0.125, 0.0, -0.035), (s, 0, -0.35), 0.075, 0.04, seg=16, rim="trim")
    L = Loft([
        dict(y=-0.05, rx=0.135, rf=0.135, rb=0.135),
        dict(y=-0.13, rx=0.148, rf=0.145, rb=0.145),
        dict(y=-0.27, rx=0.168, rf=0.16, rb=0.16),
        dict(y=-0.33, rx=0.17, rf=0.162, rb=0.162),
        dict(y=-0.355, rx=0.15, rf=0.145, rb=0.145),
    ]).mesh(p, "plate", seg=22, sub=2)
    ring(p, "trim", L, 0.3, r=TRIM_R)
    ring(p, "trim", L, 3.1, r=TRIM_R)
    outer = 0.0 if s > 0 else math.pi   # loft angle facing away from the body
    # The stepped line down the outside (front reference).
    path(p, "trim", L, [(0.45, outer + s * 0.35), (1.4, outer + s * 0.35), (1.7, outer - s * 0.05),
                        (3.0, outer - s * 0.05)], r=TRIM_R * 0.85, n=14)
    return p


def build_gauntlet(s):
    """Heavy gauntlet: flared cuff and a big armoured fist. Origin: the wrist (the grip is ~0.06 below)."""
    p = Piece(f"gauntlet_{'l' if s > 0 else 'r'}")
    cuff = Loft([
        dict(y=0.06, rx=0.14, rf=0.135, rb=0.135),
        dict(y=0.01, rx=0.152, rf=0.148, rb=0.145),
        dict(y=-0.04, rx=0.105, rf=0.11, rb=0.1),
    ]).mesh(p, "plate", seg=24, sub=2)
    ring(p, "trim", cuff, 0.95, r=TRIM_R * 0.85)
    fist = Loft([
        dict(y=-0.02, rx=0.09, rf=0.105, rb=0.09, p=2.6),
        dict(y=-0.1, rx=0.1, rf=0.14, rb=0.095, p=3.0),
        dict(y=-0.19, rx=0.095, rf=0.14, rb=0.09, p=3.0),
        dict(y=-0.25, rx=0.072, rf=0.1, rb=0.068, p=2.6),
    ]).mesh(p, "plate", seg=18, sub=2)
    # Finger lames across the back of the hand and the knuckles.
    for t in (1.0, 1.6, 2.2, 2.7):
        path(p, "plate_dark", fist, [(t, FRONT - deg(80)), (t, FRONT), (t, FRONT + deg(80))], r=0.007, off=-0.002, n=6)
    # Thumb, on the inner side.
    Loft([dict(y=-0.03, rx=0.036, rf=0.036, rb=0.036),
          dict(y=-0.11, rx=0.033, rf=0.033, rb=0.033),
          dict(y=-0.14, rx=0.012, rf=0.012, rb=0.012)],
         Frame(rot_z(s * 0.35), (-s * 0.075, -0.01, 0.04))).mesh(p, "plate", seg=10, sub=2)
    return p


def build_thigh(s):
    """Cuisse. Origin: the hip joint."""
    p = Piece(f"thigh_{'l' if s > 0 else 'r'}")
    L = Loft([
        dict(y=0.1, rx=0.06, rf=0.06, rb=0.06),
        dict(y=0.05, rx=0.15, rf=0.16, rb=0.15),
        dict(y=-0.08, rx=0.172, rf=0.18, rb=0.17),
        dict(y=-0.26, rx=0.168, rf=0.172, rb=0.165),
        dict(y=-0.36, rx=0.15, rf=0.152, rb=0.148),
        dict(y=-0.41, rx=0.12, rf=0.12, rb=0.12),
    ]).mesh(p, "plate", seg=20, sub=2)
    ypath(p, "trim", L, [(-0.33, FRONT + s * 0.6), (-0.2, FRONT + s * 0.65), (-0.05, FRONT + s * 0.75)], n=10)
    yring(p, "plate_dark", L, -0.36, r=0.012)
    return p


def build_shin(s):
    """Poleyn (big knee cop) + thick greave. Origin: the knee."""
    p = Piece(f"shin_{'l' if s > 0 else 'r'}")
    ellipsoid(p, "plate_dark", (0, 0.0, 0.0), (0.15, 0.1, 0.15), seg=12, rings=4)
    cop = Loft([dict(y=-0.08, rx=0.15, rf=0.16, rb=0.0, cz=0.03), dict(y=0.04, rx=0.175, rf=0.19, rb=0.0, cz=0.03),
                dict(y=0.13, rx=0.15, rf=0.165, rb=0.0, cz=0.03), dict(y=0.17, rx=0.09, rf=0.11, rb=0.0, cz=0.03)])
    edge = patch(p, "plate", cop, 0.0, 3.0, deg(-5), deg(185), off=0.0, thick=0.02, nt=8, nth=12)
    tube(p, "trim", edge[1::2] + [edge[1]], r=TRIM_R * 0.9)
    # Fan on the outside of the knee.
    disc(p, "plate", (s * 0.165, 0.04, 0.02), (s, 0, 0.3), 0.07, 0.03, seg=14)
    L = Loft([
        dict(y=-0.06, rx=0.15, rf=0.155, rb=0.16),
        dict(y=-0.18, rx=0.168, rf=0.165, rb=0.175),
        dict(y=-0.34, rx=0.16, rf=0.163, rb=0.172),
        dict(y=-0.46, rx=0.152, rf=0.158, rb=0.158),
        dict(y=-0.5, rx=0.145, rf=0.15, rb=0.15),
    ]).mesh(p, "plate", seg=22, sub=2)
    yring(p, "trim", L, -0.09)
    yring(p, "trim", L, -0.47)
    return p


def build_boot(s):
    """Broad sabaton, toes turned out a little. Origin: the ankle; the sole sits 0.07 below it."""
    p = Piece(f"boot_{'l' if s > 0 else 'r'}")
    cuff = Loft([
        dict(y=0.16, rx=0.16, rf=0.165, rb=0.16),
        dict(y=0.06, rx=0.168, rf=0.175, rb=0.17),
        dict(y=-0.03, rx=0.17, rf=0.18, rb=0.17),
    ]).mesh(p, "plate", seg=20, sub=2)
    yring(p, "trim", cuff, 0.14)
    # Foot: sections run heel -> toe along +z (loft y mapped to game z; loft z up).
    R = np.array([[1, 0, 0], [0, 0, 1], [0, 1, 0]], float)
    to_foot = Frame(rot_y(s * deg(14)) @ R, (s * 0.02, -0.02, 0))
    foot = Loft([
        dict(y=-0.17, rx=0.13, rf=0.08, rb=0.05, p=2.4),
        dict(y=-0.1, rx=0.17, rf=0.12, rb=0.05, p=2.6),
        dict(y=0.04, rx=0.19, rf=0.115, rb=0.05, p=2.8),
        dict(y=0.17, rx=0.195, rf=0.085, rb=0.05, p=2.8),
        dict(y=0.29, rx=0.17, rf=0.06, rb=0.05, p=2.6),
        dict(y=0.36, rx=0.11, rf=0.04, rb=0.04, p=2.3),
        dict(y=0.38, rx=0.04, rf=0.02, rb=0.02),
    ], to_foot).mesh(p, "plate", seg=16, sub=2)
    # Toe lames and the sole edge.
    for t in (2.6, 3.3, 4.0):
        path(p, "plate_dark", foot, [(t, deg(-8)), (t, deg(90)), (t, deg(188))], r=0.008, n=8)
    ring(p, "plate_dark", foot, 1.4, r=0.012, th0=deg(-12), th1=deg(192), n=20)
    return p


# --- Assemble -----------------------------------------------------------------------

reset_scene()
MATS.update({
    "plate": material("plate", (0.17, 0.21, 0.26), metallic=0.6, roughness=0.42),
    "plate_dark": material("plate_dark", (0.06, 0.065, 0.075), metallic=0.3, roughness=0.6),
    "trim": material("trim", (0.03, 0.05, 0.36), metallic=0.1, roughness=0.45),
    "glow": material("glow", (0.69, 0.89, 1.0), roughness=0.3, emission=(0.35, 0.72, 1.0), strength=4.0),
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
