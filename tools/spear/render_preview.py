"""Render previews of the exported spear GLB (headless Blender, Cycles on the CPU). Lights exist only here.

usage: python3 tools/spear/render_preview.py [--glb file.glb] [--outdir dir] [--views full,head,headside,tassel,grip,butt,threeq]
                                             [--samples N] [--scale 1.0] [--tag name] [--night]
Writes <outdir>/spear_<tag>_<view>.png. The spear stands in a plane of sand with its butt at the ground (z = -0.52 about the
grip origin). `--night` lights it with a dim blue world only, so the glow shows the way it would in the game's dark.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

A = sys.argv


def opt(name, default):
    return A[A.index(name) + 1] if name in A else default


GLB = opt("--glb", "public/models/spear/spear.glb")
OUTDIR = opt("--outdir", "/tmp/spear_preview")
VIEWS = opt("--views", "full,head,tassel,grip").split(",")
SAMPLES = int(opt("--samples", "48"))
SCALE = float(opt("--scale", "1.0"))
TAG = opt("--tag", "spear")
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

for ob in bpy.data.objects:  # the glTF importer's empties are not part of the model
    if ob.type == "MESH" and ob.name not in ("Spear", "Shaft"):
        ob.hide_render = True

# strengthen the glow for the night view, as the game does
if NIGHT:
    for m in bpy.data.materials:
        if m.name.startswith("Glow") and m.use_nodes:
            m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 6.0

bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -0.52))
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

# Blender is Z-up; after import the spear's +Y (up the shaft) is +Z, its front (glTF +Z, a broad face of the stone) faces -Y
# and the tassel hangs on the +Y side. Each view: camera position, resolution, target, lens (mm).
views = {
    "full": (Vector((0.9, -3.6, 0.25)), (800, 1250), Vector((0, 0, 0.2)), 50),
    "back": (Vector((-0.9, 3.6, 0.25)), (800, 1250), Vector((0, 0, 0.2)), 50),
    "threeq": (Vector((1.5, -1.9, 0.55)), (1000, 1000), Vector((0, 0, 0.30)), 50),
    "head": (Vector((0.32, -0.62, 0.86)), (1100, 900), Vector((0, 0, 0.80)), 60),
    "headside": (Vector((0.65, 0.0, 0.84)), (900, 900), Vector((0, 0, 0.80)), 60),
    "headback": (Vector((-0.30, 0.62, 0.80)), (1100, 900), Vector((0, 0, 0.74)), 60),
    "tassel": (Vector((0.22, 0.52, 0.62)), (1000, 900), Vector((0, 0.02, 0.56)), 60),
    "grip": (Vector((0.42, -0.55, 0.12)), (1000, 900), Vector((0, 0, 0.0)), 55),
    "butt": (Vector((0.36, -0.52, -0.30)), (1000, 900), Vector((0, 0, -0.45)), 55),
}
for v in VIEWS:
    pos, res, target, lens = views[v]
    cam_d.lens = lens
    cam.location = pos
    cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
    sc.render.resolution_x, sc.render.resolution_y = int(res[0] * SCALE), int(res[1] * SCALE)
    sc.render.filepath = os.path.join(OUTDIR, f"spear_{TAG}_{v}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", v)
