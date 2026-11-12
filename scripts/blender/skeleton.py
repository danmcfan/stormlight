"""The game skeleton, read from src/render/humanoid.ts so the Blender scripts can't drift from it.

Body space: metres, +Y up, +Z forward, +X = the character's left.
"""
import re

from lib import ROOT

_src = (ROOT / "src/render/humanoid.ts").read_text()


def _num(name):
    m = re.search(rf"const {name} = (-?[\d.]+);", _src)
    if not m:
        raise SystemExit(f"humanoid.ts: no constant {name}")
    return float(m.group(1))


HIP_Y = _num("HIP_Y")
WAIST_Y = _num("WAIST_Y")
UPPER_ARM = _num("UPPER_ARM")
LOWER_ARM = _num("LOWER_ARM")
THIGH = _num("THIGH")
SHIN = _num("SHIN")
HELM_Y = _num("HELM_Y")            # from the waist
LEG_X = _num("LEG_X")
FAULD_FRONT_Z = _num("FAULD_FRONT_Z")
FAULD_BACK_Z = _num("FAULD_BACK_Z")
_m = re.search(r"const SHOULDER = new THREE\.Vector3\((-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\);", _src)
SHOULDER = (float(_m.group(1)), float(_m.group(2)))   # (x, y) from the waist
FAULD_Y = _num("FAULD_Y")
TASSET_X = _num("TASSET_X")
TASSET_Y = _num("TASSET_Y")
