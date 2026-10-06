"""The island's glowing mushrooms (mushrooms), built headless in Blender (bpy module). Replaces the old cluster, which was so small (20 cm) it barely read.

    python3 tools/island-flowers/build_mushrooms.py [--outdir public/models/island]

Writes mushrooms_lod0.glb, _lod1.glb, _lod2.glb.

A cluster about half a metre across: seven mushrooms, the tallest about 30 cm, each a slightly curved stem swelling at the foot under a domed cap with
a rolled rim. The gills under the cap glow cyan, and the cap's top carries faint glowing flecks; two tiny ones are just coming up. By day they are
dark blue-grey caps with a soft glow underneath; at night the gills light the ground round them (the game adds a cyan halo: the empty node halo_cyan).

Levels (the game switches at 30 m and 70 m): lod0 all seven and the two tiny ones, caps on twelve sides; lod1 five on seven sides; lod2 the three
biggest on five sides.

What the game reads (src/island-glb.js): "Body" (plain colour, the game's own material), COLOR_0 (shading baked in), NORMAL, _EMIT (the glow colour)
and the halo node. Frame: glTF axes directly (+Y up, metres, the origin on the ground at the cluster's middle), exported with "Y up" off.
"""
import math
import os
import random
import sys

import bpy
import bmesh  # noqa: F401  (must come after bpy)
import numpy as np

A = sys.argv
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUTDIR = A[A.index('--outdir') + 1] if '--outdir' in A else os.path.join(ROOT, 'public', 'models', 'island')
TAU = math.tau
UP = np.array([0.0, 1.0, 0.0])

CAP = np.array([0.03, 0.04, 0.062])
CAP_RIM = np.array([0.06, 0.08, 0.1])
STEM = np.array([0.07, 0.09, 0.1])
GILL = np.array([0.05, 0.12, 0.16])
CYAN = np.array([0.03, 0.62, 1.0])
# (x, z, height, cap radius, lean) biggest first: a coarser level keeps the first few
SHROOMS = [(0.0, 0.0, 0.3, 0.11, 0.08), (0.12, 0.07, 0.22, 0.085, 0.18), (-0.1, 0.09, 0.19, 0.075, 0.22), (0.05, -0.13, 0.16, 0.065, 0.2),
           (-0.15, -0.08, 0.13, 0.05, 0.28), (0.2, -0.06, 0.1, 0.04, 0.3), (-0.04, 0.19, 0.09, 0.035, 0.25), (0.15, 0.18, 0.04, 0.018, 0.1),
           (-0.2, 0.08, 0.035, 0.015, 0.1)]
LODS = {0: dict(count=9, sides=12, stem=6, rings=4), 1: dict(count=5, sides=7, stem=4, rings=2), 2: dict(count=3, sides=5, stem=3, rings=1)}


def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)


def hash01(*k):
    x = math.sin(sum(v * m for v, m in zip(k, (127.1, 311.7, 74.7))) + 0.5) * 43758.5453
    return x - math.floor(x)


