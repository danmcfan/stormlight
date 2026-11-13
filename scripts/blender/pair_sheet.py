"""Pair before/after renders into one sheet: a row per view, before then after.

  .venv-blender/bin/python scripts/blender/pair_sheet.py --dir art/renders/head \
      --views front,side,back,three-quarter --out art/renders/head/pair.png

Labels each panel and adds a caption. Uses whatever `<before>-<view>.png` and
`<after>-<view>.png` exist in the directory, so it works for any piece.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--views", default="front,side,back,three-quarter")
ap.add_argument("--before", default="before")
ap.add_argument("--after", default="after")
ap.add_argument("--out", default=None)
ap.add_argument("--title", default=None)
args = ap.parse_args()

d = Path(args.dir)
views = [v for v in args.views.split(",")]
rows = []
for v in views:
    b, a = d / f"{args.before}-{v}.png", d / f"{args.after}-{v}.png"
    if b.exists() and a.exists():
        rows.append((v, Image.open(b).convert("RGB"), Image.open(a).convert("RGB")))
if not rows:
    raise SystemExit(f"no {args.before}/{args.after} pairs in {d}")

W, H = rows[0][1].size
PAD, LABEL = 10, 26
TITLE = 40 if args.title else 0
sheet = Image.new(
    "RGB",
    (2 * W + PAD * 3, TITLE + len(rows) * (H + LABEL + PAD) + PAD),
    (246, 247, 249),
)
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 18)
    small = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 14)
except OSError:
    font = small = ImageFont.load_default()

if args.title:
    draw.text((PAD * 2, 10), args.title, fill=(25, 30, 36), font=font)

for i, (view, b, a) in enumerate(rows):
    y = TITLE + PAD + i * (H + LABEL + PAD)
    for j, (im, tag) in enumerate(((b, args.before), (a, args.after))):
        x = PAD + j * (W + PAD)
        sheet.paste(im.resize((W, H)), (x, y + LABEL))
        draw.text((x + 2, y + 4), f"{tag} — {view}", fill=(70, 78, 88), font=small)

out = Path(args.out) if args.out else d / f"{args.before}-vs-{args.after}.png"
sheet.save(out)
print(f"{out}  ({sheet.width}x{sheet.height})")
