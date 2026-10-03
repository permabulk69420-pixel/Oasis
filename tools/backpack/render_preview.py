"""Render previews of the exported backpack GLB (headless Blender, Cycles on the CPU). Lights exist only here.

usage: python3 tools/backpack/render_preview.py [--glb file.glb] [--outdir dir] [--views threeq,front,back,side,top,flap,hand]
                                                [--samples N] [--scale 1.0] [--tag name] [--night]
Writes <outdir>/pack_<tag>_<view>.png. The pack stands on a plane of sand at y = 0. `--night` lights it with a dim
blue world only, so the glow shows the way it would in the game's dark.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

A = sys.argv


def opt(name, default):
    return A[A.index(name) + 1] if name in A else default


GLB = opt("--glb", "public/models/backpack/backpack.glb")
OUTDIR = opt("--outdir", "/tmp/pack_preview")
VIEWS = opt("--views", "threeq,front,back,side").split(",")
SAMPLES = int(opt("--samples", "48"))
SCALE = float(opt("--scale", "1.0"))
TAG = opt("--tag", "pack")
NIGHT = "--night" in A
os.makedirs(OUTDIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
try:
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
except Exception:
    pass
sc.cycles.max_bounces = 4
sc.view_settings.view_transform = "AgX"

for ob in bpy.data.objects:  # the glTF importer's empties and bone shapes are not part of the model
    if ob.type == "MESH" and ob.name not in ("Backpack", "CarryHandle"):
        ob.hide_render = True

# strengthen the glow for the night view, as the game does
if NIGHT:
    for m in bpy.data.materials:
        if m.name.startswith("Glow") and m.use_nodes:
            m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 6.0

bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -0.001))
ground = bpy.context.active_object
gm = bpy.data.materials.new("Sand")
gm.use_nodes = True
gb = gm.node_tree.nodes["Principled BSDF"]
gb.inputs["Base Color"].default_value = (0.42, 0.28, 0.16, 1)
gb.inputs["Roughness"].default_value = 1.0
ground.data.materials.append(gm)

world = bpy.data.worlds.new("W")
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.03, 0.05, 0.10, 1) if NIGHT else (0.55, 0.68, 0.85, 1)
bg.inputs["Strength"].default_value = 0.6 if NIGHT else 0.9
if not NIGHT:
    sun_d = bpy.data.lights.new("Sun", "SUN")
    sun_d.energy = 3.2
    sun_d.color = (1.0, 0.94, 0.85)
    sun = bpy.data.objects.new("Sun", sun_d)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sc.collection.objects.link(sun)

cam_d = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
cam_d.lens = 45

centre = Vector((0, 0, 0.27))  # Blender is Z-up; after import the pack's front (glTF +Z) faces Blender -Y
views = {  # camera offsets from the middle of the pack (x = its left, -y = in front of it, z = up)
    "threeq": (Vector((0.95, -1.15, 0.45)), (1100, 1000), centre),
    "front": (Vector((0.0, -1.5, 0.30)), (900, 1000), centre),
    "back": (Vector((0.25, 1.5, 0.35)), (900, 1000), centre),
    "side": (Vector((1.5, 0.0, 0.25)), (900, 1000), centre),
    "top": (Vector((0.0, -0.25, 1.6)), (1000, 800), centre),
    "flap": (Vector((0.35, -0.60, 0.50)), (1100, 800), Vector((0, -0.05, 0.36))),
    "low": (Vector((0.7, -0.9, 0.12)), (1100, 800), Vector((0, 0, 0.22))),
}
for v in VIEWS:
    offset, res, target = views[v]
    cam.location = target + offset if v != "threeq" else centre + offset
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    sc.render.resolution_x, sc.render.resolution_y = int(res[0] * SCALE), int(res[1] * SCALE)
    sc.render.filepath = os.path.join(OUTDIR, f"pack_{TAG}_{v}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", v)
