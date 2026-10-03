"""Render previews of the alien tree GLBs (headless Blender, Cycles on the CPU). Lights exist only here.

usage: python3 tools/alien-tree/render_preview.py [--dir public/models/vegetation/alien-tree] [--outdir dir]
                                                  [--views lods,lodsabove,threeq,below,crown,base,side] [--samples N] [--scale 1.0] [--tag name]
Writes <outdir>/tree_<tag>_<view>.png. `lods` lays the three levels of detail side by side (LOD0, LOD1, LOD2 from the left); the
other views show LOD0 alone. The tree stands on a plane of grass-and-sand coloured ground with a pale sky.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

A = sys.argv


def opt(name, default):
    return A[A.index(name) + 1] if name in A else default


DIR = opt("--dir", "public/models/vegetation/alien-tree")
OUTDIR = opt("--outdir", "/tmp/tree_preview")
VIEWS = opt("--views", "lods,threeq,below,crown").split(",")
SAMPLES = int(opt("--samples", "40"))
SCALE = float(opt("--scale", "1.0"))
TAG = opt("--tag", "tree")
os.makedirs(OUTDIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
try:
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
except Exception:
    pass
sc.cycles.max_bounces = 6
sc.cycles.transparent_max_bounces = 8
sc.view_settings.view_transform = "AgX"

SPACING = 4.2
for level in range(3):
    path = os.path.join(DIR, f"alien_tree_lod{level}.glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.type == "MESH":
            o.location.x += level * SPACING   # glTF +X stays +X; the importer turns glTF +Y into +Z
            o.name = f"LOD{level}"
        else:
            o.hide_render = True
    if level > 0:
        for o in new:
            o.hide_render = True              # shown only by the 'lods' view
    for o in new:
        o["lod"] = level

bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.02))
ground = bpy.context.active_object
gm = bpy.data.materials.new("Ground")
gm.use_nodes = True
gb = gm.node_tree.nodes["Principled BSDF"]
gb.inputs["Base Color"].default_value = (0.10, 0.22, 0.06, 1)
gb.inputs["Roughness"].default_value = 1.0
ground.data.materials.append(gm)

world = bpy.data.worlds.new("W")
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.55, 0.70, 0.88, 1)
bg.inputs["Strength"].default_value = 1.0
sun_d = bpy.data.lights.new("Sun", "SUN")
sun_d.energy = 3.6
sun_d.color = (1.0, 0.95, 0.86)
sun = bpy.data.objects.new("Sun", sun_d)
sun.rotation_euler = (math.radians(48), 0, math.radians(35))
sc.collection.objects.link(sun)

cam_d = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam


def show(levels):
    for o in bpy.data.objects:
        if "lod" in o.keys() and o.type == "MESH":
            o.hide_render = o["lod"] not in levels


# Blender is Z up. Each view: levels shown, camera position, resolution, target, lens (mm).
views = {
    "lods": ([0, 1, 2], Vector((SPACING, -13.5, 2.3)), (1600, 780), Vector((SPACING, 0, 2.15)), 42),
    "lodsabove": ([0, 1, 2], Vector((SPACING, -11.5, 9.5)), (1600, 780), Vector((SPACING, 0, 2.6)), 42),
    "threeq": ([0], Vector((5.2, -6.2, 2.0)), (1000, 1100), Vector((0, 0, 2.3)), 45),
    "side": ([0], Vector((0, -9.0, 2.3)), (900, 1100), Vector((0, 0, 2.25)), 45),
    "below": ([0], Vector((1.2, -2.6, 0.5)), (1100, 900), Vector((0, 0, 3.4)), 34),
    "crown": ([0], Vector((2.6, -3.4, 3.8)), (1100, 900), Vector((0, 0, 3.2)), 50),
    "base": ([0], Vector((1.3, -1.7, 0.75)), (1000, 900), Vector((0, 0, 0.6)), 50),
}
for v in VIEWS:
    levels, pos, res, target, lens = views[v]
    show(levels)
    cam_d.lens = lens
    cam.location = pos
    cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
    sc.render.resolution_x, sc.render.resolution_y = int(res[0] * SCALE), int(res[1] * SCALE)
    sc.render.filepath = os.path.join(OUTDIR, f"tree_{TAG}_{v}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", v)
