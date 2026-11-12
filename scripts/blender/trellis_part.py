"""Use an image-to-3D mesh (Trellis, art/source/<slug>/trellis-v1/*.glb) as a Plate piece.

Trellis gives good shapes (helm faceplate and collar, gauntlet fingers, the
leaf fauld) but lumpy, dense, texture-coloured meshes. The game wants low-poly
pieces whose faces carry the material names `plate` / `plate_dark` / `trim`,
with the enamel trim as raised bands. So:

  1. load the GLB (geometry in Blender space, its UVs and base-colour texture)
  2. trim: classify the texture's blue enamel by colour, skeletonise it in UV
     space, map each skeleton pixel back to 3D through the triangle that covers
     it (barycentric), trace the pixels into polylines -> tubes later
  3. keep only the part of the mesh inside a box (`keep`), smooth and decimate
     it to a triangle budget, and classify each face as plate or plate_dark
     from the texture (dark under-layer); trim faces become plate (the tubes
     sit on top)
  4. hand back vertices/faces/classes and polylines in Blender space; the
     caller maps them into the piece's frame (`Part.transform`).
"""
import colorsys
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector


def _texture(obj):
    mat = obj.active_material
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            img = n.image
            w, h = img.size
            px = np.empty(w * h * 4, np.float32)
            img.pixels.foreach_get(px)
            return px.reshape(h, w, 4)[..., :3]
    raise SystemExit(f"{obj.name}: no base-colour texture")


def classify_rgb(px):
    """0 plate, 1 dark under-layer, 2 blue trim; px float RGB (..., 3), linear."""
    srgb = np.where(px <= 0.0031308, px * 12.92, 1.055 * np.power(np.clip(px, 0, 1), 1 / 2.4) - 0.055)
    r, g, b = srgb[..., 0], srgb[..., 1], srgb[..., 2]
    mx, mn = srgb.max(-1), srgb.min(-1)
    s = (mx - mn) / np.maximum(mx, 1e-6)
    cls = np.zeros(r.shape, np.uint8)
    cls[mx < 0.2] = 1
    cls[(b > 0.12) & (b > r * 1.35) & (b > g * 1.15) & (s > 0.3)] = 2
    return cls


def _trace(skel):
    """8-connected skeleton pixels -> list of pixel chains [(y, x), ...]."""
    ys, xs = np.nonzero(skel)
    pts = set(zip(ys.tolist(), xs.tolist()))
    nb = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

    def neigh(p):
        return [(p[0] + dy, p[1] + dx) for dy, dx in nb if (p[0] + dy, p[1] + dx) in pts]
    seen, chains = set(), []
    deg = {p: len(neigh(p)) for p in pts}
    starts = [p for p in pts if deg[p] != 2] + list(pts)
    for s in starts:
        if s in seen:
            continue
        for first in ([s] if deg[s] == 0 else neigh(s)):
            if first in seen and first != s:
                continue
            chain, prev, cur = [s], s, first
            seen.add(s)
            while cur != s and cur not in seen:
                chain.append(cur)
                seen.add(cur)
                nxt = [q for q in neigh(cur) if q != prev and q not in seen]
                if deg[cur] > 2 or not nxt:
                    break
                prev, cur = cur, nxt[0]
            if len(chain) > 1:
                chains.append(chain)
    return chains


