"""The survival watch on the left wrist, built in headless Blender (bpy module), from the owner's note on 6 Oct: a watch on the wrist that you glance at
for health, hunger, water and stamina (a few bars, green to red) and the time of day; tapping it opens the menu.

    python3 tools/watch/build_watch.py

Writes public/models/watch/survival_watch.glb. It is modelled in the left hand's own space (public/models/hands/LeftHand.glb as Blender imports it:
fingers along +Y, the back of the hand +Z, the thumb +X), so in the game it is simply added to the hand model (src/watch.js). Its strap is fitted to
the hand mesh: the wrist's cross-section is read from the hand file and the strap's inside is that plus a margin, so nothing clips. The strap sits over
the end of the hand mesh and a dark sleeve closes it there, so the cut end of the wrist is never seen.

A rugged field watch: a gunmetal cushion case with a stepped bezel (eight grip teeth, cyan marks at 12, 3, 6 and 9), a crown and two pushers at 3
o'clock with cyan tips, a cyan inlay along the case flank, a domed glass, a ribbed rubber strap with a metal buckle and keeper underneath.
The display under the glass is its own mesh (`Watch_Screen`, UVs 0..1 across it, 12 o'clock at v = 1) for the game's live canvas.
Reading it on the left wrist: 12 o'clock is the pinky side (-X), 3 o'clock toward the fingers (+Y). About 5k triangles, no textures.
"""
import math
import os

import bpy
import bmesh  # (after bpy: the module registers it)
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
HAND = os.path.join(ROOT, 'public', 'models', 'hands', 'LeftHand.glb')
OUT = os.path.join(ROOT, 'public', 'models', 'watch', 'survival_watch.glb')

# ---- the wrist, from the hand mesh
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=HAND)
hand = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.lower().startswith('lefthand'))
hand_pts = [hand.matrix_world @ v.co for v in hand.data.vertices]
STRAP_Y = (-0.0225, 0.0)                       # the strap's span along the arm: over the end of the hand mesh (it stops at y = -0.016)
YC = sum(STRAP_Y) / 2
ring = [p for p in hand_pts if STRAP_Y[0] - 0.002 <= p.y <= STRAP_Y[1] + 0.0015]
X0 = (min(p.x for p in ring) + max(p.x for p in ring)) / 2
Z0 = (min(p.z for p in ring) + max(p.z for p in ring)) / 2
RX0 = (max(p.x for p in ring) - min(p.x for p in ring)) / 2
RZ0 = (max(p.z for p in ring) - min(p.z for p in ring)) / 2
# the strap's shape: a superellipse (a wrist is a rounded box more than an ellipse), grown until every wrist vertex is inside, then the margin
SQ = 2.8
def snorm(dx, dz, rx, rz):
    return (abs(dx / rx) ** SQ + abs(dz / rz) ** SQ) ** (1 / SQ)
def spoint(a, rx, rz):
    c, s = math.cos(a), math.sin(a)
    return math.copysign(abs(c) ** (2 / SQ), c) * rx, math.copysign(abs(s) ** (2 / SQ), s) * rz
def snormal(x, z, rx, rz):
    nx = math.copysign(abs(x / rx) ** (SQ - 1), x) / rx
    nz = math.copysign(abs(z / rz) ** (SQ - 1), z) / rz
    l = math.hypot(nx, nz) or 1.0
    return nx / l, nz / l
grow = max(snorm(p.x - X0, p.z - Z0, RX0, RZ0) for p in ring)
MARGIN = 0.0015
RX, RZ = RX0 * grow + MARGIN, RZ0 * grow + MARGIN
print(f'wrist centre ({X0:.4f}, {Z0:.4f}), strap inside radii {RX:.4f} x {RZ:.4f} (grow {grow:.3f})')
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---- materials
def material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        for attr, value in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
            if hasattr(m, attr):
                try: setattr(m, attr, value)
                except Exception: pass
    return m

M_METAL = material('Watch_Metal', (0.055, 0.06, 0.066), metallic=0.9, roughness=0.34)
M_STEEL = material('Watch_Steel', (0.32, 0.34, 0.36), metallic=1.0, roughness=0.28)
M_STRAP = material('Watch_Strap', (0.034, 0.038, 0.036), roughness=0.78)
M_GLOW = material('Watch_Glow', (0.12, 0.55, 0.6), roughness=0.4, emission=(0.35, 0.95, 1.0), strength=2.0)
M_GLASS = material('Watch_Glass', (0.02, 0.035, 0.04), roughness=0.04, alpha=0.18)
M_SCREEN = material('Watch_Screen', (0.0, 0.0, 0.0), roughness=0.35, emission=(1.0, 1.0, 1.0), strength=1.0)
M_SLEEVE = material('Watch_Sleeve', (0.02, 0.022, 0.022), roughness=0.9)


