#!/usr/bin/env python3
"""Turn the generated terrain images into seamless game textures.

Inputs (flux-schnell runs, see art/source/terrain/*/runs.jsonl):
  top/flux-v1/top.png      plateau-top stone with hairline cracks
  cliff/flux-v1/cliff.png  layered sandstone wall
  crem/flux-v1/crem.png    cracked crem crust
  wood/flux-v1/wood.png    bridge plank

Outputs:
  public/textures/terrain-detail.jpg  RGB detail map, 1024²:
      R = plateau-top detail, G = cliff detail, B = crem crust detail.
      Each channel is luminance only, flattened (large-scale shading removed)
      and centred on 0.5, so the shader keeps control of colour: the cliff
      bands come from world height, not from the picture.
  public/textures/wood.jpg  seamless plank colour, grain along U, 512².

  .venv-blender/bin/python scripts/gen/make_terrain_textures.py
"""
import pathlib
import cv2
import numpy as np

SRC = pathlib.Path("art/source/terrain")
OUT = pathlib.Path("public/textures")


def seamless(img: np.ndarray, feather: float = 0.22) -> np.ndarray:
    """Blend the image with a half-offset copy whose seams sit in the middle."""
    h, w = img.shape[:2]
    shifted = np.roll(img, (h // 2, w // 2), axis=(0, 1))
    y = np.minimum(np.arange(h), h - 1 - np.arange(h)) / (h * feather)
    x = np.minimum(np.arange(w), w - 1 - np.arange(w)) / (w * feather)
    m = np.clip(np.minimum.outer(y, x), 0, 1)
    m = m * m * (3 - 2 * m)
    if img.ndim == 3:
        m = m[..., None]
    # Original in the middle, offset copy (continuous across the borders) at the edges.
    return img * m + shifted * (1 - m)


def detail(path: pathlib.Path, size: int, contrast: float) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR).astype(np.float32) / 255
    img = cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)
    lum = img @ np.array([0.114, 0.587, 0.299], np.float32)  # BGR
    # Flatten: divide out the large-scale shading (vignettes, lighting).
    low = cv2.GaussianBlur(lum, (0, 0), size / 10)
    flat = lum / np.maximum(low, 1e-3)
    flat = seamless(flat)
    flat = (flat - flat.mean()) / (flat.std() + 1e-6)
    return np.clip(0.5 + flat * contrast, 0, 1)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    size = 1024
    top = detail(SRC / "top/flux-v1/top.png", size, 0.16)
    cliff = detail(SRC / "cliff/flux-v1/cliff.png", size, 0.17)
    crem = detail(SRC / "crem/flux-v1/crem.png", size, 0.2)
    packed = np.dstack([crem, cliff, top])  # BGR order for OpenCV → RGB = top, cliff, crem
    cv2.imwrite(str(OUT / "terrain-detail.jpg"), (packed * 255).round().astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 88])

    wood = cv2.imread(str(SRC / "wood/flux-v1/wood.png"), cv2.IMREAD_COLOR).astype(np.float32) / 255
    wood = cv2.rotate(wood, cv2.ROTATE_90_CLOCKWISE)  # grain along U
    wood = cv2.resize(wood, (512, 512), interpolation=cv2.INTER_AREA)
    low = cv2.GaussianBlur(wood, (0, 0), 60)
    wood = wood / np.maximum(low, 1e-3) * low.mean(axis=(0, 1))
    wood = seamless(wood)
    cv2.imwrite(str(OUT / "wood.jpg"), (np.clip(wood, 0, 1) * 255).round().astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 88])
    print("wrote", OUT / "terrain-detail.jpg", OUT / "wood.jpg")


if __name__ == "__main__":
    main()
