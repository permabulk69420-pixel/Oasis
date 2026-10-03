"""Re-import the exported campfire GLB into an empty scene and render previews (lights exist only here).

usage: python3 tools/campfire/render_preview.py [--glb file.glb] [--outdir dir] [--views front,top,low] [--look night,day]
                                                [--samples N] [--scale 1.0] [--hide-embers]
Writes <outdir>/campfire_<view>_<look>.png.  'night' = dusk sky + warm fire light at FlameAnchor + glowing embers
(what the game does when lit); 'day' = neutral sun, for judging form.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

A = sys.argv


def opt(name, default):
    return A[A.index(name) + 1] if name in A else default


GLB = opt("--glb", "public/models/campfire/campfire.glb")
OUTDIR = opt("--outdir", "/tmp/campfire_preview")
VIEWS = opt("--views", "front,top,low").split(",")
LOOKS = opt("--look", "night,day").split(",")
SAMPLES = int(opt("--samples", "40"))
SCALE = float(opt("--scale", "1.0"))
HIDE_EMBERS = "--hide-embers" in A
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
sc.cycles.max_bounces = 5
sc.render.film_transparent = False
sc.view_settings.view_transform = "AgX"

anchor = bpy.data.objects.get("FlameAnchor")
anchor_pos = anchor.matrix_world.translation.copy() if anchor else Vector((0, 0, 0.14))
if HIDE_EMBERS and bpy.data.objects.get("Embers"):
    bpy.data.objects["Embers"].hide_render = True

# dry dusty ground, slightly bumpy so contact reads
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
ground = bpy.context.active_object
gm = bpy.data.materials.new("Sand")
gm.use_nodes = True
gb = gm.node_tree.nodes["Principled BSDF"]
gb.inputs["Base Color"].default_value = (0.30, 0.215, 0.13, 1)
gb.inputs["Roughness"].default_value = 1.0
ground.data.materials.append(gm)

world = bpy.data.worlds.new("W")
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]

sun_d = bpy.data.lights.new("Sun", "SUN")
sun = bpy.data.objects.new("Sun", sun_d)
sc.collection.objects.link(sun)
fire_d = bpy.data.lights.new("Fire", "POINT")
fire_d.shadow_soft_size = 0.08
fire = bpy.data.objects.new("Fire", fire_d)
fire.location = anchor_pos + Vector((0, 0, 0.04))
sc.collection.objects.link(fire)

# stand-in flame so the logs are lit like in game (preview only)
bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.06, radius2=0.0, depth=0.30, location=anchor_pos + Vector((0, 0, 0.13)))
flame = bpy.context.active_object
fm = bpy.data.materials.new("FlamePreview")
fm.use_nodes = True
fb = fm.node_tree.nodes["Principled BSDF"]
fb.inputs["Base Color"].default_value = (0.02, 0.01, 0.0, 1)
fb.inputs["Emission Color"].default_value = (1.0, 0.45, 0.08, 1)
fb.inputs["Emission Strength"].default_value = 6.0
flame.data.materials.append(fm)

cam_d = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam


def look_at(target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def night():
    bg.inputs["Color"].default_value = (0.020, 0.030, 0.065, 1)
    bg.inputs["Strength"].default_value = 1.0
    sun_d.energy = 0.25
    sun_d.color = (0.55, 0.65, 1.0)
    sun.rotation_euler = (math.radians(55), 0, math.radians(-50))
    fire_d.energy = 55.0
    fire_d.color = (1.0, 0.48, 0.16)
    flame.hide_render = False
    flame.visible_camera = False


def day():
    bg.inputs["Color"].default_value = (0.55, 0.65, 0.80, 1)
    bg.inputs["Strength"].default_value = 0.8
    sun_d.energy = 3.5
    sun_d.color = (1.0, 0.94, 0.85)
    sun.rotation_euler = (math.radians(52), 0, math.radians(30))
    fire_d.energy = 0.0
    flame.hide_render = True


views = {
    "front": ((0.95, -1.10, 0.62), (0, 0, 0.17), 38, (1280, 800)),
    "top": ((0.0, 0.001, 1.75), (0, 0, 0.0), 40, (1000, 1000)),
    "low": ((0.78, -0.18, 0.13), (0, 0, 0.16), 32, (1280, 800)),
}
for look in LOOKS:
    (night if look == "night" else day)()
    for v in VIEWS:
        loc, tgt, lens, res = views[v]
        cam.location = loc
        cam_d.lens = lens
        sc.render.resolution_x, sc.render.resolution_y = int(res[0] * SCALE), int(res[1] * SCALE)
        look_at(tgt)
        sc.render.filepath = os.path.join(OUTDIR, f"campfire_{v}_{look}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered", v, look)
