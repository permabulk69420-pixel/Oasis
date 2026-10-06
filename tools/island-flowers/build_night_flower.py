"""The island's big pale night flowers (flower), built headless in Blender (bpy module). Replaces the old one (one thin stalk, a small tulip head and two
flat leaves).

    python3 tools/island-flowers/build_night_flower.py [--outdir public/models/island]

Writes flower_lod0.glb, _lod1.glb, _lod2.glb.

A clump: three stems of different heights (to about 1.7 m) arch up and nod, each holding a big trumpet of six pale petals that curl back at the lip;
the throat glows pale cyan, and five stamens stand out of it with glowing tips. A fourth stem carries a closed bud. A rosette of long strap leaves,
folded along a paler midrib, arches out at the foot. By day it is a pale flower on a dark plant; at night the throats and stamens light it (the game
sets the glow strength and puts a soft pale halo in each open flower: the empty nodes halo_pale). The seed puffs that drift off them at night are the
game's (src/island-motes.js).

Levels (the game switches at 30 m and 70 m; 48 on the island):
  lod0   everything, petals curved in five rows, stems on six sides
  lod1   the three flowers with plainer petals, no stamens, six leaves         lod2   three stems, three cupped petals each, four leaves

What the game reads (src/island-glb.js): "Body" (plain colour, the game's own material), COLOR_0 (shading baked in), NORMAL, _EMIT (the glow colour)
and the halo nodes. Frame: glTF axes directly (+Y up, metres, the origin on the ground at the clump's middle), exported with "Y up" off.
"""
import math
import os
import random
import sys

import bpy
import bmesh  # must come after bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

A = sys.argv
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUTDIR = A[A.index('--outdir') + 1] if '--outdir' in A else os.path.join(ROOT, 'public', 'models', 'island')
TAU, GOLDEN = math.tau, 2.399963229728653
UP = np.array([0.0, 1.0, 0.0])
DEG = math.pi / 180

# linear colours, dark for the twilight (the island's palette)
LEAF = np.array([0.014, 0.055, 0.042])
LEAF_LIGHT = np.array([0.03, 0.095, 0.07])
RIB = np.array([0.06, 0.13, 0.1])
STALK = np.array([0.02, 0.062, 0.058])
PETAL = np.array([0.22, 0.31, 0.36])
PETAL_EDGE = np.array([0.34, 0.44, 0.48])
THROAT = np.array([0.12, 0.2, 0.24])
PALE = np.array([0.55, 0.86, 1.0])
LODS = {
    0: dict(stem_sides=6, stem_rings=10, petal_rows=5, petal_cols=3, petals=6, stamens=5, bud=True, leaves=9, leaf_rows=6, leaf_cols=3),
    1: dict(stem_sides=4, stem_rings=5, petal_rows=3, petal_cols=3, petals=5, stamens=0, bud=True, leaves=6, leaf_rows=3, leaf_cols=3),
    2: dict(stem_sides=3, stem_rings=3, petal_rows=2, petal_cols=3, petals=3, stamens=0, bud=False, leaves=4, leaf_rows=2, leaf_cols=2),
}


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


def frame(t):
    t = norm(t)
    s = np.cross(t, UP)
    s = norm(s) if np.linalg.norm(s) > 1e-4 else np.array([1.0, 0.0, 0.0])
    return s, norm(np.cross(s, t))


class Mesh:
    def __init__(self):
        self.V, self.C, self.E, self.F, self.UV = [], [], [], [], []
        self.halos = []

    def vertex(self, p, c, e=None):
        self.V.append(np.asarray(p, float))
        self.C.append(np.asarray(c, float))
        self.E.append(np.zeros(3) if e is None else np.asarray(e, float))
        return len(self.V) - 1

    def grid(self, pts, cols, emits=None, wrap=False):
        """pts[i][j] -> faces between rows; (colours given per point as cols[i][j]). `wrap`: the last column joins the first."""
        nr, nc = len(pts), len(pts[0])
        idx = [[self.vertex(pts[i][j], cols[i][j], emits[i][j] if emits else None) for j in range(nc)] for i in range(nr)]
        for i in range(nr - 1):
            for j in range(nc if wrap else nc - 1):
                j2 = (j + 1) % nc
                self.F.append((idx[i][j], idx[i][j2], idx[i + 1][j2], idx[i + 1][j]))
                self.UV.append(((j / nc, i / (nr - 1)), ((j + 1) / nc, i / (nr - 1)), ((j + 1) / nc, (i + 1) / (nr - 1)), (j / nc, (i + 1) / (nr - 1))))
        return idx

    def tube(self, path, radii, sides, colour, emit=None, cap=True):
        rings, cols, ems = [], [], []
        for i, p in enumerate(path):
            T = norm(path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)])
            s, u = frame(T)
            rings.append([p + (s * math.cos(TAU * k / sides) + u * math.sin(TAU * k / sides)) * radii[i] for k in range(sides)])
            cols.append([colour(i)] * sides)
            ems.append([emit(i) if emit else np.zeros(3)] * sides)
        idx = self.grid(rings, cols, ems, wrap=True)
        if cap:
            tip = self.vertex(path[-1] + norm(path[-1] - path[-2]) * radii[-1], colour(len(path) - 1), emit(len(path) - 1) if emit else None)
            for k in range(sides):
                self.F.append((idx[-1][k], idx[-1][(k + 1) % sides], tip))
                self.UV.append(((0, 1), (1, 1), (0.5, 1)))

    def bead(self, c, r, colour, emit, sides=6):
        """A small closed blob (a stamen's tip, a pod)."""
        path = [c + UP * r * (k / 3.0 * 2 - 1) for k in range(4)]
        prof = [0.35, 1.0, 1.0, 0.35]
        self.tube(path, [r * q for q in prof], sides, lambda i: colour, lambda i: emit)

    def tris(self):
        return sum(len(f) - 2 for f in self.F)


