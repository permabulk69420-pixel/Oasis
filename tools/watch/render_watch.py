"""Renders of the survival watch on the left hand (headless Blender, Cycles), to check the model.

    python3 tools/watch/render_watch.py outdir

Writes face.png (looking down at the display), side.png (from the thumb side), under.png (the buckle) and three_quarter.png.
The display shows a stand-in pattern here (in the game it is a live canvas).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
out = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else '.'
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'public', 'models', 'hands', 'LeftHand.glb'))
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'public', 'models', 'watch', 'survival_watch.glb'))
for ob in list(bpy.context.scene.objects):
    if ob.type == 'MESH' and ob.name.lower().startswith('icosphere'):
        bpy.data.objects.remove(ob)
# a skin colour for the hand (its file's material is plain)
for ob in bpy.context.scene.objects:
    if ob.type == 'MESH' and ob.name.lower().startswith('lefthand'):
        m = bpy.data.materials.new('skin'); m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.75, 0.55, 0.45, 1)
        ob.data.materials.clear(); ob.data.materials.append(m)
# the screen: a stand-in pattern (bars) so its placement and orientation show
img = bpy.data.images.new('screen', 128, 128)
px = []
for y in range(128):
    for x in range(128):
        v = y / 127
        on = (0.15 < x / 127 < 0.85) and any(abs(v - c) < 0.04 for c in (0.62, 0.48, 0.34, 0.2)) and x / 127 < 0.15 + 0.7 * (0.9 - v)
        top = v > 0.78 and 0.3 < x / 127 < 0.7
        r, g, b = ((0.3, 1.0, 0.5) if on else (0.9, 0.95, 1.0) if top else (0.01, 0.02, 0.03))
        px += [r, g, b, 1]
img.pixels = px
for m in bpy.data.materials:
    if m.name.startswith('Watch_Screen'):
        nt = m.node_tree
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
        b = nt.nodes['Principled BSDF']
        nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.device = 'CPU'
scene.render.resolution_x, scene.render.resolution_y = 720, 540
world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.4, 0.45, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scene.collection.objects.link(sun)
sun.data.energy = 3.5; sun.rotation_euler = (math.radians(40), math.radians(25), math.radians(30))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.lens = 50
target = Vector((0.0, -0.005, 0.02))
for name, eye in (('face', (-0.0, -0.01, 0.26)), ('side', (0.25, -0.03, 0.06)), ('under', (0.02, -0.06, -0.24)), ('three_quarter', (0.13, -0.17, 0.16))):
    cam.location = Vector(eye)
    d = target - cam.location
    up = Vector((-1, 0, 0)) if name == 'face' else Vector((0, 0, 1))
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if name == 'face':
        # 12 o'clock (-X) at the top of the picture
        cam.rotation_euler = (0, 0, math.radians(90))
    scene.render.filepath = os.path.join(out, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', scene.render.filepath)
