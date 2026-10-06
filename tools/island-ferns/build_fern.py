"""The island's ground ferns (fernA, fernB), built headless in Blender (bpy module).

    python3 tools/island-ferns/build_fern.py [--only fernA] [--outdir public/models/island]

Writes <name>_lod0.glb, _lod1.glb, _lod2.glb.

A crown of fronds (the fern atlas, own art) springing from one point: the young fronds stand up short and narrow, the full ones arch out and droop at
the tip, the oldest lie nearly flat and are going yellow. Each frond is folded a little along its midrib. The shading is baked in (rays against the
fern itself: the middle of the crown and the undersides darker, the foot darkest) and the normals lean out from under the crown, so it lights as one
soft clump. The coarse levels take lod0's average darkening so a fern does not brighten as it switches.
  fernA   mostly sword fronds, about 0.8 m tall and 2.4 m across           fernB   mostly lace fronds, about 1.1 m tall and 3 m across

Levels (the game switches at 30 m and 70 m; there are about 2,000 of each, most drawn far):
  lod0   14 or 15 fronds, each curved in seven steps (about 400 triangles)
  lod1   eight fronds in three steps (about 50)                lod2   five fronds that keep the outline (20)
A coarser level keeps a run of the full middle-aged fronds (the golden angle spreads any run of them all round the crown).

What the game reads (src/island-glb.js): "Leaf cards" (the game puts the fern atlas on it), COLOR_0, NORMAL, TEXCOORD_0. Frame: glTF axes directly
(+Y up, metres, the origin on the ground at the crown), exported with "Y up" off.
"""
import json
import math
import os
import random
import sys

import bpy
import bmesh  # noqa: F401  (must come after bpy)
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

A = sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUTDIR = A[A.index('--outdir') + 1] if '--outdir' in A else os.path.join(ROOT, 'public', 'models', 'island')
ONLY = A[A.index('--only') + 1] if '--only' in A else None
SPRITES = json.load(open(os.path.join(ROOT, 'public', 'textures', 'island-leaves', 'sprites.json')))['fern']
TAU, GOLDEN = math.tau, 2.399963229728653
UP = np.array([0.0, 1.0, 0.0])
DEG = math.pi / 180

FERNS = {
    'fernA': dict(seed=11, size=1.1, fronds=14, sword=0.8),
    'fernB': dict(seed=23, size=1.45, fronds=15, sword=0.2),
}
LODS = {0: dict(share=1.0, rows=7, cols=3, wide=1.0), 1: dict(share=0.57, rows=3, cols=2, wide=1.12), 2: dict(share=0.36, rows=2, cols=2, wide=1.3)}


def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def arch(origin, az, el0, el1, length, steps, curve=1.6, wander=0.08, seed=0):
    rng = random.Random(seed)
    ph = rng.uniform(0, TAU)
    pts = [np.asarray(origin, float)]
    ds = length / (steps - 1)
    for i in range(steps - 1):
        t = (i + 0.5) / (steps - 1)
        el = el0 + (el1 - el0) * t ** curve
        a = az + wander * math.sin(t * 3.1 + ph)
        pts.append(pts[-1] + np.array([math.cos(el) * math.cos(a), math.sin(el), math.cos(el) * math.sin(a)]) * ds)
    return pts