def arch(origin, az, el0, el1, length, steps, curve=1.6):
    pts = [np.asarray(origin, float)]
    ds = length / (steps - 1)
    for i in range(steps - 1):
        t = (i + 0.5) / (steps - 1)
        el = el0 + (el1 - el0) * t ** curve
        pts.append(pts[-1] + np.array([math.cos(el) * math.cos(az), math.sin(el), math.cos(el) * math.sin(az)]) * ds)
    return pts


def build(lod):
    cfg = LODS[lod]
    M = Mesh()
    rng = random.Random(907)
    # ---- the strap leaves
    for k in range(cfg['leaves']):
        r = random.Random(1300 + k)
        az = k * GOLDEN + r.uniform(-0.2, 0.2)
        L = r.uniform(0.55, 0.9)
        path = arch(np.array([math.cos(az), 0.0, math.sin(az)]) * 0.04, az, r.uniform(55, 75) * DEG, r.uniform(-40, -10) * DEG, L, cfg['leaf_rows'] + 1)
        side = np.array([-math.sin(az), 0.0, math.cos(az)])
        pts, cols = [], []
        for i, p in enumerate(path):
            t = i / (len(path) - 1)
            w = 0.07 * math.sin(math.pi * min(1.0, 0.12 + t * 0.95)) ** 0.7
            row, crow = [], []
            for j in range(cfg['leaf_cols']):
                q = -1.0 + 2.0 * j / (cfg['leaf_cols'] - 1)
                row.append(p + side * q * w + UP * abs(q) * w * 0.35)
                crow.append(RIB if (abs(q) < 0.01 and cfg['leaf_cols'] > 2) else mix(LEAF, LEAF_LIGHT, t * 0.8 + 0.2 * abs(q)))
            pts.append(row)
            cols.append(crow)
        M.grid(pts, cols)
    # ---- the stems and flowers: three open, one bud
    stems = [dict(h=1.65, az=0.3, lean=0.28), dict(h=1.3, az=2.4, lean=0.35), dict(h=1.05, az=4.3, lean=0.4), dict(h=0.85, az=5.6, lean=0.3, bud=True)]
    for n, st in enumerate(stems):
        if st.get('bud') and not cfg['bud']:
            continue
        # the stem: up, leaning out, nodding at the top
        steps = cfg['stem_rings']
        pts = []
        for i in range(steps):
            t = i / (steps - 1)
            out = st['lean'] * t ** 2.2
            pts.append(np.array([math.cos(st['az']) * (0.05 + out), st['h'] * (t - 0.12 * t ** 4), math.sin(st['az']) * (0.05 + out)]))
        M.tube(pts, [lerp(0.019, 0.011, i / (steps - 1)) for i in range(steps)], cfg['stem_sides'], lambda i: STALK * (0.8 + 0.4 * i / steps), cap=False)
        top = pts[-1]
        axis = norm(pts[-1] - pts[-2] + np.array([math.cos(st['az']), 0.0, math.sin(st['az'])]) * 0.04)      # the flower faces out and a little down
        s, u = frame(axis)
        if st.get('bud'):
            M.tube([top + axis * 0.07 * k for k in range(4)], [0.012, 0.03, 0.026, 0.004], 6, lambda i: mix(STALK, PETAL, i / 3), lambda i: PALE * 0.15 * (i / 3))
            continue
        size = 0.3 + 0.04 * n
        # the trumpet: petals from the throat, flaring out along the axis, the lip curling back
        for p in range(cfg['petals']):
            a = TAU * p / cfg['petals'] + rng.uniform(-0.12, 0.12)
            radial = s * math.cos(a) + u * math.sin(a)
            tang = np.cross(axis, radial)
            rows, cols, ems = [], [], []
            nr = cfg['petal_rows'] + 1
            for i in range(nr):
                t = i / (nr - 1)
                flare = 0.12 + 0.95 * t ** 1.5                  # how far out from the axis
                fwd = 0.85 * t - 0.25 * t ** 3                  # how far along it (the lip turns back)
                c = top + axis * size * fwd + radial * size * flare * 0.62
                w = size * 0.36 * math.sin(math.pi * min(1.0, 0.15 + 0.85 * t)) ** 0.6
                row, crow, erow = [], [], []
                for j in range(cfg['petal_cols']):
                    q = -1.0 + 2.0 * j / (cfg['petal_cols'] - 1)
                    row.append(c + tang * q * w - radial * abs(q) * w * 0.25)
                    crow.append(mix(THROAT, mix(PETAL, PETAL_EDGE, abs(q) * t), smoothstep(0.0, 0.5, t)))
                    erow.append(PALE * 0.55 * (1 - smoothstep(0.0, 0.55, t)))      # the throat glows
                rows.append(row)
                cols.append(crow)
                ems.append(erow)
            M.grid(rows, cols, ems)
        for k in range(cfg['stamens']):
            a = TAU * k / cfg['stamens'] + 0.4
            d = norm(axis + (s * math.cos(a) + u * math.sin(a)) * 0.35)
            path = [top + axis * size * 0.05, top + d * size * 0.45, top + d * size * 0.75 + axis * size * 0.05]
            M.tube(path, [0.003, 0.0025, 0.002], 3, lambda i: PETAL, lambda i: PALE * 0.2 * i, cap=False)
            M.bead(path[-1], 0.013, PETAL_EDGE, PALE * 0.9)
        M.halos.append((top + axis * size * 0.35, 0.4 + 0.05 * n))
    return M