def new_object(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for m in mats:
        me.materials.append(m)
    return ob


def loft(bm, rings, closed=True, cap_start=False, cap_end=False, mat=0, smooth=True):
    """Faces between consecutive rings (lists of Vectors, the same count). Returns the vertex rings."""
    vrings = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for a, b in zip(vrings, vrings[1:]):
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mat
            f.smooth = smooth
    for flag, r, rev in ((cap_start, vrings[0], True), (cap_end, vrings[-1], False)):
        if flag:
            f = bm.faces.new(list(reversed(r)) if rev else r)
            f.material_index = mat
            f.smooth = False
    return vrings


def rounded_rect(hx, hy, r, z, cx=0.0, cy=0.0, seg=6):
    """A rounded rectangle in XY at height z (counter-clockwise from +X), centre (cx, cy)."""
    r = max(1e-5, min(r, hx, hy))
    pts = []
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        ox, oy = cx + sx * (hx - r), cy + sy * (hy - r)
        a0 = k * math.pi / 2
        for i in range(seg + 1):
            a = a0 + (math.pi / 2) * i / seg
            pts.append(Vector((ox + r * math.cos(a), oy + r * math.sin(a), z)))
    return pts


# ---- the case: a cushion, lofted from rounded rectangles (inset from the case's half size, height)
CASE_H = 0.0205                       # half size (4.1 cm across)
CASE_R = 0.0085                       # corner radius
CZ = Z0 + RZ + 0.0018                 # its underside, just over the strap
CY = YC
case_profile = [(0.0024, CZ), (0.0006, CZ + 0.0012), (0.0, CZ + 0.003), (0.0, CZ + 0.0068), (0.0007, CZ + 0.0083),   # body and its top bevel
                (0.0016, CZ + 0.0089), (0.0021, CZ + 0.0092),                                                       # a step to the bezel
                (0.0024, CZ + 0.0101), (0.0031, CZ + 0.0107), (0.0047, CZ + 0.0107), (0.0053, CZ + 0.0101),           # the bezel ring
                (0.0057, CZ + 0.0092)]                                                                               # down to the glass
bm = bmesh.new()
rings = [rounded_rect(CASE_H - i, CASE_H - i, CASE_R - i * 0.8, z, X0, CY, seg=7) for i, z in case_profile]
loft(bm, rings, cap_start=True)
# the glass seat (a flat ring under the glass edge) closes the top
case = new_object('Watch_Case', bm, [M_METAL])

# bezel teeth: eight small raised blocks on the bezel's straight edges (two each side), and cyan marks at 12, 3, 6 and 9 between them
bm = bmesh.new()
glow = bmesh.new()


def block(target, c, d, w, depth, z0, z1):
    tangent = Vector((-d.y, d.x, 0))
    corners = [c + tangent * sx * w + d * sy * depth for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    loft(target, [[p + Vector((0, 0, z0)) for p in corners], [p + Vector((0, 0, z1)) for p in corners]], cap_end=True, smooth=False)


for k in range(4):
    a = k * math.pi / 2
    d = Vector((round(math.cos(a)), round(math.sin(a)), 0))
    along = Vector((-d.y, d.x, 0))
    edge = Vector((X0, CY, CZ + 0.0104)) + d * (CASE_H - 0.0027)
    for off in (-0.0078, 0.0078):
        block(bm, edge + along * off, d, 0.0013, 0.0012, -0.0004, 0.0009)
    block(glow, Vector((X0, CY, CZ + 0.0107)) + d * (CASE_H - 0.0039), d, 0.0006, 0.0007, -0.0002, 0.00025)
teeth = new_object('Watch_Bezel_Teeth', bm, [M_METAL])

# a cyan inlay along each flank (3 and 9 o'clock sides, the case's +Y and -Y faces), set into the body
for side in (-1, 1):
    y = CY + side * (CASE_H + 0.00025)
    z0, z1 = CZ + 0.0037, CZ + 0.0049
    x0, x1 = X0 - 0.011, X0 + 0.011
    pts = [Vector((x0, y, z0)), Vector((x1, y, z0)), Vector((x1, y, z1)), Vector((x0, y, z1))]
    out = [p + Vector((0, side * 0.0003, 0)) for p in pts]
    loft(glow, [pts, out], cap_end=True, smooth=False)

# ---- the crown and two pushers at 3 o'clock (+Y), each with a cyan tip
bm = bmesh.new()
steel = bmesh.new()


def cylinder(target, centre, axis, radius, length, seg=16, knurl=0.0, cap=True):
    axis = axis.normalized()
    u = axis.orthogonal().normalized()
    v = axis.cross(u)
    rings = []
    for s in (0.0, length):
        ring = []
        for i in range(seg):
            a = i * math.tau / seg
            r = radius * (1 + (knurl if i % 2 else 0))
            ring.append(centre + axis * s + (u * math.cos(a) + v * math.sin(a)) * r)
        rings.append(ring)
    loft(target, rings, cap_end=cap, smooth=not knurl)


crown_z = CZ + 0.0048
cylinder(steel, Vector((X0, CY + CASE_H - 0.0004, crown_z)), Vector((0, 1, 0)), 0.0016, 0.0016, seg=12)            # stem
cylinder(bm, Vector((X0, CY + CASE_H + 0.0012, crown_z)), Vector((0, 1, 0)), 0.0034, 0.0032, seg=24, knurl=0.07)  # crown
cylinder(glow, Vector((X0, CY + CASE_H + 0.0044, crown_z)), Vector((0, 1, 0)), 0.0018, 0.0003, seg=16)          # its cyan end
for sx in (-1, 1):
    px = X0 + sx * 0.0115
    cylinder(steel, Vector((px, CY + CASE_H - 0.0004, crown_z)), Vector((0, 1, 0)), 0.0019, 0.0030, seg=14)
    cylinder(glow, Vector((px, CY + CASE_H + 0.0026, crown_z)), Vector((0, 1, 0)), 0.0012, 0.0003, seg=12)
crown = new_object('Watch_Crown', bm, [M_METAL])
pushers = new_object('Watch_Pushers', steel, [M_STEEL])

# ---- the lugs: two pairs (12 and 6 o'clock, -X and +X), bridging the case to the strap
bm = bmesh.new()
STRAP_W = STRAP_Y[1] - STRAP_Y[0]
for sx in (-1, 1):
    for sy in (-1, 1):
        y = CY + sy * (STRAP_W / 2 + 0.0016)
        xa = X0 + sx * (CASE_H - 0.003)
        xb = X0 + sx * (CASE_H + 0.0045)
        # a tapered lug: wide at the case, curving down toward the strap
        rings = []
        for t in (0.0, 0.5, 1.0):
            x = xa + (xb - xa) * t
            ztop = CZ + 0.0066 - 0.0040 * t * t
            zbot = CZ + 0.0012 - 0.0034 * t
            half = 0.0016 - 0.0005 * t
            rings.append([Vector((x, y - half, zbot)), Vector((x, y + half, zbot)), Vector((x, y + half, ztop)), Vector((x, y - half, ztop))])
        loft(bm, rings, cap_start=True, cap_end=True, smooth=False)
lugs = new_object('Watch_Lugs', bm, [M_METAL])

# ---- the strap: a ribbed rubber band round the wrist's ellipse, its profile rounded at the edges
N = 96
prof = [(-0.5, 0.0), (-0.47, 0.6), (-0.42, 0.9), (-0.30, 1.0), (0.30, 1.0), (0.42, 0.9), (0.47, 0.6), (0.5, 0.0)]   # (across, out) in strap units
THICK = 0.0030
bm = bmesh.new()
rings = []
for i in range(N):
    a = i * math.tau / N
    rib = 1.0 + (0.22 if (i // 2) % 2 == 0 else 0.0)        # raised ribs every other pair of segments (on the outside only)
    ex, ez = spoint(a, RX, RZ)
    nx, nz = snormal(ex, ez, RX, RZ)                       # the outward normal there
    base = Vector((X0 + ex, 0, Z0 + ez))
    ring = []
    for across, out in prof:
        o = out * THICK * rib
        ring.append(Vector((base.x + nx * o, YC + across * STRAP_W, base.z + nz * o)))
    rings.append(ring)
# loft round the ellipse: each profile point's track is a closed loop
vr = [[bm.verts.new(p) for p in r] for r in rings]
m = len(rings[0])
for i in range(N):
    a, b = vr[i], vr[(i + 1) % N]
    for k in range(m):
        k2 = (k + 1) % m
        f = bm.faces.new((a[k], b[k], b[k2], a[k2]))
        f.smooth = True
strap = new_object('Watch_Strap', bm, [M_STRAP])

# the sleeve: a dark cap inside the strap's forearm end, so the cut end of the hand mesh is never seen
bm = bmesh.new()
def sring(rx, rz, y, n=48):
    return [Vector((X0 + spoint(a, rx, rz)[0], y, Z0 + spoint(a, rx, rz)[1])) for a in (i * math.tau / n for i in range(n))]
cap = sring(RX - 0.0001, RZ - 0.0001, STRAP_Y[0] + 0.0001)
inset = sring(RX - 0.0035, RZ - 0.0035, STRAP_Y[0] + 0.0045)      # set back inside the cuff, so it reads as its inside
loft(bm, [cap, inset], cap_end=True)
sleeve = new_object('Watch_Sleeve', bm, [M_SLEEVE])

# ---- the buckle and keeper under the wrist (palm side, -Z)
bm = bmesh.new()
bz = Z0 - RZ - THICK
for (x_c, along, wide, tall) in ((X0 + 0.004, 0.0062, STRAP_W + 0.0034, 0.0022), (X0 - 0.008, 0.0028, STRAP_W + 0.0016, 0.0016)):
    outer = [Vector((x_c - along / 2, YC - wide / 2, 0)), Vector((x_c + along / 2, YC - wide / 2, 0)), Vector((x_c + along / 2, YC + wide / 2, 0)), Vector((x_c - along / 2, YC + wide / 2, 0))]
    loft(bm, [[p + Vector((0, 0, bz + 0.0004)) for p in outer], [p + Vector((0, 0, bz - tall)) for p in outer]], cap_end=True, smooth=False)
buckle = new_object('Watch_Buckle', bm, [M_STEEL])

# ---- the glass (domed) and the screen under it
GH = CASE_H - 0.0057
bm = bmesh.new()
rings = []
for t, dz in ((1.0, 0.0), (0.82, 0.00055), (0.55, 0.0009), (0.25, 0.00105)):
    rings.append(rounded_rect(GH * t, GH * t, max(0.0005, (CASE_R - 0.0046) * t), CZ + 0.0092 + 0.0002 + dz, X0, CY, seg=7))
loft(bm, rings, cap_end=True)
glass = new_object('Watch_Glass', bm, [M_GLASS])

SH = CASE_H - 0.0064                                     # the display's half size (about 2.8 cm across)
bm = bmesh.new()
uv = bm.loops.layers.uv.new('UVMap')
pts = rounded_rect(SH, SH, CASE_R - 0.0052, CZ + 0.0091, X0, CY, seg=7)
centre = bm.verts.new(Vector((X0, CY, CZ + 0.0091)))
vs = [bm.verts.new(p) for p in pts]
for i in range(len(vs)):
    f = bm.faces.new((centre, vs[i], vs[(i + 1) % len(vs)]))
    f.smooth = False
    for loop in f.loops:
        p = loop.vert.co
        # 12 o'clock is -X (up the screen), 3 o'clock +Y (to the right): u runs with +Y, v with -X
        loop[uv].uv = ((p.y - CY) / (2 * SH) + 0.5, -(p.x - X0) / (2 * SH) + 0.5)
screen = new_object('Watch_Screen', bm, [M_SCREEN])
glow_ob = new_object('Watch_Glow', glow, [M_GLOW])

# ---- one root, the glance marker (the display's centre and its outward normal: +Z), export
root = bpy.data.objects.new('Survival_Watch', None)
bpy.context.scene.collection.objects.link(root)
for ob in (case, teeth, crown, pushers, lugs, strap, sleeve, buckle, glass, screen, glow_ob):
    ob.parent = root
face = bpy.data.objects.new('watch_face', None)
face.location = (X0, CY, CZ + 0.0092)
face['role'] = 'the display centre; its +Z (glTF +Y) is the way the face looks'
bpy.context.scene.collection.objects.link(face)
face.parent = root
for ob in bpy.context.scene.objects:
    if ob.type == 'MESH':
        bpy.context.view_layer.objects.active = ob
        me = ob.data
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bm.to_mesh(me); bm.free()
tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in bpy.context.scene.objects if ob.type == 'MESH')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_animations=False, export_extras=True,
                          export_normals=True, export_texcoords=True, export_materials='EXPORT')
print('wrote', os.path.relpath(OUT, ROOT), os.path.getsize(OUT) // 1024, 'KB', tris, 'triangles')
