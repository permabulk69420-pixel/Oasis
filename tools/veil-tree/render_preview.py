"""Re-import the exported GLB into an empty scene and render previews (lights exist only here)."""
import math
import sys

import bpy
from mathutils import Vector

GLB = "/home/claude/veil/veil_tree.glb"
OUTDIR = "/home/claude/veil/"
which = sys.argv[sys.argv.index("--views") + 1].split(",") if "--views" in sys.argv else ["far_day", "under_night", "far_night", "mid_day"]
SAMPLES = int(sys.argv[sys.argv.index("--samples") + 1]) if "--samples" in sys.argv else 24
RES = (960, 540)

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
sc.cycles.transparent_max_bounces = 12
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.film_transparent = False
sc.view_settings.view_transform = "AgX"

# sand ground
bpy.ops.mesh.primitive_plane_add(size=1200, location=(0, 0, 0))
ground = bpy.context.active_object
gm = bpy.data.materials.new("Sand")
gm.use_nodes = True
gb = gm.node_tree.nodes["Principled BSDF"]
gb.inputs["Base Color"].default_value = (0.42, 0.30, 0.18, 1)
gb.inputs["Roughness"].default_value = 1.0
ground.data.materials.append(gm)

world = bpy.data.worlds.new("W")
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]

sun_data = bpy.data.lights.new("Sun", "SUN")
sun = bpy.data.objects.new("Sun", sun_data)
sc.collection.objects.link(sun)

glow = bpy.data.materials.get("Glow")


def set_glow(strength):
    if glow is None:
        return
    for n in glow.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            n.inputs["Emission Strength"].default_value = strength


def look(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
cam_data.clip_end = 3000


def day():
    bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
    bg.inputs["Strength"].default_value = 0.9
    sun_data.energy = 4.0
    sun_data.color = (1.0, 0.95, 0.85)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    set_glow(1.0)


def night():
    bg.inputs["Color"].default_value = (0.012, 0.018, 0.04, 1)
    bg.inputs["Strength"].default_value = 1.0
    sun_data.energy = 0.10
    sun_data.color = (0.6, 0.7, 1.0)
    sun.rotation_euler = (math.radians(35), 0, math.radians(-60))
    set_glow(1.6)   # what the game would do at night


views = {
    "far_day": (day, (0, -300, 22), (0, 0, 40), 30),
    "mid_day": (day, (95, -120, 14), (0, 0, 36), 26),
    "far_night": (night, (0, -170, 18), (0, 0, 32), 32),
    "under_night": (night, (13, -15, 1.7), (-2, 4, 14), 18),
}
for name in which:
    fn, loc, tgt, lens = views[name]
    fn()
    cam.location = loc
    cam_data.lens = lens
    look(cam, tgt)
    sc.render.filepath = OUTDIR + f"prev_{name}.png"
    bpy.ops.render.render(write_still=True)
    print("rendered", name)
