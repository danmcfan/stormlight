"""Metrics for compare_reference.py (numpy / OpenCV only, no bpy).

All functions work on the aligned comparison canvas: the reference and the
model render placed on the same pixel grid (bottom edges together), with a
known size per pixel (`mpp`, metres) and the column of the body's centre axis.

profile()       left/right (or front/back) extents of each silhouette every
                5 cm of height, in metres from the axis, and the worst bands
detail_scores() interior detail: the reference's ink lines and blue trim vs
                the model's crease/material edges and trim, as chamfer
                distances (cm) and F-scores within a tolerance, counted only
                inside both silhouettes (the outline is IoU's job)
"""
import cv2
import numpy as np

BAND = 0.05          # profile band height, metres
TOL = 0.03           # detail F-score tolerance, metres


# --- Per-height profile ---------------------------------------------------------------

def _extents(mask, r0, r1):
    rows = mask[r0:r1]
    cols = np.where(rows.any(0))[0]
    if len(cols) == 0:
        return None
    return int(cols[0]), int(cols[-1])


def profile(ref, mod, mpp, axis_col, ground_row, edge_names=("left", "right"), band=BAND):
    """Extents per height band. Returns (rows, worst).

    rows: dicts {h (band centre, m), ref: [l, r] or None, model: [l, r] or None}
          with l, r in metres from the axis (image-right positive).
    worst: bands sorted by the largest edge error, each with a sentence.
    """
    n = int((ground_row + 1) * mpp / band) + 1
    rows, issues = [], []
    for i in range(n):
        h0, h1 = i * band, (i + 1) * band
        r1 = int(round(ground_row + 1 - h0 / mpp))
        r0 = int(round(ground_row + 1 - h1 / mpp))
        r0 = max(r0, 0)
        if r1 <= 0:
            break
        a, b = _extents(ref, r0, r1), _extents(mod, r0, r1)
        conv = (lambda e: None if e is None else [round((e[0] - axis_col) * mpp, 3),
                                                  round((e[1] + 1 - axis_col) * mpp, 3)])
        ra, rb = conv(a), conv(b)
        h = round((h0 + h1) / 2, 3)
        rows.append({"h": h, "ref": ra, "model": rb})
        if ra is None and rb is None:
            continue
        if ra is None or rb is None:
            who = "model" if ra is None else "reference"
            issues.append({"h": h, "err": band * 2, "text": f"at {h:.2f} m only the {who} has anything"})
            continue
        # Outward error per edge: + = model sticks out past the reference.
        for k, (name, sgn) in enumerate(((edge_names[0], -1), (edge_names[1], 1))):
            d = sgn * (rb[k] - ra[k])
            if abs(d) >= 0.02:
                rel = "outside" if d > 0 else "inside"
                issues.append({"h": h, "edge": name, "err": round(abs(d), 3), "delta": round(d, 3),
                               "text": f"at {h:.2f} m the model's {name} edge is {abs(d):.2f} m {rel} the reference"})
    worst = sorted(issues, key=lambda x: -x["err"])
    return rows, worst


def profile_plot(rows, title, path, edge_names=("left", "right")):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    hs = [r["h"] for r in rows]

    def col(key, k):
        return [r[key][k] if r[key] else np.nan for r in rows]
    fig, ax = plt.subplots(1, 2, figsize=(9, 8), gridspec_kw={"width_ratios": [2, 1]}, sharey=True)
    for key, c, lab in (("ref", "#d33", "reference"), ("model", "#2563eb", "model")):
        ax[0].plot(col(key, 0), hs, c, lw=1.6, label=lab)
        ax[0].plot(col(key, 1), hs, c, lw=1.6)
    ax[0].axvline(0, color="#999", lw=0.6)
    ax[0].set_xlabel(f"metres from the axis   (← {edge_names[0]}   |   {edge_names[1]} →)")
    ax[0].set_ylabel("height (m)")
    ax[0].legend(loc="upper right")
    ax[0].grid(alpha=0.3)
    ax[0].set_aspect("equal")
    # Edge errors: + = model outside the reference.
    dl = [(-(r["model"][0] - r["ref"][0]) if r["ref"] and r["model"] else np.nan) for r in rows]
    dr = [((r["model"][1] - r["ref"][1]) if r["ref"] and r["model"] else np.nan) for r in rows]
    ax[1].barh(hs, dl, height=0.022, color="#7c3aed", alpha=0.8, label=f"{edge_names[0]} edge")
    ax[1].barh([h + 0.022 for h in hs], dr, height=0.022, color="#0d9488", alpha=0.8, label=f"{edge_names[1]} edge")
    ax[1].axvline(0, color="#333", lw=0.8)
    for x in (-0.05, 0.05):
        ax[1].axvline(x, color="#999", lw=0.6, ls="--")
    ax[1].set_xlabel("edge error (m): + model outside")
    ax[1].legend(loc="upper right", fontsize=8)
    ax[1].grid(alpha=0.3)
    fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(path, dpi=90)
    plt.close(fig)


# --- Interior detail -------------------------------------------------------------------

