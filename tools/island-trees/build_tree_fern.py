"""The island's tree ferns (treeFernA, treeFernB), built headless in Blender (bpy module). Replaces the old ones, which were a thin pole with a sparse
tuft on top (they read as small palms).

    python3 tools/island-trees/build_tree_fern.py [--only treeFernA] [--outdir public/models/island]

Writes <name>_lod0.glb, _lod1.glb, _lod2.glb.

A tree fern here: a thick, fibrous trunk (the bark photo, darker and mossy toward the foot) whose own foot swells into lumpy root buttresses (no loose
root pieces) and that is knobbled with the stubs of old fronds; at the top a whorl of big lacy fronds (the fern atlas, own art): the young ones stand up, the full ones arch
out and droop, the oldest hang; under them a skirt of dead fronds, dark and gone over, hanging against the trunk.
  treeFernA   about 4 m of trunk, 18 fronds          treeFernB   about 5 m, taller and leaning more, 20 fronds

Levels (the game switches at 30 m and 70 m; there are about 800 of each, most drawn far):
  lod0   everything; shading baked by rays against the fern itself (the crown's underside and the trunk under it darker)
  lod1   about half the fronds, a plainer trunk, two dead fronds          lod2   a three-sided trunk and six flat fronds
The coarse levels take lod0's average baked darkening, so a fern does not brighten as it switches.

What the game reads (src/island-glb.js): "Leaf cards" (the game puts the fern atlas on it) then "Bark" (the jungle bark photo), COLOR_0, NORMAL,
TEXCOORD_0. Frame: glTF axes directly (+Y up, metres, the origin on the ground at the trunk), exported with "Y up" off.
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
LEAF, BARK = 0, 1

FERNS = {
    'treeFernA': dict(seed=101, trunk=4.0, radius=0.16, lean=0.35, fronds=18, frond=2.1, dead=5, lace=0.75),
    'treeFernB': dict(seed=211, trunk=5.0, radius=0.18, lean=0.7, fronds=20, frond=2.4, dead=6, lace=0.6),
}
# trunk: sides, rings; fronds: share kept, card rows, cols; dead: how many of the skirt
LODS = {
    0: dict(sides=10, rings=14, share=1.0, rows=6, cols=3, dead=1.0),
    1: dict(sides=5, rings=5, share=0.55, rows=3, cols=2, dead=0.34),
    2: dict(sides=3, rings=2, share=0.3, rows=1, cols=2, dead=0.0),
}
BARK_TINT = np.array([0.62, 0.55, 0.5])
MOSS_TINT = np.array([0.42, 0.55, 0.36])


def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = min(1.0, max(0.0, t))
    return np.asarray(a) * (1 - t) + np.asarray(b) * t


def hash01(*k):
    x = math.sin(sum(v * m for v, m in zip(k, (127.1, 311.7, 74.7))) + 0.5) * 43758.5453
    return x - math.floor(x)


class Mesh:
    def __init__(self):
        self.V, self.C, self.B, self.BW, self.F, self.UV, self.M = [], [], [], [], [], [], []

    def vertex(self, p, c, bend=None, bw=0.0):
        self.V.append(np.asarray(p, float))
        self.C.append(np.asarray(c, float))
        self.B.append(np.zeros(3) if bend is None else np.asarray(bend, float))
        self.BW.append(bw)
        return len(self.V) - 1

    def tris(self, mat=None):
        return sum(len(f) - 2 for f, m in zip(self.F, self.M) if mat is None or m == mat)

    def tube(self, path, radii, sides, colour, shape=None, tile=1.2, turns=1, cap=False):
        """A bark tube along `path`; u round (`turns` times), v metres / tile; a seam of duplicate uv corners, shared vertices."""
        n = len(path)
        T = [norm(path[min(i + 1, n - 1)] - path[max(i - 1, 0)]) for i in range(n)]
        side = norm(np.cross(T[0], [0.0, 0.0, 1.0]))
        rings, vs, run = [], [], 0.0
        for i in range(n):
            if i:
                run += np.linalg.norm(path[i] - path[i - 1])
                side = norm(side - T[i] * np.dot(side, T[i]))
            up = np.cross(side, T[i])
            vs.append(run / tile)
            ring = []
            for k in range(sides):
                a = TAU * k / sides
                r = radii[i] * (shape(i, k, a) if shape else 1.0)
                p = path[i] + (side * math.cos(a) + up * math.sin(a)) * r
                ring.append(self.vertex(p, colour(i, p)))
            rings.append(ring)
        for i in range(n - 1):
            for k in range(sides):
                k2 = (k + 1) % sides
                u0, u1 = turns * k / sides, turns * (k + 1) / sides
                self.F.append((rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]))
                self.UV.append(((u0, vs[i]), (u0, vs[i + 1]), (u1, vs[i + 1]), (u1, vs[i])))
                self.M.append(BARK)
        if cap:
            c = self.vertex(path[-1] + T[-1] * radii[-1] * 0.4, self.C[rings[-1][0]])
            for k in range(sides):
                self.F.append((c, rings[-1][k], rings[-1][(k + 1) % sides]))
                self.UV.append(((0.5, vs[-1]), (0.0, vs[-1] + 0.2), (0.3, vs[-1] + 0.2)))
                self.M.append(BARK)

    def card(self, sprite, path, width, across, colour, cols, bend_from, bw=0.45, fold=0.16):
        """A frond: the whole sprite along `path` (base to tip), u across, v base to tip; a V along the midrib; normals lean away from `bend_from`."""
        x0, y0, w, h = SPRITES[sprite]
        n = len(path)
        idx = []
        for i, p in enumerate(path):
            t = i / (n - 1)
            T = norm(path[min(i + 1, n - 1)] - path[max(i - 1, 0)])
            a = norm(across - T * np.dot(across, T))
            front = np.cross(T, a)
            wd = width(t)
            row = []
            for j in range(cols):
                s = -1.0 + 2.0 * j / (cols - 1)
                q = p + a * s * wd * 0.5 + front * abs(s) * wd * 0.5 * (fold if cols > 2 else 0.0)
                row.append(self.vertex(q, colour(t), norm(q - bend_from), bw))
            idx.append(row)
        for i in range(n - 1):
            for j in range(cols - 1):
                def uv(ii, jj):
                    return ((x0 + 1 + jj / (cols - 1) * (w - 2)) / 1024.0, 1.0 - (y0 + 1 + (1 - ii / (n - 1)) * (h - 2)) / 1024.0)
                self.F.append((idx[i][j], idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j]))
                self.UV.append((uv(i, j), uv(i, j + 1), uv(i + 1, j + 1), uv(i + 1, j)))
                self.M.append(LEAF)


def arch(origin, az, el0, el1, length, steps, curve=1.6):
    pts = [np.asarray(origin, float)]
    ds = length / (steps - 1)
    for i in range(steps - 1):
        t = (i + 0.5) / (steps - 1)
        el = el0 + (el1 - el0) * t ** curve
        pts.append(pts[-1] + np.array([math.cos(el) * math.cos(az), math.sin(el), math.cos(el) * math.sin(az)]) * ds)
    return pts


def build(name, lod):
    spec, cfg = FERNS[name], LODS[lod]
    rng = random.Random(spec['seed'])
    H, R = spec['trunk'], spec['radius']
    lean_az = rng.uniform(0, TAU)
    M = Mesh()

    # ---- the trunk: a gentle S-lean, a flare into roots at the foot, knobbled with old frond stubs
    def centre(y):
        k = y / H
        drift = spec['lean'] * k ** 1.5
        return np.array([math.cos(lean_az) * drift + 0.06 * math.sin(k * 5.0), y, math.sin(lean_az) * drift + 0.06 * math.cos(k * 4.0)])
    ys = [-0.3] + [H * (i / (cfg['rings'] - 1)) ** 1.15 for i in range(cfg['rings'])]
    ys = sorted(set(round(y, 4) for y in ys))
    path = [centre(y) for y in ys]
    radii = [R * (1.0 + 1.3 * (1 - smoothstep(0.0, 0.9, y)) ** 2) * lerp(1.0, 1.12, smoothstep(H * 0.7, H * 0.95, y)) * lerp(1.0, 0.6, smoothstep(H * 0.95, H, y)) for y in ys]

    def bumps(i, k, a):
        if lod == 2:
            return 1.0
        y = ys[i]
        fibre = 0.06 * math.sin(a * 7 + y * 3.1)
        knob = 0.16 * max(0.0, math.sin(a * 3 + y * 5.3 + 1.7)) ** 6 if y > 0.8 else 0.0
        buttress = 0.45 * max(0.0, math.cos(a * 5 + 0.7)) ** 3 * (1 - smoothstep(0.0, 0.8, y))      # the foot swells into five lumpy roots
        return 1.0 + fibre + knob + buttress + 0.05 * (hash01(i, k, 3) - 0.5)

    def bark_colour(i, p):
        moss = 1 - smoothstep(0.1, 1.4, p[1])
        return mix(BARK_TINT, MOSS_TINT, moss * 0.85) * lerp(0.78, 1.0, smoothstep(-0.2, 2.0, p[1]))
    M.tube(path, radii, cfg['sides'], bark_colour, bumps, cap=True)
    top = centre(H) - UP * 0.12            # the fronds spring from just under the trunk's tapered top, which hides in them
    crown_mid = top - UP * 0.6

    # ---- the fronds: a whorl in the golden spiral, young ones up, old ones down; a coarser level keeps a run of the full middle-aged ones
    fronds = []
    for f in range(spec['fronds']):
        r = random.Random(spec['seed'] * 1000 + f)
        age = min(1.0, max(0.0, (f + 0.5) / spec['fronds'] + r.uniform(-0.06, 0.06)))
        fronds.append(dict(az=f * GOLDEN + r.uniform(-0.15, 0.15), age=age, L=spec['frond'] * lerp(0.6, 1.15, math.sin(age * math.pi * 0.8) ** 0.5) * r.uniform(0.9, 1.08),
                           el0=lerp(70, 18, age) * math.pi / 180 + r.uniform(-0.1, 0.1), el1=lerp(-5, -70, age ** 1.2) * math.pi / 180,
                           sprite='lace' if r.random() < spec['lace'] else 'sword', tone=r.uniform(0.85, 1.08), roll=r.uniform(-0.3, 0.3)))
    keep_n = max(5, round(spec['fronds'] * cfg['share']))
    keep = fronds if keep_n >= len(fronds) else [f for f in fronds if 0.12 < f['age'] < 0.9][:keep_n]
    steps = cfg['rows'] + 1
    for f in keep:
        d = np.array([math.cos(f['az']), 0.0, math.sin(f['az'])])
        p = arch(top + d * R * 0.6, f['az'], f['el0'], f['el1'], f['L'], steps)
        tone = f['tone'] * lerp(1.0, 0.82, f['age'])
        M.card(f['sprite'], p, lambda t, L=f['L']: L * 0.42 * (0.45 + 0.55 * math.sin(math.pi * min(1.0, 0.18 + t)) ** 0.6), np.array([-d[2], 0.0, d[0]]),
               lambda t, tone=tone: np.array([1.0, 1.0, 0.95]) * tone * lerp(0.8, 1.0, t), cfg['cols'], crown_mid)
    # ---- the skirt of dead fronds hanging against the trunk
    n_dead = round(spec['dead'] * cfg['dead'])
    for k in range(n_dead):
        r = random.Random(spec['seed'] * 77 + k)
        az = k * TAU / max(n_dead, 1) + r.uniform(-0.4, 0.4)
        d = np.array([math.cos(az), 0.0, math.sin(az)])
        p = arch(top - UP * 0.15 + d * R * 0.9, az, -55 * math.pi / 180, -88 * math.pi / 180, spec['frond'] * r.uniform(0.55, 0.75), max(3, steps // 2), curve=0.8)
        M.card('sword', p, lambda t: spec['frond'] * 0.22 * (1 - 0.5 * t), np.array([-d[2], 0.0, d[0]]),
               lambda t, r=r: np.array([1.1, 0.62, 0.3]) * r.uniform(0.45, 0.6), 2, top, bw=0.2)
    return M


def bake(M, rays=16, reach=1.6, strength=0.5):
    tree = BVHTree.FromPolygons([Vector(v) for v in M.V], [list(f) for f in M.F], all_triangles=False)
    rng = np.random.default_rng(7)
    u1, u2 = rng.random(rays), rng.random(rays)
    local = np.stack([np.sqrt(u1) * np.cos(TAU * u2), np.sqrt(u1) * np.sin(TAU * u2), np.sqrt(1 - u1)], 1)
    me = bpy.data.meshes.new('ao')
    me.from_pydata([tuple(v) for v in M.V], [], M.F)
    me.update()
    normals = [np.array(v.normal) for v in me.vertices]
    leafy = set(v for f, m in zip(M.F, M.M) if m == LEAF for v in f)
    shade = []
    for i, p in enumerate(M.V):
        n = norm(normals[i] * (1 - M.BW[i]) + M.B[i] * M.BW[i]) if M.BW[i] else normals[i]
        a = norm(np.cross(n, [0.3, 0.9, 0.2]))
        b = np.cross(n, a)
        hit = 0.0
        o = Vector(p + n * 0.01)
        for d in local:
            loc, _, index, dist = tree.ray_cast(o, Vector(a * d[0] + b * d[1] + n * d[2]), reach)
            if loc is not None:
                hit += (0.55 if M.M[index] == LEAF else 1.0) * (1.0 - 0.5 * dist / reach)
        s = max(1.0 - strength * hit / rays, 0.35)
        shade.append(s)
        M.C[i] = M.C[i] * s
    bpy.data.meshes.remove(me)
    return {'leaf': float(np.mean([shade[i] for i in leafy])), 'bark': float(np.mean([shade[i] for i in range(len(shade)) if i not in leafy]))}


SHADE = {}


def export(name, lod):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = build(name, lod)
    if lod == 0:
        SHADE[name] = bake(M)
    else:
        leafy = set(v for f, m in zip(M.F, M.M) if m == LEAF for v in f)
        for i in range(len(M.V)):
            M.C[i] = M.C[i] * SHADE[name]['leaf' if i in leafy else 'bark']
    me = bpy.data.meshes.new(f'{name}_lod{lod}')
    me.from_pydata([tuple(v) for v in M.V], [], M.F)
    for mname in ('Leaf cards', 'Bark'):
        m = bpy.data.materials.new(mname)
        m.use_nodes = True
        vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        m.node_tree.links.new(vc.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
        me.materials.append(m)
    uv = me.uv_layers.new(name='UVMap')
    for poly, corners, mat in zip(me.polygons, M.UV, M.M):
        poly.use_smooth = True
        poly.material_index = mat
        for loop, c in zip(range(poly.loop_start, poly.loop_start + poly.loop_total), corners):
            uv.data[loop].uv = c
    me.update()
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    col.data.foreach_set('color', np.concatenate([np.clip(np.asarray(M.C), 0, 2), np.ones((len(M.C), 1))], 1).ravel())
    me.color_attributes.active_color = col
    base = [np.array(v.normal) for v in me.vertices]
    me.normals_split_custom_set_from_vertices([tuple(norm(b * (1 - w) + l * w)) for b, l, w in zip(base, M.B, M.BW)])
    ob = bpy.data.objects.new(f'{name}_lod{lod}', me)
    bpy.context.scene.collection.objects.link(ob)
    path = os.path.join(OUTDIR, f'{name}_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=False, export_apply=False, export_animations=False, export_skins=False,
                              export_morph=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_normals=True, export_tangents=False,
                              export_texcoords=True, export_materials='EXPORT', export_extras=False, export_image_format='NONE')
    V = np.asarray(M.V)
    print(f'{name}_lod{lod}: {M.tris()} tris (leaf cards {M.tris(LEAF)}, bark {M.tris(BARK)}), {os.path.getsize(path) // 1024} KB, '
          f'x[{V[:, 0].min():.1f},{V[:, 0].max():.1f}] y[{V[:, 1].min():.1f},{V[:, 1].max():.1f}] z[{V[:, 2].min():.1f},{V[:, 2].max():.1f}]', flush=True)


if __name__ == '__main__':
    for name in FERNS:
        if ONLY and ONLY != name:
            continue
        for lod in (0, 1, 2):
            export(name, lod)
