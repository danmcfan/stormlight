#!/usr/bin/env python3
"""Look-dev measures for the art pass (step 2, issue #9).

  band IMG [--mask MASK] [--channel lum|chroma]   Direction of the rock-band edges on a cliff shot.
  sat IMG --mask MASK | --rect x0,y0,x1,y1   Mean HSV saturation of the plateau tops in a game frame.
  sat-ref                     The same on the style reference's plateau-top area.

Masks come from `MASK=1 node scripts/lookdev/matchshot.mjs ...`: terrain tops
are drawn pure green, walls pure red, everything else as rendered.

band: luminance → Gaussian blur (σ 3 px, so thin crack lines drop out) → Sobel. The strongest 25% of
gradients inside the wall area are the band edges. For each, the angle
between the gradient and the vertical axis is the edge's tilt from
horizontal. Reports the share of edge strength within ±15° of horizontal,
the median tilt, and the dominant edge orientation (structure tensor).

Run with the Blender venv (OpenCV + NumPy):
  .venv-blender/bin/python scripts/lookdev/measure.py band art/renders/look-dev/step2-cliff.png --mask ...
"""
import argparse
import json

import cv2
import numpy as np

REF = "art/source/plateau-noon/nb21-v2/plateau-noon.jpg"
# Plateau-top area of the style reference (1376 x 768): the sunlit top of the
# centre plateau, from rim to rim behind the bridge (rockbuds included).
REF_TOP = [(240, 258), (330, 228), (450, 214), (610, 206), (800, 202), (930, 206), (1040, 222),
           (1160, 262), (1100, 300), (960, 318), (800, 330), (620, 334), (440, 322), (300, 300)]


def load_mask(path, shape, kind):
    m = cv2.imread(path, cv2.IMREAD_COLOR).astype(np.int16)
    b, g, r = m[..., 0], m[..., 1], m[..., 2]
    if kind == "top":
        sel = (g > 150) & (r < 110) & (b < 110)
    else:
        sel = (r > 150) & (g < 110) & (b < 110)
    sel = sel.astype(np.uint8)
    sel = cv2.erode(sel, np.ones((7, 7), np.uint8))  # keep clear of edges between areas
    assert sel.shape == shape[:2], "mask and image sizes differ"
    return sel.astype(bool)


def gradients(img, channel, sigma):
    if channel == "lum":
        chans = [cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255]
    else:  # colour edges only: Lab a* and b*, so lighting and cracks drop out
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32) / 255
        chans = [lab[..., 1], lab[..., 2]]
    gx = np.zeros(img.shape[:2], np.float32)
    gy = np.zeros_like(gx)
    jxx = np.zeros_like(gx); jyy = np.zeros_like(gx); jxy = np.zeros_like(gx)
    for c in chans:
        c = cv2.GaussianBlur(c, (0, 0), sigma)
        x = cv2.Sobel(c, cv2.CV_32F, 1, 0, ksize=3)
        y = cv2.Sobel(c, cv2.CV_32F, 0, 1, ksize=3)
        jxx += x * x; jyy += y * y; jxy += x * y
    # Per-pixel dominant gradient (structure tensor of all channels).
    theta = 0.5 * np.arctan2(2 * jxy, jxx - jyy)
    mag = np.sqrt(jxx + jyy)
    return mag * np.cos(theta), mag * np.sin(theta), mag


def band(img_path, mask_path=None, channel="lum", sigma=3.0, rect=None):
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    # Band scale (σ 3 px): thin crack lines drop out.
    gx, gy, mag = gradients(img, channel, sigma)
    if rect:
        x0, y0, x1, y1 = rect
        area = np.zeros(mag.shape, bool)
        area[y0:y1, x0:x1] = True
    elif mask_path:
        area = load_mask(mask_path, img.shape, "wall")
    else:
        h, w = mag.shape
        area = np.zeros(mag.shape, bool)
        area[int(h * 0.1):int(h * 0.9), int(w * 0.05):int(w * 0.6)] = True
    sel = area & (mag >= np.quantile(mag[area], 0.75))
    tilt = np.degrees(np.arctan2(np.abs(gx[sel]), np.abs(gy[sel])))  # 0 = horizontal edge
    wgt = mag[sel]
    within = float((wgt * (tilt <= 15)).sum() / wgt.sum())
    # Structure tensor over the edge pixels: dominant gradient direction.
    jxx, jyy, jxy = (gx[sel] ** 2 * 1).sum(), (gy[sel] ** 2).sum(), (gx[sel] * gy[sel]).sum()
    grad_angle = 0.5 * np.degrees(np.arctan2(2 * jxy, jxx - jyy))  # from +x
    edge_angle = (grad_angle + 90 + 90) % 180 - 90  # edge direction, 0 = horizontal
    return {"image": img_path, "channel": channel, "edge_pixels": int(sel.sum()), "share_within_15deg": round(within, 3),
            "median_tilt_deg": round(float(np.median(tilt)), 1),
            "dominant_edge_orientation_deg": round(float(edge_angle), 1)}


def sat_of(img, sel):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    s = hsv[..., 1].astype(np.float32) / 255
    return float(s[sel].mean()), int(sel.sum())


def sat(img_path, mask_path, rect=None):
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    if rect:  # for frames without a mask (before the terrain shader): a hand-picked top area
        x0, y0, x1, y1 = rect
        sel = np.zeros(img.shape[:2], bool)
        sel[y0:y1, x0:x1] = True
    else:
        sel = load_mask(mask_path, img.shape, "top")
    m, n = sat_of(img, sel)
    return {"image": img_path, "top_pixels": n, "mean_saturation": round(m, 3)}


def sat_ref():
    img = cv2.imread(REF, cv2.IMREAD_COLOR)
    poly = np.zeros(img.shape[:2], np.uint8)
    cv2.fillPoly(poly, [np.array(REF_TOP, np.int32)], 1)
    sel = poly.astype(bool)
    m_all, n_all = sat_of(img, sel)
    # Without the grey rockbud shells and dark vines (stone only, like the game's top mask).
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    stone = sel & (hsv[..., 1] > 0.14 * 255) & (hsv[..., 2] > 0.45 * 255)
    m_stone, n_stone = sat_of(img, stone)
    return {"image": REF, "area_pixels": n_all, "mean_saturation": round(m_all, 3),
            "stone_pixels": n_stone, "mean_saturation_stone_only": round(m_stone, 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["band", "sat", "sat-ref"])
    ap.add_argument("image", nargs="?")
    ap.add_argument("--mask")
    ap.add_argument("--rect", help="x0,y0,x1,y1 instead of a mask (sat)")
    ap.add_argument("--channel", choices=["lum", "chroma"], default="lum", help="band: luminance or colour (Lab a*b*) edges")
    a = ap.parse_args()
    if a.cmd == "band":
        r = band(a.image, a.mask, a.channel, rect=[int(v) for v in a.rect.split(",")] if a.rect else None)
    elif a.cmd == "sat":
        r = sat(a.image, a.mask, [int(v) for v in a.rect.split(",")] if a.rect else None)
    else:
        r = sat_ref()
    print(json.dumps(r))


if __name__ == "__main__":
    main()
