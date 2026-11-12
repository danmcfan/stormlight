"""Shared helpers for headless Blender scripts (run with .venv-blender/bin/python).

Conventions (see docs/3d-pipeline.md):
- Blender is Z-up; glTF export converts to Y-up (Blender +Z -> glTF +Y,
  Blender -Y -> glTF +Z, Blender +X -> glTF +X).
- One metre = one unit. Game-facing GLBs go to public/models/ (Git LFS).
- Preview renders use Cycles on the CPU (EEVEE needs a GPU this container lacks).
"""
import math
import pathlib

import bpy
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[2]


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name: str, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = roughness
    if emission:
        p.inputs["Emission Color"].default_value = (*emission, 1)
        p.inputs["Emission Strength"].default_value = strength
    return m


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def apply_transforms(obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def export_glb(path: pathlib.Path, objects) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_materials="EXPORT",
    )
    print(f"exported {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


def render_views(out_prefix: pathlib.Path, views, size=(1200, 600), samples=48) -> list[pathlib.Path]:
    """Render named views: each is (name, camera location, look-at point, ortho scale or None)."""
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.render.resolution_x, s.render.resolution_y = size
    s.render.film_transparent = False
    world = bpy.data.worlds.new("preview") if not s.world else s.world
    s.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    bg.inputs["Strength"].default_value = 1.0
    # Sky-to-ground gradient so metal has something to reflect.
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[0].color = (0.32, 0.24, 0.18, 1)   # warm ground
    ramp.color_ramp.elements[1].position = 0.62
    ramp.color_ramp.elements[1].color = (0.75, 0.86, 1.0, 1)    # pale sky
    mid = ramp.color_ramp.elements.new(0.5)
    mid.color = (0.95, 0.93, 0.88, 1)                          # bright horizon
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.inputs["From Min"].default_value = -1
    rng.inputs["From Max"].default_value = 1
    nt.links.new(coord.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], rng.inputs["Value"])
    nt.links.new(rng.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    if "preview_key" not in bpy.data.objects:
        for name, loc, energy in (("preview_key", (2, -3, 4), 900), ("preview_fill", (-3, 2, 2), 350), ("preview_rim", (0, 4, -1), 500)):
            light = bpy.data.lights.new(name, "AREA")
            light.energy = energy
            light.size = 2.5
            o = link(bpy.data.objects.new(name, light))
            o.location = loc
            o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam_data = bpy.data.cameras.new("preview_cam")
    cam = link(bpy.data.objects.new("preview_cam", cam_data))
    s.camera = cam
    out = []
    for name, loc, target, ortho in views:
        cam.location = loc
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        if ortho:
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = ortho
        else:
            cam_data.type = "PERSP"
            cam_data.lens = 50
        path = out_prefix.parent / f"{out_prefix.name}-{name}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        s.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        out.append(path)
    bpy.data.objects.remove(cam)
    return out


def deg(d: float) -> float:
    return math.radians(d)
