"""Render previews of an exported bird GLB (headless Blender, Cycles on the CPU). Lights exist only here.

usage: python3 tools/bird/render_preview.py [--glb file.glb] [--outdir dir] [--views side,threeq,top,front,back]
                                            [--samples N] [--scale 1.0] [--tag name]
Writes <outdir>/bird_<tag>_<view>.png. The bird is shown in its bind pose (wings spread, legs down, standing on a
plane at its feet), which is what the model looks like before the game folds and flaps it.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

A = sys.argv


def opt(name, default):
    return A[A.index(name) + 1] if name in A else default


GLB = opt("--glb", "public/models/creatures/alien_bird_lod0.glb")
OUTDIR = opt("--outdir", "/tmp/bird_preview")
VIEWS = opt("--views", "side,threeq,top,front").split(",")
SAMPLES = int(opt("--samples", "32"))
SCALE = float(opt("--scale", "1.0"))
TAG = opt("--tag", os.path.splitext(os.path.basename(GLB))[0].replace("alien_bird_", ""))
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

# find the lowest point of the bird to set the ground plane there. The glTF importer also adds little shapes for
# drawing the bones; they are not part of the bird, so only skinned meshes count and the rest are hidden.
low = 1e9
for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    if not any(m.type == "ARMATURE" for m in ob.modifiers):
        ob.hide_render = True
        ob.hide_viewport = True
        continue
    for v in ob.data.vertices:
        low = min(low, (ob.matrix_world @ v.co).z)

bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, low - 0.002))
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
bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
bg.inputs["Strength"].default_value = 0.9

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
cam_d.lens = 38

centre = Vector((0, 0, low + 0.42))  # the middle of the standing bird (Blender is Z-up; the bird faces -Y after import)
views = {  # camera offsets from the bird, in Blender axes (x = bird's left, -y = in front of it, z = up)
    "side": (Vector((3.2, -0.15, 0.10)), (1300, 760)),
    "threeq": (Vector((2.2, -2.4, 0.9)), (1300, 860)),
    "top": (Vector((0.001, -0.3, 3.6)), (1100, 1000)),
    "front": (Vector((0.0, -3.4, 0.35)), (1100, 800)),
    "back": (Vector((0.4, 3.4, 0.5)), (1100, 800)),
}
for v in VIEWS:
    offset, res = views[v]
    cam.location = centre + offset
    direction = centre - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    sc.render.resolution_x, sc.render.resolution_y = int(res[0] * SCALE), int(res[1] * SCALE)
    sc.render.filepath = os.path.join(OUTDIR, f"bird_{TAG}_{v}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", v)
