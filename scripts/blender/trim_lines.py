"""Extract the reference's enamel trim as polylines (skeleton graph, split at junctions).

  .venv-blender/bin/python scripts/blender/trim_lines.py --view front|back|side --region 1.10,2.16 [--min 0.05]

Prints every skeleton segment as (x, height) points in world metres, sampled every
`--step` metres of arc length, longest first. Handles branched trim (a V with
ribs) by splitting the skeleton at junctions.
"""
import argparse
import sys

import cv2
import numpy as np
from skimage.morphology import skeletonize

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from lib import ROOT  # noqa: E402
from trace_silhouette import silhouette_mask  # noqa: E402
import compare_metrics as M  # noqa: E402

REF = {
    "front": ("shardplate-front/nb21-v1/shardplate-front.jpg", None, 2.37 / 982, 1003, 513.5),
    "side": ("shardplate-side-back/nb21-v1/shardplate-side-back.jpg", (0, 690), None, None, None),
    "back": ("shardplate-side-back/nb21-v1/shardplate-side-back.jpg", (690, 1376), None, None, None),
}
ap = argparse.ArgumentParser()
ap.add_argument("--view", default="front")
ap.add_argument("--region", default="1.10,2.16")
ap.add_argument("--min", type=float, default=0.05, help="shortest segment to print, metres")
ap.add_argument("--step", type=float, default=0.03)
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

ref, crop, mpp, y1, axis = REF[args.view]
img = cv2.imread(str(ROOT / "art/source" / ref))
if crop:
    img = img[:, crop[0]:crop[1]]
mask, _ = silhouette_mask(img)
if mpp is None:
    ys, xs = np.where(mask > 0)
    y0, yb = int(ys.min()), int(ys.max())
    mpp = 2.37 / (yb - y0 + 1)
    y1 = yb
    band = np.where(mask[int(y1 - 1.8 / mpp):int(y1 - 1.2 / mpp)] > 0)
    axis = float(np.median(band[1])) + 0.5

trim = cv2.bitwise_and(M.ref_trim_mask(img), mask)
h0, h1 = (float(v) for v in args.region.split(","))
keep = np.zeros_like(trim)
keep[int(round(y1 - h1 / mpp)):int(round(y1 - h0 / mpp))] = 255
trim = cv2.bitwise_and(trim, keep)

sk = skeletonize(trim > 0)
H, W = sk.shape
pts = {(int(r), int(c)) for r, c in zip(*np.where(sk))}


def nbrs(p):
    return [q for q in ((p[0] + a, p[1] + b) for a in (-1, 0, 1) for b in (-1, 0, 1))
            if q != p and q in pts]


deg = {p: len(nbrs(p)) for p in pts}
nodes = {p for p in pts if deg[p] != 2}
segs, used = [], set()
for p in nodes:
    for q in nbrs(p):
        if (p, q) in used:
            continue
        path, cur, prev = [p], q, p
        used.add((p, q))
        while True:
            path.append(cur)
            if cur in nodes:
                used.add((cur, prev))
                break
            nxt = [r for r in nbrs(cur) if r != prev]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
        segs.append(path)
for p in list(pts):                # any pure loops left over
    for q in nbrs(p):
        if (p, q) in used:
            continue
        path, cur, prev = [p], q, p
        used.add((p, q))
        for _ in range(100000):
            path.append(cur)
            if cur == p:
                break
            nxt = [r for r in nbrs(cur) if r != prev and (cur, r) not in used]
            if not nxt:
                break
            used.add((cur, prev))
            prev, cur = cur, nxt[0]
        segs.append(path)


def xy(path):
    a = np.array([((c - axis) * mpp, (y1 - r) * mpp) for r, c in path])
    return a


out = []
for path in segs:
    a = xy(path)
    if len(a) < 2:
        continue
    d = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(a, axis=0), axis=1))])
    if d[-1] < args.min:
        continue
    out.append((d[-1], a, d))
out.sort(key=lambda t: -t[0])
print(f"{args.view}: {len(out)} segments over {args.min} m  (mpp {mpp * 1000:.2f} mm)")
for ln, a, d in out:
    ss = np.arange(0, d[-1] + 1e-9, args.step)
    q = []
    for s in ss:
        k = int(np.clip(np.searchsorted(d, s), 1, len(d) - 1))
        f = (s - d[k - 1]) / max(d[k] - d[k - 1], 1e-9)
        q.append(a[k - 1] + f * (a[k] - a[k - 1]))
    q.append(a[-1])
    print(f"--- {ln:.2f} m")
    print("   " + " ".join(f"({p[0]:+.3f},{p[1]:.3f})" for p in q))
