"""The leafy vine curtains that hang off the giant jungle trees' limbs (vineCurtain), built headless in Blender (bpy module).

    python3 tools/island-vines/build_vine_curtain.py [--outdir public/models/island]

Writes vineCurtain_lod0.glb, _lod1.glb, _lod2.glb.

Strands of leafy vine (the vine atlas, own art) hanging from the origin, which is the point on the limb the layout hangs it from
(src/island-jungle-layout.js layoutTreeVines stretches it down to the ground). The strands are set in two crossing rows so the curtain reads from
any side; each wanders a little as it falls and is slightly darker toward its free end. Every vertex carries a sway weight (the custom attribute
_SWAY: 0 where the strand is tied on, 1 at its free end) that the game's hanging-sway patch swings in the wind.

Levels (the game switches at 30 m and 70 m): lod0 nine strands in six steps (108 triangles), lod1 six strands in three (36), lod2 three in one (6).

What the game reads (src/island-glb.js): "Leaf cards" (the game puts the vine atlas on it), COLOR_0, NORMAL, TEXCOORD_0, _SWAY. Frame: glTF axes
directly (+Y up, metres, the origin at the top), exported with "Y up" off.
"""
import json
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
SPRITES = json.load(open(os.path.join(ROOT, 'public', 'textures', 'island-leaves', 'sprites.json')))['vine']
TAU = math.tau
SPAN, LENGTH, SEED = 3.0, 3.0, 79          # metres across, the average strand length (the layout's `strand`), seed
LODS = {0: dict(count=9, rows=6), 1: dict(count=6, rows=3), 2: dict(count=3, rows=1)}


def build(lod):
    cfg = LODS[lod]
    V, C, S, N, F, UV = [], [], [], [], [], []
    n = cfg['count']
    for k in range(n):
        j = round(k * (LODS[0]['count'] - 1) / max(n - 1, 1))      # a coarser level keeps strands spread across the whole curtain
        r = random.Random(SEED * 1000 + j)
        L = LENGTH * r.uniform(0.7, 1.25)
        x = ((j + 0.5) / LODS[0]['count'] - 0.5) * SPAN + r.uniform(-0.15, 0.15)
        z = r.uniform(-0.3, 0.3)
        yaw = (0.0 if j % 2 else 72 * math.pi / 180) + r.uniform(-0.3, 0.3)
        across = np.array([math.cos(yaw), 0.0, -math.sin(yaw)])
        facing = np.array([math.sin(yaw), 0.0, math.cos(yaw)])
        sprite = ['strandA', 'strandB', 'strandC', 'strandD'][r.randrange(4)]
        x0, y0, w, h = SPRITES[sprite]
        tone = r.uniform(0.85, 1.08)
        ph = r.uniform(0, TAU)
        width = L * 0.28 * (1 + 0.12 * lod)
        steps = cfg['rows'] + 1
        idx = []
        for i in range(steps):
            u = i / (steps - 1)
            p = np.array([x + 0.08 * u * math.sin(u * 4 + ph), -L * u, z + 0.08 * u * math.cos(u * 3 + ph)])
            row = []
            for s in (-1.0, 1.0):
                V.append(p + across * s * width * 0.5)
                C.append(np.array([tone, tone, tone * 0.95]) * (1.0 - 0.2 * u))
                S.append(u ** 1.15)
                N.append(facing * 0.7 + np.array([0.0, 0.7, 0.0]))
                row.append(len(V) - 1)
            idx.append(row)
        for i in range(steps - 1):
            # the strand's picture runs from its top (where it is tied on: the sprite's top edge) down to its free end
            def uv(ii, jj):
                return ((x0 + 1 + jj * (w - 2)) / 1024.0, 1.0 - (y0 + 1 + (ii / (steps - 1)) * (h - 2)) / 1024.0)
            F.append((idx[i][0], idx[i + 1][0], idx[i + 1][1], idx[i][1]))
            UV.append((uv(i, 0), uv(i + 1, 0), uv(i + 1, 1), uv(i, 1)))
    return dict(V=V, C=C, S=S, N=N, F=F, UV=UV)


def export(lod):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = build(lod)
    me = bpy.data.meshes.new(f'vineCurtain_lod{lod}')
    me.from_pydata([tuple(v) for v in M['V']], [], M['F'])
    m = bpy.data.materials.new('Leaf cards')
    m.use_nodes = True
    vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    m.node_tree.links.new(vc.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    me.materials.append(m)
    uv = me.uv_layers.new(name='UVMap')
    for poly, corners in zip(me.polygons, M['UV']):
        poly.use_smooth = True
        for loop, c in zip(range(poly.loop_start, poly.loop_start + poly.loop_total), corners):
            uv.data[loop].uv = c
    me.update()
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    col.data.foreach_set('color', np.concatenate([np.asarray(M['C']), np.ones((len(M['C']), 1))], 1).ravel())
    me.color_attributes.active_color = col
    sway = me.attributes.new('_sway', 'FLOAT', 'POINT')
    sway.data.foreach_set('value', np.asarray(M['S'], float))
    me.normals_split_custom_set_from_vertices([tuple(n / np.linalg.norm(n)) for n in M['N']])
    ob = bpy.data.objects.new(f'vineCurtain_lod{lod}', me)
    bpy.context.scene.collection.objects.link(ob)
    path = os.path.join(OUTDIR, f'vineCurtain_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=False, export_apply=False, export_animations=False, export_skins=False,
                              export_morph=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_attributes=True, export_normals=True,
                              export_tangents=False, export_texcoords=True, export_materials='EXPORT', export_extras=False, export_image_format='NONE')
    V = np.asarray(M['V'])
    print(f'vineCurtain_lod{lod}: {2 * len(M["F"])} tris, {os.path.getsize(path) // 1024} KB, y[{V[:, 1].min():.1f},{V[:, 1].max():.1f}]', flush=True)


if __name__ == '__main__':
    for lod in (0, 1, 2):
        export(lod)
