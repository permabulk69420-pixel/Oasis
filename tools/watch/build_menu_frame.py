"""The watch menu's frame, built in headless Blender (bpy module), from the owner's note on 6 Oct: the menu should look like part of the watch.

    python3 tools/watch/build_menu_frame.py

Writes public/models/watch/watch_menu_frame.glb: the watch's case, scaled up round the menu's screen. The same gunmetal and steel, the same stepped
bezel with grip teeth along its edges and cyan marks at 12, 3, 6 and 9, a crown with a cyan end at 3 o'clock, a cyan inlay along the bottom flank, and a
dark back plate so the screen reads as solid. Origin at the screen's centre, the screen facing +Z (glTF), +Y up, sized for src/survivor-menu.js's panel
(0.64 x 0.40 m): its opening is the panel less a 4.5 mm lip all round, so the canvas's edges sit under the bezel. About 2.5k triangles, no textures.
"""
import math
import os

import bpy
import bmesh  # (after bpy: the module registers it)
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'models', 'watch', 'watch_menu_frame.glb')
PANEL = (0.64, 0.40)                    # the menu panel (src/survivor-menu.js PANEL_WIDTH_METRES and its 1280 x 800 canvas)
HX, HY = PANEL[0] / 2 + 0.018, PANEL[1] / 2 + 0.018     # the case's outer half size
R = 0.040                               # its corner radius
LIP = 0.0225                            # the opening is this far inside the outer edge (the panel's edge hides 4.5 mm under it)

bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes['Principled BSDF'] if m.node_tree else None
    if b is None:
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


# the watch's own materials (tools/watch/build_watch.py), under the menu's names
M_METAL = material('Menu_Metal', (0.055, 0.06, 0.066), metallic=0.9, roughness=0.34)
M_STEEL = material('Menu_Steel', (0.32, 0.34, 0.36), metallic=1.0, roughness=0.28)
M_GLOW = material('Menu_Glow', (0.12, 0.55, 0.6), roughness=0.4, emission=(0.35, 0.95, 1.0), strength=2.0)
M_BACK = material('Menu_Back', (0.012, 0.03, 0.034), roughness=0.6)


