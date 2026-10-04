"""Render previews of a prop GLB (headless Blender, Cycles on the CPU). Lights exist only here.

usage: python3 tools/props/render_preview.py --glb file.glb --outdir dir [--tag name] [--views front,side,threeq,top,close]
                                              [--focus x,y,z --dist metres] [--samples N] [--size 900] [--night] [--ground y]
Views are named directions around the model's bounding box (glTF axes: +Y up, +Z front); `close` looks at --focus (glTF
coordinates) from --dist metres away, from the front-right. Writes <outdir>/<tag>_<view>.png. A plane of sand lies at --ground
(default: the model's lowest point). `--night` lights it with a dim blue world only, so glowing parts show as they do in the dark.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

A = sys.argv


def opt(name, default):
    return A[A.index(name) + 1] if name in A else default


GLB = opt("--glb", "model.glb")
OUTDIR = opt("--outdir", "/tmp/prop_preview")
VIEWS = opt("--views", "front,side,threeq").split(",")
SAMPLES = int(opt("--samples", "40"))
SIZE = int(opt("--size", "900"))
TAG = opt("--tag", os.path.splitext(os.path.basename(GLB))[0])
NIGHT = "--night" in A
os.makedirs(OUTDIR, exist_ok=True)


def gl(v):
    """glTF coordinates (x, y up, z front) to Blender's (x, -z, y)."""
    return Vector((v[0], -v[2], v[1]))


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
# The glTF importer leaves a vertex colour attribute unused; put it on the base colour, as the game does.
for ob in bpy.data.objects:
    if ob.type != "MESH" or not ob.data.color_attributes:
        continue
    layer = ob.data.color_attributes[0].name
    for slot in ob.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes or mat.name.startswith("Glow"):
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf and not bsdf.inputs["Base Color"].is_linked:
            node = mat.node_tree.nodes.new("ShaderNodeVertexColor")
            node.layer_name = layer
            mat.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
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

lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for ob in bpy.data.objects:
    if ob.type == "MESH":
        for v in ob.data.vertices:
            p = ob.matrix_world @ v.co
            for i in range(3):
                lo[i], hi[i] = min(lo[i], p[i]), max(hi[i], p[i])
centre = (lo + hi) / 2
size = (hi - lo).length
ground_z = float(opt("--ground", lo.z))

if NIGHT:
    for m in bpy.data.materials:
        if m.name.startswith("Glow") and m.use_nodes:
            m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 6.0

bpy.ops.mesh.primitive_plane_add(size=max(30, size * 20), location=(0, 0, ground_z))
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
cam_d.lens = 50

focus = opt("--focus", None)
dist = float(opt("--dist", "0.6"))
dirs = {  # directions from the model to the camera, in glTF axes
    "front": (0.15, 0.10, 1.0), "back": (-0.15, 0.10, -1.0), "side": (1.0, 0.10, 0.12), "threeq": (0.75, 0.35, 0.85),
    "top": (0.05, 1.0, 0.25), "close": (0.55, 0.25, 0.8),
}
for v in VIEWS:
    d = Vector(dirs[v]).normalized()
    if v == "close" and focus:
        target = gl([float(x) for x in focus.split(",")])
        pos = target + gl(d) * dist
        cam_d.lens = 60
    else:
        target = centre
        pos = target + gl(d) * size * 1.35
        cam_d.lens = 50
    cam.location = pos
    cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    sc.render.filepath = os.path.join(OUTDIR, f"{TAG}_{v}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", v)