def ref_trim_mask(img):
    """The reference's blue enamel trim (deep indigo, BGR ~ (103, 62, 51)), gem excluded."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    m = (h >= 100) & (h <= 135) & (s >= 70) & (v >= 45) & (v <= 165)
    m = m.astype(np.uint8) * 255
    return cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))


def ref_ink_mask(img):
    """The reference's drawn lines: thin dark strokes (big dark areas, the undersuit, removed)."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    dark = (g < 70).astype(np.uint8) * 255
    blobs = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    blobs = cv2.dilate(blobs, np.ones((5, 5), np.uint8))
    lines = cv2.bitwise_and(dark, cv2.bitwise_not(blobs))
    return cv2.bitwise_or(lines, cv2.Canny(blobs, 50, 150))


def skeleton(mask):
    from skimage.morphology import skeletonize
    return skeletonize(mask > 0).astype(np.uint8) * 255


def model_edges(id_img, normal_img):
    """Creases and plate boundaries in the model: edges of the normal pass and the material-ID pass."""
    e1 = cv2.Canny(cv2.GaussianBlur(normal_img, (3, 3), 0), 40, 110)
    e2 = cv2.Canny(id_img, 30, 90)
    return cv2.bitwise_or(e1, e2)


def _chamfer(src, dst_dt, region):
    pts = (src > 0) & region
    if pts.sum() == 0:
        return None, 0
    return float(dst_dt[pts].mean()), int(pts.sum())


def match(ref_lines, mod_lines, region, mpp, tol=TOL):
    """Chamfer distances (cm) both ways and the F-score at `tol` metres, inside `region`."""
    if not region.any():
        return None
    dt_ref = cv2.distanceTransform(255 - ((ref_lines > 0) * 255).astype(np.uint8), cv2.DIST_L2, 3)
    dt_mod = cv2.distanceTransform(255 - ((mod_lines > 0) * 255).astype(np.uint8), cv2.DIST_L2, 3)
    t = tol / mpp
    rp = (ref_lines > 0) & region
    mp = (mod_lines > 0) & region
    if rp.sum() == 0 or mp.sum() == 0:
        return {"f": 0.0, "precision": 0.0, "recall": 0.0, "ref_px": int(rp.sum()), "model_px": int(mp.sum())}
    recall = float((dt_mod[rp] <= t).mean())       # reference lines the model reproduces
    precision = float((dt_ref[mp] <= t).mean())    # model lines the reference has
    f = 0.0 if recall + precision == 0 else 2 * recall * precision / (recall + precision)
    return {
        "f": round(f, 3), "precision": round(precision, 3), "recall": round(recall, 3),
        "ref_to_model_cm": round(float(dt_mod[rp].mean()) * mpp * 100, 1),
        "model_to_ref_cm": round(float(dt_ref[mp].mean()) * mpp * 100, 1),
    }


def detail_scores(ref_img, ref_mask, mod_trim, mod_edges, mod_mask, mpp, tol=TOL):
    """Scores and the masks used: (scores, ref_lines, ref_trim_skel, mod_trim_skel, region)."""
    inner = int(round(0.025 / mpp))
    k = np.ones((2 * inner + 1, 2 * inner + 1), np.uint8)
    region = cv2.erode(cv2.bitwise_and(ref_mask, mod_mask), k) > 0
    ref_trim = cv2.bitwise_and(ref_trim_mask(ref_img), ref_mask)
    rt, mt = skeleton(ref_trim), skeleton(mod_trim)
    ink = skeleton(ref_ink_mask(ref_img))
    ref_lines = cv2.bitwise_or(ink, rt)
    mod_lines = cv2.bitwise_or(mod_edges, mt)
    scores = {
        "trim": match(rt, mt, region, mpp, tol),
        "lines": match(ref_lines, mod_lines, region, mpp, tol),
        # Fraction of the shared interior covered by trim (paint coverage, not position).
        "trim_cover": {"ref": round(float((ref_trim > 0)[region].mean()), 4),
                       "model": round(float((mod_trim > 0)[region].mean()), 4)},
    }
    return scores, ref_lines, rt, mt, region


def detail_overlay(ref_img_canvas, ref_lines, mod_lines, ref_trim, mod_trim, region, label):
    """Grey interior; reference lines red, model lines blue (both purple); trim panel to the right."""
    h, w = region.shape

    def panel(a, b):
        p = np.full((h, w, 3), 240, np.uint8)
        p[region] = (205, 205, 205)
        da = cv2.dilate(a, np.ones((2, 2), np.uint8)) > 0
        db = cv2.dilate(b, np.ones((2, 2), np.uint8)) > 0
        p[da & ~db] = (40, 40, 220)
        p[db & ~da] = (220, 110, 30)
        p[da & db] = (160, 40, 160)
        return p
    left = panel(ref_lines, mod_lines)
    right = panel(ref_trim, mod_trim)
    sheet = np.hstack([left, np.full((h, 6, 3), 255, np.uint8), right])
    f = min(1.0, 1600 / sheet.shape[1], 900 / sheet.shape[0])
    sheet = cv2.resize(sheet, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    bar = np.full((44, sheet.shape[1], 3), 255, np.uint8)
    cv2.putText(bar, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (30, 30, 30), 1, cv2.LINE_AA)
    return np.vstack([bar, sheet])