def new_object(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for m in mats:
        me.materials.append(m)
    return ob


def loft(bm, rings, closed=True, cap_start=False, cap_end=False, smooth=True):
    vrings = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for a, b in zip(vrings, vrings[1:]):
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.smooth = smooth
    for flag, r, rev in ((cap_start, vrings[0], True), (cap_end, vrings[-1], False)):
        if flag:
            f = bm.faces.new(list(reversed(r)) if rev else r)
            f.smooth = False
    return vrings


def rounded_rect(hx, hy, r, z, seg=8):
    r = max(1e-5, min(r, hx, hy))
    pts = []
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        ox, oy = sx * (hx - r), sy * (hy - r)
        a0 = k * math.pi / 2
        for i in range(seg + 1):
            a = a0 + (math.pi / 2) * i / seg
            pts.append(Vector((ox + r * math.cos(a), oy + r * math.sin(a), z)))
    return pts


def ring(inset, z):
    return rounded_rect(HX - inset, HY - inset, R - inset * 0.8, z)


# ---- the case: modelled facing +Z here (the screen's normal), turned to glTF's frame at the end. (inset from the outer edge, height)
profile = [(0.004, -0.012), (0.0, -0.008), (0.0, 0.004), (0.0015, 0.0075), (0.004, 0.0088),       # the body and its bevel
           (0.0062, 0.0096),                                                                     # a step up to the bezel
           (0.0085, 0.0116), (0.0150, 0.0116), (0.0180, 0.0090),                                 # the bezel ring
           (0.0210, 0.0035), (LIP, 0.0012)]                                                      # down to the screen
bm = bmesh.new()
loft(bm, [ring(i, z) for i, z in profile])
case = new_object('Menu_Case', bm, [M_METAL])
# the back: a dark plate behind the screen, and the case's back face
bm = bmesh.new()
loft(bm, [ring(0.004, -0.012), ring(LIP - 0.002, -0.004)], cap_end=True)
back = new_object('Menu_Back', bm, [M_BACK])

# ---- grip teeth on the bezel's straight edges, cyan marks at the middle of each edge
bm = bmesh.new()
glow = bmesh.new()


def block(target, c, along, w, depth, z0, z1, smooth=False):
    across = Vector((-along.y, along.x, 0))
    corners = [c + along * sx * w + across * sy * depth for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    loft(target, [[p + Vector((0, 0, z0)) for p in corners], [p + Vector((0, 0, z1)) for p in corners]], cap_end=True, smooth=smooth)


mid_inset = 0.0118
for (axis, half, count) in ((Vector((1, 0, 0)), HX - R, 9), (Vector((0, 1, 0)), HY - R, 5)):
    for side in (-1, 1):
        normal = Vector((axis.y, axis.x, 0)) * side         # the edge's outward direction
        edge_c = normal * ((HY if axis.x else HX) - mid_inset)
        for k in range(count):
            t = -half + 2 * half * (k + 0.5) / count
            if abs(t) < 0.03:
                continue                                     # leave the middle for the cyan mark
            block(bm, edge_c + axis * t, axis, 0.0055, 0.0026, 0.0110, 0.0134)
        block(glow, edge_c, axis, 0.012, 0.0016, 0.0112, 0.0122)
teeth = new_object('Menu_Teeth', bm, [M_METAL])

# a cyan inlay along the bottom flank, as along the watch case's
y = -HY - 0.0003
pts = [Vector((-0.12, y, -0.0012)), Vector((0.12, y, -0.0012)), Vector((0.12, y, 0.0012)), Vector((-0.12, y, 0.0012))]
loft(glow, [pts, [p + Vector((0, -0.0006, 0)) for p in pts]], cap_end=True, smooth=False)

# ---- the crown at 3 o'clock (+X), knurled, with a cyan end, and a steel stem
steel = bmesh.new()
crown = bmesh.new()


def cylinder(target, centre, axis, radius, length, seg=20, knurl=0.0):
    axis = axis.normalized()
    u = axis.orthogonal().normalized()
    v = axis.cross(u)
    rings = []
    for s in (0.0, length):
        r_ = []
        for i in range(seg):
            a = i * math.tau / seg
            rr = radius * (1 + (knurl if i % 2 else 0))
            r_.append(centre + axis * s + (u * math.cos(a) + v * math.sin(a)) * rr)
        rings.append(r_)
    loft(target, rings, cap_end=True, smooth=not knurl)


cz = -0.002
cylinder(steel, Vector((HX - 0.002, 0, cz)), Vector((1, 0, 0)), 0.004, 0.006, seg=16)
cylinder(crown, Vector((HX + 0.003, 0, cz)), Vector((1, 0, 0)), 0.0085, 0.009, seg=32, knurl=0.07)
cylinder(glow, Vector((HX + 0.012, 0, cz)), Vector((1, 0, 0)), 0.0045, 0.0006, seg=20)
for sy in (-1, 1):
    cylinder(steel, Vector((HX - 0.002, sy * 0.05, cz)), Vector((1, 0, 0)), 0.0048, 0.0075, seg=16)
    cylinder(glow, Vector((HX + 0.0055, sy * 0.05, cz)), Vector((1, 0, 0)), 0.003, 0.0006, seg=16)
stem = new_object('Menu_Pushers', steel, [M_STEEL])
crown_ob = new_object('Menu_Crown', crown, [M_METAL])
glow_ob = new_object('Menu_Glow', glow, [M_GLOW])

# ---- turn it into glTF's frame (the screen facing glTF +Z: Blender -Y) and export
root = bpy.data.objects.new('Watch_Menu_Frame', None)
bpy.context.scene.collection.objects.link(root)
turn = Matrix.Rotation(math.radians(90), 4, 'X')
for ob in (case, back, teeth, stem, crown_ob, glow_ob):
    ob.data.transform(turn)
    ob.parent = root
tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in bpy.context.scene.objects if ob.type == 'MESH')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_animations=False, export_normals=True,
                          export_texcoords=False, export_materials='EXPORT')
print('wrote', os.path.relpath(OUT, ROOT), os.path.getsize(OUT) // 1024, 'KB', tris, 'triangles')
