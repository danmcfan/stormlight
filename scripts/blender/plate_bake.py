"""Bake the Shardplate's paint mask: one shared 1024 atlas the game colours per fighter.

The game swaps every Plate material for its own by name (so the enemy's bronze and the hit
flash work), so what ships is not colour but a mask of where the paint changes:

  R  ambient occlusion over ~15 cm, the piece's own (deep folds, under lames, inside the
     collar): the game darkens and cools the plate there, the shaded value the concept art has
  G  worn edges: convex edges (a 2 cm bevel normal leaves the surface normal) that nothing
     crowds; the game lifts them toward bright, polished steel
  B  cavities: occlusion over ~5 cm (seams, the root of every trim band, rivets): the game
     tints them with orange plateau dust

The features are wider than the real wear would be: at gameplay distance a centimetre is a
pixel or two, and the concept art paints worn edges and dust as broad strokes.

Each piece is baked against itself only (AO "only local", and bevel only sees its own object),
because the pieces move against each other in game. The UVs come from one Smart UV Project
over every piece together, so they share the atlas without overlapping.
"""
import bmesh
import bpy

SIZE = 1024
SAMPLES = 24


# Only the plate faces carry the mask. Trim tubes, the dark under-layer and the glow would
# otherwise split into thousands of tiny islands and crowd the big plates out of the atlas;
# they all point at one texel in the corner the plate islands leave free, which stays at the
# image's neutral colour (no occlusion, no wear, no dust).
NEUTRAL_UV = (0.995, 0.995)
PLATE_AREA = 0.97


def _unwrap(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name="UVMap")
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    for o in objs:
        bm = bmesh.from_edit_mesh(o.data)
        plate = {i for i, s in enumerate(o.material_slots) if s.material and s.material.name.split(".")[0] == "plate"}
        for f in bm.faces:
            f.select_set(f.material_index in plate)
        bmesh.update_edit_mesh(o.data)
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    for o in objs:
        bm = bmesh.from_edit_mesh(o.data)
        uv = bm.loops.layers.uv.active
        for f in bm.faces:
            for loop in f.loops:
                if f.select:
                    loop[uv].uv = loop[uv].uv * PLATE_AREA
                else:
                    loop[uv].uv = NEUTRAL_UV
        bmesh.update_edit_mesh(o.data)
    bpy.ops.object.mode_set(mode="OBJECT")


def _bake_material(img):
    m = bpy.data.materials.new("plate_mask_bake")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    N = nt.nodes.new
    L = nt.links.new
    out = N("ShaderNodeOutputMaterial")
    emit = N("ShaderNodeEmission")
    L(emit.outputs[0], out.inputs["Surface"])

    ao_big = N("ShaderNodeAmbientOcclusion")
    ao_big.samples, ao_big.only_local = 16, True
    ao_big.inputs["Distance"].default_value = 0.15
    ao_small = N("ShaderNodeAmbientOcclusion")
    ao_small.samples, ao_small.only_local = 16, True
    ao_small.inputs["Distance"].default_value = 0.05

    # Edge: how far the bevel normal turns away from the true normal, scaled up and clamped.
    bevel = N("ShaderNodeBevel")
    bevel.samples = 8
    bevel.inputs["Radius"].default_value = 0.02
    geo = N("ShaderNodeNewGeometry")
    dot = N("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    L(bevel.outputs[0], dot.inputs[0])
    L(geo.outputs["Normal"], dot.inputs[1])
    edge = N("ShaderNodeMath")
    edge.operation = "SUBTRACT"
    edge.inputs[0].default_value = 1.0
    L(dot.outputs["Value"], edge.inputs[1])
    gain = N("ShaderNodeMath")
    gain.operation = "MULTIPLY"
    gain.use_clamp = True
    gain.inputs[1].default_value = 7.0
    L(edge.outputs[0], gain.inputs[0])
    # Convex only: concave creases also bend the bevel normal, but they are occluded.
    convex = N("ShaderNodeMath")
    convex.operation = "MULTIPLY"
    convex.use_clamp = True
    L(gain.outputs[0], convex.inputs[0])
    L(ao_small.outputs["AO"], convex.inputs[1])

    cav0 = N("ShaderNodeMath")
    cav0.operation = "SUBTRACT"
    cav0.inputs[0].default_value = 1.0
    L(ao_small.outputs["AO"], cav0.inputs[1])
    cav = N("ShaderNodeMath")          # broadened: dust is a smudge, not a hairline
    cav.operation = "MULTIPLY"
    cav.use_clamp = True
    cav.inputs[1].default_value = 1.8
    L(cav0.outputs[0], cav.inputs[0])

    comb = N("ShaderNodeCombineColor")
    L(ao_big.outputs["AO"], comb.inputs[0])
    L(convex.outputs[0], comb.inputs[1])
    L(cav.outputs[0], comb.inputs[2])
    L(comb.outputs[0], emit.inputs["Color"])

    tex = N("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    return m


def bake_mask(objs, path):
    """UV-unwrap `objs` into one atlas, bake the mask to `path` (JPEG), leave the UVs on them."""
    _unwrap(objs)
    img = bpy.data.images.new("plate_mask", SIZE, SIZE, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.generated_color = (1.0, 0.0, 0.0, 1.0)     # unbaked texels: no occlusion, no wear, no dust
    mat = _bake_material(img)
    saved = {o: [s.material for s in o.material_slots] for o in objs}
    for o in objs:
        for s in o.material_slots:
            s.material = mat
    sc = bpy.context.scene
    engine = sc.render.engine
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type="EMIT")
    for o, mats in saved.items():
        for s, m in zip(o.material_slots, mats):
            s.material = m
    bpy.data.materials.remove(mat)
    sc.render.engine = engine
    path.parent.mkdir(parents=True, exist_ok=True)
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.quality = 85
    img.filepath_raw = str(path)
    img.save_render(str(path), scene=sc)
    print(f"baked {path.name} ({SIZE}x{SIZE}) for {len(objs)} pieces")
