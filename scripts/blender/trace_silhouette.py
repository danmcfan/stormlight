"""Trace an object's outline from a construction reference on a plain background.

Flood-fills the background from the image border (stopping at the object's
drawn outline), keeps the largest remaining shape, and writes its simplified
outer contour as JSON (image pixel coordinates) plus a debug overlay PNG.

  .venv-blender/bin/python scripts/blender/trace_silhouette.py IMAGE OUT.json [--tolerance 10] [--epsilon 1.2]
"""
import argparse, json, pathlib
import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("image"); ap.add_argument("out")
ap.add_argument("--tolerance", type=int, default=10, help="colour distance still counted as background")
ap.add_argument("--epsilon", type=float, default=1.2, help="contour simplification, pixels")
ap.add_argument("--smooth", type=float, default=0, help="Gaussian blur radius (px) applied to the mask to smooth jagged edges")
a = ap.parse_args()

img = cv2.imread(a.image)
h, w = img.shape[:2]
# Flood fill from every border pixel: what's reachable through near-background colour is background.
mask = np.zeros((h + 2, w + 2), np.uint8)
flags = 4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8) | cv2.FLOODFILL_FIXED_RANGE
t = (a.tolerance,) * 3
bgc = np.median(np.concatenate([img[0], img[-1], img[:, 0], img[:, -1]]), axis=0)
for x in range(0, w, 8):
    for y in (0, h - 1):
        if mask[y + 1, x + 1] == 0 and np.abs(img[y, x].astype(int) - bgc).max() <= a.tolerance:
            cv2.floodFill(img, mask, (x, y), 0, t, t, flags)
for y in range(0, h, 8):
    for x in (0, w - 1):
        if mask[y + 1, x + 1] == 0 and np.abs(img[y, x].astype(int) - bgc).max() <= a.tolerance:
            cv2.floodFill(img, mask, (x, y), 0, t, t, flags)
obj = (mask[1:-1, 1:-1] == 0).astype(np.uint8) * 255
obj = cv2.morphologyEx(obj, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
if a.smooth > 0:
    k = int(a.smooth * 3) | 1
    obj = (cv2.GaussianBlur(obj, (k, k), a.smooth) > 127).astype(np.uint8) * 255
contours, _ = cv2.findContours(obj, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c = max(contours, key=cv2.contourArea)
poly = cv2.approxPolyDP(c, a.epsilon, True)[:, 0, :]
x0, y0, bw, bh = cv2.boundingRect(c)

out = pathlib.Path(a.out)
out.parent.mkdir(parents=True, exist_ok=True)
json.dump({"image": a.image, "size": [w, h], "bbox": [int(x0), int(y0), int(bw), int(bh)],
           "background": [float(v) for v in bgc], "points": poly.tolist()}, open(out, "w"))
dbg = img.copy()
cv2.drawContours(dbg, [poly.reshape(-1, 1, 2)], -1, (0, 0, 255), 2)
cv2.imwrite(str(out.with_suffix(".png")), dbg)
print(f"{len(poly)} points, bbox {bw}x{bh} at ({x0},{y0}), background {bgc.round()}")