def build(name, lod):
    spec, cfg = FERNS[name], LODS[lod]
    size = spec['size']
    fronds = []
    for f in range(spec['fronds']):
        r = random.Random(spec['seed'] * 1000 + f)
        age = min(1.0, max(0.0, (f + 0.5) / spec['fronds'] + r.uniform(-0.08, 0.08)))
        fronds.append(dict(
            az=f * GOLDEN + r.uniform(-0.2, 0.2), age=age, L=size * lerp(0.6, 1.25, math.sin(age * math.pi * 0.85) ** 0.6) * r.uniform(0.88, 1.1),
            el0=lerp(82, 30, age ** 0.9) * DEG + r.uniform(-0.1, 0.1), el1=lerp(20, -55, age) * DEG + r.uniform(-0.15, 0.1),
            sprite='sword' if r.random() < spec['sword'] else 'lace', tone=r.uniform(0.86, 1.1), roll=r.uniform(-0.35, 0.35),
            yellow=smoothstep(0.82, 1.0, age) * r.uniform(0.4, 1.0), seed=r.randrange(1 << 30)))
    n = max(4, round(spec['fronds'] * cfg['share']))
    keep = fronds if n >= len(fronds) else ([f for f in fronds if 0.15 < f['age'] < 0.9] + [f for f in fronds if not 0.15 < f['age'] < 0.9])[:n]
    crown = np.array([0.0, 0.05 * size, 0.0])
    lean_from = crown - UP * 0.35 * size
    V, C, B, F, UV = [], [], [], [], []
    cols, steps = cfg['cols'], cfg['rows'] + 1
    for f in keep:
        d = np.array([math.cos(f['az']), 0.0, math.sin(f['az'])])
        path = arch(crown + d * 0.04 * size, f['az'], f['el0'], f['el1'], f['L'], steps, seed=f['seed'])
        hue = np.array([1.0, 1.0, 0.95]) * (1 - f['yellow']) + np.array([1.25, 1.0, 0.42]) * f['yellow']
        width = f['L'] * 0.44 * cfg['wide'] * lerp(0.75, 1.0, smoothstep(0.0, 0.3, f['age']))
        across0 = np.array([-d[2], 0.0, d[0]])
        x0, y0, w, h = SPRITES[f['sprite']]
        idx = []
        for i, p in enumerate(path):
            t = i / (steps - 1)
            T = norm(path[min(i + 1, steps - 1)] - path[max(i - 1, 0)])
            a = norm(across0 - T * np.dot(across0, T))
            front = np.cross(T, a)
            a, front = a * math.cos(f['roll']) + front * math.sin(f['roll']), front * math.cos(f['roll']) - a * math.sin(f['roll'])
            wd = width * (0.55 + 0.45 * math.sin(math.pi * min(1.0, 0.2 + t)) ** 0.5)
            row = []
            for j in range(cols):
                s = -1.0 + 2.0 * j / (cols - 1)
                q = p + a * s * wd * 0.5 + front * abs(s) * wd * 0.5 * (0.16 if cols > 2 else 0.0)
                V.append(q)
                C.append(hue * f['tone'] * (0.62 + 0.38 * smoothstep(0.0, 0.5 * size, q[1])))
                B.append(norm(q - lean_from))
                row.append(len(V) - 1)
            idx.append(row)
        for i in range(steps - 1):
            for j in range(cols - 1):
                def uv(ii, jj):
                    return ((x0 + 1 + jj / (cols - 1) * (w - 2)) / 1024.0, 1.0 - (y0 + 1 + (1 - ii / (steps - 1)) * (h - 2)) / 1024.0)
                F.append((idx[i][j], idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j]))
                UV.append((uv(i, j), uv(i, j + 1), uv(i + 1, j + 1), uv(i + 1, j)))
    return dict(V=V, C=C, B=B, F=F, UV=UV)


def bake(M, rays=16, reach=0.6, strength=0.6):
    """Ambient occlusion along the leaned normals against the fern itself (a frond counts as about half solid). Returns the average darkening."""
    tree = BVHTree.FromPolygons([Vector(v) for v in M['V']], [list(f) for f in M['F']], all_triangles=False)
    rng = np.random.default_rng(5)
    u1, u2 = rng.random(rays), rng.random(rays)
    local = np.stack([np.sqrt(u1) * np.cos(TAU * u2), np.sqrt(u1) * np.sin(TAU * u2), np.sqrt(1 - u1)], 1)
    shades = []
    for i, p in enumerate(M['V']):
        n = M['B'][i]
        a = norm(np.cross(n, [0.3, 0.9, 0.2]))
        b = np.cross(n, a)
        hit = 0.0
        for d in local:
            loc, _, _, dist = tree.ray_cast(Vector(p + n * 0.01), Vector(a * d[0] + b * d[1] + n * d[2]), reach)
            if loc is not None:
                hit += 0.55 * (1.0 - 0.5 * dist / reach)
        s = max(1.0 - strength * hit / rays, 0.35)
        shades.append(s)
        M['C'][i] = M['C'][i] * s
    return float(np.mean(shades))


SHADE = {}


def export(name, lod):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = build(name, lod)
    if lod == 0:
        SHADE[name] = bake(M)
    else:
        M['C'] = [c * SHADE[name] for c in M['C']]
    me = bpy.data.meshes.new(f'{name}_lod{lod}')
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
    col.data.foreach_set('color', np.concatenate([np.clip(np.asarray(M['C']), 0, 2), np.ones((len(M['C']), 1))], 1).ravel())
    me.color_attributes.active_color = col
    base = [np.array(v.normal) for v in me.vertices]
    me.normals_split_custom_set_from_vertices([tuple(norm(b * 0.55 + l * 0.45)) for b, l in zip(base, M['B'])])
    ob = bpy.data.objects.new(f'{name}_lod{lod}', me)
    bpy.context.scene.collection.objects.link(ob)
    path = os.path.join(OUTDIR, f'{name}_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=False, export_apply=False, export_animations=False, export_skins=False,
                              export_morph=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_normals=True, export_tangents=False,
                              export_texcoords=True, export_materials='EXPORT', export_extras=False, export_image_format='NONE')
    V = np.asarray(M['V'])
    tris = sum(len(f) - 2 for f in M['F'])
    print(f'{name}_lod{lod}: {tris} tris, {os.path.getsize(path) // 1024} KB, x[{V[:, 0].min():.1f},{V[:, 0].max():.1f}] '
          f'y[{V[:, 1].min():.1f},{V[:, 1].max():.1f}] z[{V[:, 2].min():.1f},{V[:, 2].max():.1f}]', flush=True)


if __name__ == '__main__':
    for name in FERNS:
        if ONLY and ONLY != name:
            continue
        for lod in (0, 1, 2):
            export(name, lod)
