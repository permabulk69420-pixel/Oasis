"""The island's big-leaf plants (broadleafA, broadleafB), built headless in Blender (bpy module).

    python3 tools/island-broadleaf/build_broadleaf.py [--only broadleafA] [--outdir public/models/island]

Writes <name>_lod0.glb, _lod1.glb, _lod2.glb.

A rosette of big leaves on stalks (the broadleaf atlas, own art). Each stalk rises from the base and leans out (it wears the atlas's plain stem patch,
so the plant needs one material); the blade is held near level, cupped along the midrib, and drops at the tip. The inner leaves are smaller and
higher, the outer ones bigger and lower, and one or two of the outermost are torn down and hang. The shading is baked in (rays against the plant
itself: under the blades and at the foot darker) and the normals lean out from under the plant, so it lights as one clump. The coarse levels take
lod0's average darkening so a plant does not brighten as it switches.
  broadleafA   elephant ears and monstera, about 1 m tall           broadleafB   calathea and torn banana paddles, a little taller

Levels (the game switches at 30 m and 70 m; there are about 1,850 of each, most drawn far):
  lod0   ten or eleven leaves, each blade curved in five rows and five columns, on a four-sided stalk
  lod1   the seven outer leaves, two rows by three, on three-sided stalks       lod2   the five outer blades, flat (10 triangles)

What the game reads (src/island-glb.js): "Leaf cards" (the game puts the broadleaf atlas on it), COLOR_0, NORMAL, TEXCOORD_0. Frame: glTF axes
directly (+Y up, metres, the origin on the ground at the plant's middle), exported with "Y up" off.
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
SPRITES = json.load(open(os.path.join(ROOT, 'public', 'textures', 'island-leaves', 'sprites.json')))['broadleaf']
TAU, GOLDEN = math.tau, 2.399963229728653
UP = np.array([0.0, 1.0, 0.0])
DEG = math.pi / 180

# sprite: (width / length, size, how far up the sprite the stalk joins: the hearts have lobes below the notch)
SHAPES = {'heart': (0.92, 1.0, 0.123), 'monstera': (0.94, 1.0, 0.123), 'calathea': (0.56, 1.05, 0.0), 'paddle': (0.5, 1.15, 0.0)}
PLANTS = {
    'broadleafA': dict(seed=31, size=1.05, leaves=10, kinds=['heart', 'heart', 'monstera']),
    'broadleafB': dict(seed=47, size=1.15, leaves=11, kinds=['calathea', 'paddle', 'calathea']),
}
# share: how many leaves (the outer ones); rows, cols: the blade's grid; stalk: (steps, sides) or None
LODS = {0: dict(share=1.0, rows=5, cols=5, stalk=(4, 4)), 1: dict(share=0.7, rows=2, cols=3, stalk=(2, 3)), 2: dict(share=0.45, rows=1, cols=2, stalk=None)}


def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def arch(origin, az, el0, el1, length, steps, curve=1.5):
    pts = [np.asarray(origin, float)]
    ds = length / (steps - 1)
    for i in range(steps - 1):
        t = (i + 0.5) / (steps - 1)
        el = el0 + (el1 - el0) * t ** curve
        pts.append(pts[-1] + np.array([math.cos(el) * math.cos(az), math.sin(el), math.cos(el) * math.sin(az)]) * ds)
    return pts


def build(name, lod):
    spec, cfg = PLANTS[name], LODS[lod]
    size, n = spec['size'], spec['leaves']
    leaves = []
    for k in range(n):
        r = random.Random(spec['seed'] * 1000 + k)
        outer = (k + 0.5) / n
        kind = spec['kinds'][r.randrange(len(spec['kinds']))]
        aspect, scale, attach = SHAPES[kind]
        L = size * scale * lerp(0.55, 1.0, outer ** 0.7) * r.uniform(0.85, 1.12)
        leaves.append(dict(
            az=k * GOLDEN + r.uniform(-0.2, 0.2), kind=kind, L=L, W=L * aspect, attach=attach,
            stem_h=size * lerp(0.95, 0.35, outer) * r.uniform(0.85, 1.15), reach=size * lerp(0.08, 0.42, outer) * r.uniform(0.8, 1.2),
            el0=r.uniform(-8, 22) * DEG, droop=lerp(18, 60, outer) * DEG + r.uniform(-0.1, 0.15), hang=outer > 0.75 and r.random() < 0.35,
            tone=r.uniform(0.88, 1.1), hue=np.array([1.0, r.uniform(0.95, 1.05), r.uniform(0.92, 1.04)]), roll=r.uniform(-0.25, 0.25)))
    keep = leaves[n - max(3, round(n * cfg['share'])):]          # the outer leaves make the outline; consecutive ones spread all round
    lean_from = np.array([0.0, 0.45 * size, 0.0]) - UP * 0.5 * size
    V, C, B, F, UV = [], [], [], [], []

    def quad_grid(rows_pts, colours, sprite, mirror=False):
        x0, y0, w, h = SPRITES[sprite]
        nr, nc = len(rows_pts), len(rows_pts[0])
        idx = []
        for i in range(nr):
            row = []
            for j in range(nc):
                V.append(rows_pts[i][j])
                C.append(colours[i][j])
                B.append(norm(rows_pts[i][j] - lean_from))
                row.append(len(V) - 1)
            idx.append(row)
        for i in range(nr - 1):
            for j in range(nc - 1):
                def uv(ii, jj):
                    return ((x0 + 1 + jj / (nc - 1) * (w - 2)) / 1024.0, 1.0 - (y0 + 1 + (1 - ii / (nr - 1)) * (h - 2)) / 1024.0)
                F.append((idx[i][j], idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j]))
                UV.append((uv(i, j), uv(i, j + 1), uv(i + 1, j + 1), uv(i + 1, j)))

    for s in keep:
        d = np.array([math.cos(s['az']), 0.0, math.sin(s['az'])])
        side = np.array([-d[2], 0.0, d[0]])
        # the stalk: up from the base, curving out to where the blade joins
        steps = (cfg['stalk'] or (2, 0))[0]
        stalk = [d * s['reach'] * (i / steps) ** 2.0 + UP * s['stem_h'] * (1 - (1 - i / steps) ** 2) for i in range(steps + 1)]
        if cfg['stalk']:
            sides = cfg['stalk'][1]
            rings, cols_ = [], []
            for i, p in enumerate(stalk):
                T = norm(stalk[min(i + 1, steps)] - stalk[max(i - 1, 0)])
                a = norm(np.cross(T, side))
                b = np.cross(T, a)
                rad = size * lerp(0.03, 0.014, i / steps)
                ring = [p + (a * math.cos(TAU * k / sides) + b * math.sin(TAU * k / sides)) * rad for k in range(sides)] + [p + a * rad]
                rings.append(ring)
                cols_.append([np.full(3, 0.75 * (0.62 + 0.38 * smoothstep(0.0, 0.5 * size, p[1])))] * (sides + 1))
            quad_grid(rings, cols_, 'stem')
        # the blade
        el0, droop = (s['el0'], s['droop']) if not s['hang'] else (-35 * DEG, -80 * DEG)
        start = stalk[-1] - d * s['attach'] * s['L']
        path = arch(start, s['az'], el0, -droop, s['L'], cfg['rows'] + 1)
        rows_pts, colours = [], []
        nc = cfg['cols']
        for i, p in enumerate(path):
            t = i / (len(path) - 1)
            T = norm(path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)])
            a = norm(side - T * np.dot(side, T))
            front = np.cross(T, a)
            a, front = a * math.cos(s['roll']) + front * math.sin(s['roll']), front * math.cos(s['roll']) - a * math.sin(s['roll'])
            W = s['W'] * (1.0 if lod == 0 else 1.06)
            row, crow = [], []
            for j in range(nc):
                q = -1.0 + 2.0 * j / (nc - 1)
                lift = (0.08 * abs(q) - 0.22 * q * q) * W * 0.5 if nc > 2 else 0.0     # a V along the midrib, the edges rolled down
                row.append(p + a * q * W * 0.5 + front * lift)
                crow.append(s['hue'] * s['tone'] * (0.88 + 0.12 * t) * (0.8 if s['hang'] else 1.0))
            rows_pts.append(row)
            colours.append(crow)
        quad_grid(rows_pts, colours, s['kind'])
    return dict(V=V, C=C, B=B, F=F, UV=UV)


def bake(M, rays=16, reach=0.8, strength=0.6):
    tree = BVHTree.FromPolygons([Vector(v) for v in M['V']], [list(f) for f in M['F']], all_triangles=False)
    rng = np.random.default_rng(9)
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
                hit += 0.7 * (1.0 - 0.5 * dist / reach)
        s = max(1.0 - strength * hit / rays, 0.35) * lerp(0.7, 1.0, smoothstep(0.0, 0.5, p[1]))
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
    me.normals_split_custom_set_from_vertices([tuple(norm(b * 0.6 + l * 0.4)) for b, l in zip(base, M['B'])])
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
    for name in PLANTS:
        if ONLY and ONLY != name:
            continue
        for lod in (0, 1, 2):
            export(name, lod)