class Part:
    def __init__(self, path, keep=None, target_tris=3000, smooth=0.5, min_trim_len=0.04, trim_close=3, trim_step=0.03):
        """keep: (lo, hi) xyz box in Blender space of the raw GLB (None = all)."""
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(path))
        new = [o for o in set(bpy.data.objects) - before if o.type == "MESH"]
        obj = new[0]
        tex = _texture(obj)
        H, W = tex.shape[:2]
        me = obj.data
        me.transform(obj.matrix_world)
        n = len(me.vertices)
        V = np.empty(n * 3)
        me.vertices.foreach_get("co", V)
        V = V.reshape(-1, 3)
        me.calc_loop_triangles()
        T = np.empty(len(me.loop_triangles) * 3, np.int64)
        me.loop_triangles.foreach_get("vertices", T)
        T = T.reshape(-1, 3)
        L = np.empty(len(me.loop_triangles) * 3, np.int64)
        me.loop_triangles.foreach_get("loops", L)
        L = L.reshape(-1, 3)
        UVall = np.empty(len(me.loops) * 2)
        me.uv_layers.active.data.foreach_get("uv", UVall)
        UV = UVall.reshape(-1, 2)[L]                     # (tris, 3, 2)
        self.tex_cls = classify_rgb(tex)
        self.trim_step = trim_step
        self.V, self.T, self.UV = V, T, UV
        inside = np.ones(len(V), bool)
        if keep is not None:
            lo, hi = np.array(keep[0]), np.array(keep[1])
            inside = np.all((V >= lo) & (V <= hi), axis=1)
        self.inside = inside

        # --- trim polylines from the texture --------------------------------------
        import cv2
        from skimage.morphology import skeletonize
        trim = (self.tex_cls == 2).astype(np.uint8)
        trim = cv2.morphologyEx(trim, cv2.MORPH_CLOSE, np.ones((trim_close, trim_close), np.uint8))
        skel = skeletonize(trim > 0)
        # skeleton pixel -> 3D through the triangle covering it
        pix3 = {}
        tri_uv = UV * np.array([W, H])               # pixel coords (x, y up)
        for ti in range(len(T)):
            if not inside[T[ti]].all():
                continue
            a, b, c = tri_uv[ti]
            x0, x1 = int(max(min(a[0], b[0], c[0]), 0)), int(min(max(a[0], b[0], c[0]), W - 1)) + 1
            y0, y1 = int(max(min(a[1], b[1], c[1]), 0)), int(min(max(a[1], b[1], c[1]), H - 1)) + 1
            sub = skel[y0:y1, x0:x1]
            if not sub.any():
                continue
            yy, xx = np.nonzero(sub)
            P = np.stack([xx + x0 + 0.5, yy + y0 + 0.5], 1)
            v0, v1 = b - a, c - a
            d = v0[0] * v1[1] - v0[1] * v1[0]
            if abs(d) < 1e-9:
                continue
            w1 = ((P[:, 0] - a[0]) * v1[1] - (P[:, 1] - a[1]) * v1[0]) / d
            w2 = (v0[0] * (P[:, 1] - a[1]) - v0[1] * (P[:, 0] - a[0])) / d
            ok = (w1 >= -1e-3) & (w2 >= -1e-3) & (w1 + w2 <= 1 + 1e-3)
            pa, pb, pc = V[T[ti]]
            nrm = np.cross(pb - pa, pc - pa)
            nrm /= np.linalg.norm(nrm) or 1
            for k in np.nonzero(ok)[0]:
                p3 = pa + w1[k] * (pb - pa) + w2[k] * (pc - pa)
                pix3[(int(yy[k] + y0), int(xx[k] + x0))] = (p3, nrm)
        sk2 = np.zeros_like(skel)
        for (y, x) in pix3:
            sk2[y, x] = True
        self.trim = []
        for chain in _trace(sk2):
            pts = [pix3[p] for p in chain]
            # split where neighbouring pixels land far apart (UV island seams)
            run = [pts[0]]
            for q in pts[1:]:
                if np.linalg.norm(q[0] - run[-1][0]) > 0.03:
                    self._add_run(run, min_trim_len)
                    run = []
                run.append(q)
            self._add_run(run, min_trim_len)

        # --- geometry: keep box, smooth, decimate, classify faces ---------------------
        bm = bmesh.new()
        bm.from_mesh(me)
        if keep is not None:
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not inside[v.index]], context="VERTS")
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(me)
        bm.free()
        bpy.context.view_layer.objects.active = obj
        for o in bpy.context.view_layer.objects:
            o.select_set(o == obj)
        obj.matrix_world = __import__("mathutils").Matrix.Identity(4)
        if smooth:
            m = obj.modifiers.new("smooth", "SMOOTH")
            m.factor, m.iterations = smooth, 4
            bpy.ops.object.modifier_apply(modifier=m.name)
        ntri = sum(len(p.vertices) - 2 for p in me.polygons)
        if ntri > target_tris:
            m = obj.modifiers.new("dec", "DECIMATE")
            m.ratio = target_tris / ntri
            m.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=m.name)
        me = obj.data
        me.calc_loop_triangles()
        n = len(me.vertices)
        V2 = np.empty(n * 3)
        me.vertices.foreach_get("co", V2)
        self.verts = V2.reshape(-1, 3)
        self.faces = [tuple(p.vertices) for p in me.polygons]
        uvd = me.uv_layers.active.data
        cls = []
        for p in me.polygons:
            us = np.array([uvd[li].uv for li in p.loop_indices])
            samp = list(us) + [us.mean(0)] * 2
            votes = np.zeros(3, int)
            for u in samp:
                x = int(np.clip(u[0], 0, 0.9999) * W)
                y = int(np.clip(u[1], 0, 0.9999) * H)
                votes[self.tex_cls[y, x]] += 1
            c = int(np.argmax(votes[:2])) if votes[1] > votes[0] + votes[2] else 0
            cls.append(c)
        self.cls = cls
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)

    def _add_run(self, run, min_len):
        if len(run) < 3:
            return
        P = np.array([r[0] for r in run])
        N = np.array([r[1] for r in run])
        length = np.linalg.norm(np.diff(P, axis=0), axis=1).sum()
        if length < min_len:
            return
        # resample every trim_step (raw units; the GLBs are ~1 unit tall) and smooth
        k = max(3, int(length / self.trim_step) + 1)
        cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
        s = np.linspace(0, cum[-1], k)
        Q = np.stack([np.interp(s, cum, P[:, i]) for i in range(3)], 1)
        M = np.stack([np.interp(s, cum, N[:, i]) for i in range(3)], 1)
        if len(Q) > 4:
            Q[1:-1] = (Q[:-2] + 2 * Q[1:-1] + Q[2:]) / 4
        M /= np.linalg.norm(M, axis=1, keepdims=True)
        self.trim.append((Q, M))

    def transform(self, fn, normal_fn):
        """Map everything through fn (points, Nx3 -> Nx3) and normal_fn (normals)."""
        self.verts = fn(self.verts)
        self.trim = [(fn(Q), normal_fn(M)) for Q, M in self.trim]
        return self


def similarity(scale, rot=np.eye(3), offset=(0, 0, 0)):
    """Blender-space raw GLB -> game-space piece frame: game = R @ (s * (bx, bz, -by)) + offset."""
    to_game = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)
    R = np.asarray(rot, float) @ to_game
    off = np.asarray(offset, float)
    return (lambda P: (scale * P) @ R.T + off), (lambda N: N @ R.T)