def bake(M, rays=14, reach=0.4, strength=0.55):
    tree = BVHTree.FromPolygons([Vector(v) for v in M.V], [list(f) for f in M.F], all_triangles=False)
    me = bpy.data.meshes.new('ao')
    me.from_pydata([tuple(v) for v in M.V], [], M.F)
    me.update()
    rng = np.random.default_rng(4)
    u1, u2 = rng.random(rays), rng.random(rays)
    local = np.stack([np.sqrt(u1) * np.cos(TAU * u2), np.sqrt(u1) * np.sin(TAU * u2), np.sqrt(1 - u1)], 1)
    out = []
    for i, p in enumerate(M.V):
        n = np.array(me.vertices[i].normal)
        a, b = frame(n)
        hit = 0.0
        for side in (1.0, -1.0):           # thin sheets: both faces see the sky, take the brighter
            h = 0.0
            for d in local:
                loc, _, _, dist = tree.ray_cast(Vector(p + n * side * 0.003), Vector((a * d[0] + b * d[1] + n * d[2]) * side), reach)
                if loc is not None:
                    h += 1.0 - 0.5 * dist / reach
            hit = h if side > 0 else min(hit, h)
        out.append(max(1.0 - strength * hit / rays, 0.4) * lerp(0.7, 1.0, smoothstep(0.0, 0.4, p[1])))
    bpy.data.meshes.remove(me)
    return out


SHADE = {}


def export(lod):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = build(lod)
    if lod == 0:
        s = bake(M)
        SHADE['mean'] = float(np.mean(s))
        M.C = [c * k for c, k in zip(M.C, s)]
    else:
        M.C = [c * SHADE['mean'] for c in M.C]
    me = bpy.data.meshes.new(f'flower_lod{lod}')
    me.from_pydata([tuple(v) for v in M.V], [], M.F)
    m = bpy.data.materials.new('Body')
    m.use_nodes = True
    vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    m.node_tree.links.new(vc.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    me.materials.append(m)
    uv = me.uv_layers.new(name='UVMap')
    for poly, corners in zip(me.polygons, M.UV):
        poly.use_smooth = True
        for loop, c in zip(range(poly.loop_start, poly.loop_start + poly.loop_total), corners):
            uv.data[loop].uv = c
    me.update()
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    col.data.foreach_set('color', np.concatenate([np.asarray(M.C), np.ones((len(M.C), 1))], 1).ravel())
    me.color_attributes.active_color = col
    em = me.attributes.new('_emit', 'FLOAT_VECTOR', 'POINT')
    em.data.foreach_set('vector', np.asarray(M.E, float).ravel())
    # tidy: leaf tips and strip ends that close to a point leave zero-area faces; merge the coincident points and dissolve them (attributes ride along)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges[:])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(f'flower_lod{lod}', me)
    bpy.context.scene.collection.objects.link(ob)
    for p, r in M.halos:
        h = bpy.data.objects.new('halo_pale', None)
        h.location = tuple(p)
        h.scale = (r, r, r)
        bpy.context.scene.collection.objects.link(h)
    path = os.path.join(OUTDIR, f'flower_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=False, export_apply=False, export_animations=False, export_skins=False,
                              export_morph=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_attributes=True, export_normals=True,
                              export_tangents=False, export_texcoords=True, export_materials='EXPORT', export_extras=False, export_image_format='NONE')
    V = np.asarray(M.V)
    print(f'flower_lod{lod}: {M.tris()} tris, {len(M.halos)} halos, {os.path.getsize(path) // 1024} KB, '
          f'x[{V[:, 0].min():.2f},{V[:, 0].max():.2f}] y[{V[:, 1].min():.2f},{V[:, 1].max():.2f}] z[{V[:, 2].min():.2f},{V[:, 2].max():.2f}]', flush=True)


if __name__ == '__main__':
    for lod in (0, 1, 2):
        export(lod)