def build(lod):
    cfg = LODS[lod]
    V, C, E, F = [], [], [], []

    def ring_grid(rings, cols, ems, cap_top=None):
        n = len(rings[0])
        base = len(V)
        for ring, cr, er in zip(rings, cols, ems):
            V.extend(ring)
            C.extend(cr)
            E.extend(er)
        for i in range(len(rings) - 1):
            for k in range(n):
                k2 = (k + 1) % n
                F.append((base + i * n + k, base + i * n + k2, base + (i + 1) * n + k2, base + (i + 1) * n + k))
        if cap_top is not None:
            V.append(cap_top[0])
            C.append(cap_top[1])
            E.append(np.zeros(3))
            t = len(V) - 1
            last = base + (len(rings) - 1) * n
            for k in range(n):
                F.append((last + k, last + (k + 1) % n, t))

    for m, (x, z, h, R, lean) in enumerate(SHROOMS[:cfg['count']]):
        rng = random.Random(500 + m)
        az = math.atan2(z, x) if (x or z) else rng.uniform(0, TAU)
        out = np.array([math.cos(az), 0.0, math.sin(az)])
        foot = np.array([x, -0.01, z])
        # the stem, curving out and up; its top is where the cap sits
        rings_n = cfg['rings'] + 1
        path = [foot + UP * h * (i / (rings_n - 1)) + out * lean * h * (i / (rings_n - 1)) ** 2 for i in range(rings_n)]
        axis = norm(path[-1] - path[-2] + UP * 0.05)
        sr = R * 0.22
        rings, cols, ems = [], [], []
        for i, p in enumerate(path):
            t = i / (rings_n - 1)
            T = norm(path[min(i + 1, rings_n - 1)] - path[max(i - 1, 0)])
            s = norm(np.cross(T, [0.0, 0.0, 1.0]))
            u = np.cross(s, T)
            r = sr * (1.0 + 0.6 * (1 - t) ** 3)
            rings.append([p + (s * math.cos(TAU * k / cfg['stem']) + u * math.sin(TAU * k / cfg['stem'])) * r for k in range(cfg['stem'])])
            cols.append([STEM * (0.6 + 0.4 * t)] * cfg['stem'])
            ems.append([CYAN * 0.08 * t] * cfg['stem'])
        ring_grid(rings, cols, ems)
        # the cap: a profile turned about the stem's axis, from the gills under it, round the rolled rim, over the dome
        top = path[-1]
        s = norm(np.cross(axis, [0.0, 0.0, 1.0]))
        u = np.cross(s, axis)
        prof = [(sr * 1.1, 0.0, 'gill'), (R * 0.6, 0.03 * R, 'gill'), (R * 0.95, 0.1 * R, 'gill'), (R * 1.02, 0.2 * R, 'rim'),
                (R * 0.95, 0.42 * R, 'top'), (R * 0.72, 0.62 * R, 'top'), (R * 0.38, 0.74 * R, 'top')]
        if cfg['sides'] < 8:
            prof = [prof[0], prof[2], prof[3], prof[5]]
        rings, cols, ems = [], [], []
        n = cfg['sides']
        for j, (r, y, kind) in enumerate(prof):
            ring, cr, er = [], [], []
            for k in range(n):
                a = TAU * k / n
                wob = 1.0 + 0.05 * math.sin(a * 3 + m)
                ring.append(top + axis * (y - 0.05 * R) + (s * math.cos(a) + u * math.sin(a)) * r * wob)
                if kind == 'gill':
                    cr.append(GILL)
                    er.append(CYAN * (0.85 if j else 0.4))
                elif kind == 'rim':
                    cr.append(CAP_RIM)
                    er.append(CYAN * 0.25)
                else:
                    fleck = 1.0 if (j == len(prof) - 2 and hash01(m, j, k) > 0.7) else 0.0       # a few flecks in one ring round the dome
                    cr.append(CAP * (1.0 + 0.25 * fleck))
                    er.append(CYAN * 0.1 * fleck)
            rings.append(ring)
            cols.append(cr)
            ems.append(er)
        ring_grid(rings, cols, ems, cap_top=(top + axis * 0.76 * R, CAP))
    return dict(V=V, C=C, E=E, F=F)


def export(lod):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = build(lod)
    me = bpy.data.meshes.new(f'mushrooms_lod{lod}')
    me.from_pydata([tuple(v) for v in M['V']], [], M['F'])
    me.validate()
    m = bpy.data.materials.new('Body')
    m.use_nodes = True
    vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    m.node_tree.links.new(vc.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    me.materials.append(m)
    me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        poly.use_smooth = True
    # faces wound outward: a cap's profile runs from the inside out, so check the volume's sign and flip if needed
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    col.data.foreach_set('color', np.concatenate([np.asarray(M['C']), np.ones((len(M['C']), 1))], 1).ravel())
    me.color_attributes.active_color = col
    em = me.attributes.new('_emit', 'FLOAT_VECTOR', 'POINT')
    em.data.foreach_set('vector', np.asarray(M['E'], float).ravel())
    ob = bpy.data.objects.new(f'mushrooms_lod{lod}', me)
    bpy.context.scene.collection.objects.link(ob)
    h = bpy.data.objects.new('halo_cyan', None)
    h.location = (0.0, 0.12, 0.0)
    h.scale = (0.45, 0.45, 0.45)
    bpy.context.scene.collection.objects.link(h)
    path = os.path.join(OUTDIR, f'mushrooms_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=False, export_apply=False, export_animations=False, export_skins=False,
                              export_morph=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_attributes=True, export_normals=True,
                              export_tangents=False, export_texcoords=True, export_materials='EXPORT', export_extras=False, export_image_format='NONE')
    V = np.asarray(M['V'])
    tris = sum(len(f) - 2 for f in M['F'])
    print(f'mushrooms_lod{lod}: {tris} tris, {os.path.getsize(path) // 1024} KB, x[{V[:, 0].min():.2f},{V[:, 0].max():.2f}] y[{V[:, 1].min():.2f},{V[:, 1].max():.2f}]', flush=True)


if __name__ == '__main__':
    for lod in (0, 1, 2):
        export(lod)
