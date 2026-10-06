"""The island's glow ferns (fern), built headless in Blender (bpy module). Replaces the old one (flat sawtooth fronds with one small glowing curl).

    python3 tools/island-ferns/build_glow_fern.py [--outdir public/models/island]

Writes fern_lod0.glb, _lod1.glb, _lod2.glb.

A clump of nine fronds arching out of one crown, each a stalk with paired leaflets (longest a third of the way out, shrinking to the tip, each leaflet
cupped and dipping at its point). Under the older fronds runs a row of spore dots that glow cyan, and in the middle two young fronds stand up still
curled into fiddleheads, glowing along the curl. By day it is a dark green fern with a soft glow in it; at night the curls and the spore rows light it
(the game sets the glow strength and puts a cyan halo on each curl: the empty nodes halo_cyan).

Levels (the game switches at 30 m and 70 m; 62 on the island): lod0 everything; lod1 seven fronds with fewer, plainer leaflets and the two curls;
lod2 five fronds as tapered strips.

What the game reads (src/island-glb.js): "Body" (plain colour, the game's own material, double sided), COLOR_0 (shading baked in), NORMAL, _EMIT
and the halo nodes. Frame: glTF axes directly (+Y up, metres, the origin on the ground at the crown), exported with "Y up" off.
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

FERN = np.array([0.016, 0.066, 0.046])
FERN_LIGHT = np.array([0.034, 0.11, 0.075])
STALK = np.array([0.02, 0.062, 0.058])
SORUS = np.array([0.04, 0.12, 0.14])
CYAN = np.array([0.03, 0.62, 1.0])
LODS = {0: dict(fronds=9, steps=10, pairs=16, leaflet=3, sori=True, curl_sides=5, curl_steps=34),
        1: dict(fronds=7, steps=5, pairs=8, leaflet=1, sori=False, curl_sides=3, curl_steps=14),
        2: dict(fronds=5, steps=3, pairs=0, leaflet=0, sori=False, curl_sides=0, curl_steps=0)}


def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def build(lod):
    cfg = LODS[lod]
    V, C, E, F = [], [], [], []
    halos = []

    def vert(p, c, e=None):
        V.append(np.asarray(p, float))
        C.append(np.asarray(c, float))
        E.append(np.zeros(3) if e is None else np.asarray(e, float))
        return len(V) - 1

    def tube(path, radii, sides, colour, emit):
        rings = []
        for i, p in enumerate(path):
            T = norm(path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)])
            s = norm(np.cross(T, UP)) if abs(T[1]) < 0.95 else np.array([1.0, 0.0, 0.0])
            u = np.cross(s, T)
            rings.append([vert(p + (s * math.cos(TAU * k / sides) + u * math.sin(TAU * k / sides)) * radii[i], colour(i), emit(i)) for k in range(sides)])
        for i in range(len(rings) - 1):
            for k in range(sides):
                k2 = (k + 1) % sides
                F.append((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
        tip = vert(path[-1], colour(len(path) - 1), emit(len(path) - 1))
        for k in range(sides):
            F.append((rings[-1][k], rings[-1][(k + 1) % sides], tip))

    def bead(c, r):
        top, bot = vert(c + UP * r, SORUS, CYAN * 0.85), vert(c - UP * r, SORUS, CYAN * 0.85)
        ring = [vert(c + np.array([math.cos(a), 0.0, math.sin(a)]) * r, SORUS, CYAN * 0.85) for a in (0, TAU / 4, TAU / 2, 3 * TAU / 4)]
        for k in range(4):
            F.append((ring[k], ring[(k + 1) % 4], top))
            F.append((ring[(k + 1) % 4], ring[k], bot))

    crown = np.array([0.0, 0.03, 0.0])
    for f in range(cfg['fronds']):
        r = random.Random(4100 + f)
        age = (f + 0.5) / cfg['fronds']
        az = f * GOLDEN + r.uniform(-0.15, 0.15)
        d = np.array([math.cos(az), 0.0, math.sin(az)])
        side0 = np.array([-d[2], 0.0, d[0]])
        L = lerp(0.85, 1.25, math.sin(age * math.pi) ** 0.5) * r.uniform(0.92, 1.08)
        el0, el1 = lerp(72, 38, age) * DEG, lerp(-8, -52, age) * DEG
        n = cfg['steps'] + 1
        path = [crown + d * 0.03]
        for i in range(n - 1):
            t = (i + 0.5) / (n - 1)
            el = el0 + (el1 - el0) * t ** 1.6
            path.append(path[-1] + np.array([math.cos(el) * math.cos(az), math.sin(el), math.cos(el) * math.sin(az)]) * L / (n - 1))
        tone = r.uniform(0.9, 1.1)
        if lod == 2:
            # a tapered strip the width of the frond
            rows = []
            for i, p in enumerate(path):
                t = i / (n - 1)
                w = L * 0.2 * math.sin(math.pi * min(1.0, 0.15 + t * 0.9)) ** 0.7
                rows.append([vert(p - side0 * w, FERN * tone), vert(p + side0 * w, FERN * tone)])
            for i in range(n - 1):
                F.append((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
            continue
        # the stalk: a thin ribbon on edge
        rows = [[vert(p - UP * 0.004 * (1 - i / (n - 1)), STALK), vert(p + UP * 0.004 * (1 - i / (n - 1)), STALK)] for i, p in enumerate(path)]
        for i in range(n - 1):
            F.append((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
        # paired leaflets
        def at(t):
            x = t * (n - 1)
            i = min(int(x), n - 2)
            return path[i] + (path[i + 1] - path[i]) * (x - i), norm(path[i + 1] - path[i])
        for k in range(cfg['pairs']):
            t = 0.12 + 0.86 * (k + 0.5) / cfg['pairs']
            p, T = at(t)
            side = norm(np.cross(T, UP)) if abs(T[1]) < 0.95 else side0
            if np.dot(side, side0) < 0:
                side = -side
            size = L * 0.24 * math.sin(math.pi * min(1.0, 0.25 + t * 0.85)) ** 0.8
            for sgn in (-1.0, 1.0):
                out = norm(side * sgn + T * 0.7)
                w = size * 0.16
                across = norm(np.cross(out, UP)) if abs(out[1]) < 0.95 else T
                tipc = FERN_LIGHT * tone
                if cfg['leaflet'] == 3:
                    b0, b1 = vert(p - across * w * 0.4, FERN * tone), vert(p + across * w * 0.4, FERN * tone)
                    mid = p + out * size * 0.55 - UP * size * 0.05
                    m0, m1 = vert(mid - across * w + UP * w * 0.25, FERN * tone * 1.1), vert(mid + across * w + UP * w * 0.25, FERN * tone * 1.1)
                    tip = vert(p + out * size - UP * size * 0.18, tipc)
                    F.extend([(b0, b1, m1), (b0, m1, m0), (m0, m1, tip)])
                else:
                    b0 = vert(p - T * size * 0.15, FERN * tone)
                    b1 = vert(p + T * size * 0.15, FERN * tone)
                    tip = vert(p + out * size - UP * size * 0.15, tipc)
                    F.append((b0, b1, tip))
            if cfg['sori'] and age > 0.35 and 0.3 < t < 0.85 and k % 2 == 0:
                for sgn in (-1.0, 1.0):
                    bead(p + side * sgn * size * 0.35 - UP * 0.012, 0.009)
    # two young fronds still curled into fiddleheads, glowing along the curl
    if cfg['curl_steps']:
        for c in range(2):
            az = c * 2.6 + 0.4
            d = np.array([math.cos(az), 0.0, math.sin(az)])
            h = 0.42 + 0.12 * c
            n = cfg['curl_steps']
            path = []
            for i in range(n):
                t = i / (n - 1)
                if t < 0.35:
                    path.append(crown + d * 0.03 + UP * h * (t / 0.35) + d * 0.05 * (t / 0.35) ** 2)
                else:
                    a = (t - 0.35) / 0.65 * 1.8 * TAU                  # the crozier: a spiral tightening inward
                    rad = 0.07 * (1 - 0.8 * (t - 0.35) / 0.65)
                    centre = crown + d * 0.08 + UP * (h - 0.07)
                    path.append(centre + d * rad * math.sin(a) + UP * rad * math.cos(a))
            tube(path, [lerp(0.011, 0.005, i / (n - 1)) for i in range(n)], cfg['curl_sides'],
                 lambda i: STALK * 1.3, lambda i, n=n: CYAN * 0.9 * smoothstep(0.45, 0.8, i / (n - 1)))
            halos.append((crown + d * 0.08 + UP * (h - 0.07), 0.35))
    return dict(V=V, C=C, E=E, F=F, halos=halos)


def bake(M, rays=14, reach=0.4, strength=0.55):
    tree = BVHTree.FromPolygons([Vector(v) for v in M['V']], [list(f) for f in M['F']], all_triangles=False)
    me = bpy.data.meshes.new('ao')
    me.from_pydata([tuple(v) for v in M['V']], [], M['F'])
    me.update()
    rng = np.random.default_rng(8)
    u1, u2 = rng.random(rays), rng.random(rays)
    local = np.stack([np.sqrt(u1) * np.cos(TAU * u2), np.sqrt(u1) * np.sin(TAU * u2), np.sqrt(1 - u1)], 1)
    out = []
    for i, p in enumerate(M['V']):
        n = np.array(me.vertices[i].normal)
        if n[1] < 0:
            n = -n                                  # thin sheets: look up from whichever face looks up
        a = norm(np.cross(n, [0.3, 0.9, 0.2]))
        b = np.cross(n, a)
        hit = 0.0
        for d in local:
            loc, _, _, dist = tree.ray_cast(Vector(p + n * 0.003), Vector(a * d[0] + b * d[1] + n * d[2]), reach)
            if loc is not None:
                hit += 1.0 - 0.5 * dist / reach
        out.append(max(1.0 - strength * hit / rays, 0.4) * lerp(0.7, 1.0, smoothstep(0.0, 0.35, p[1])))
    bpy.data.meshes.remove(me)
    return out


SHADE = {}


def export(lod):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = build(lod)
    if lod == 0:
        s = bake(M)
        SHADE['mean'] = float(np.mean(s))
        M['C'] = [c * k for c, k in zip(M['C'], s)]
    else:
        M['C'] = [c * SHADE['mean'] for c in M['C']]
    me = bpy.data.meshes.new(f'fern_lod{lod}')
    me.from_pydata([tuple(v) for v in M['V']], [], M['F'])
    m = bpy.data.materials.new('Body')
    m.use_nodes = True
    vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    m.node_tree.links.new(vc.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    me.materials.append(m)
    me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        poly.use_smooth = True
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    col.data.foreach_set('color', np.concatenate([np.asarray(M['C']), np.ones((len(M['C']), 1))], 1).ravel())
    me.color_attributes.active_color = col
    em = me.attributes.new('_emit', 'FLOAT_VECTOR', 'POINT')
    em.data.foreach_set('vector', np.asarray(M['E'], float).ravel())
    # tidy: leaf tips and strip ends that close to a point leave zero-area faces; merge the coincident points and dissolve them (attributes ride along)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges[:])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(f'fern_lod{lod}', me)
    bpy.context.scene.collection.objects.link(ob)
    for p, r in M['halos']:
        h = bpy.data.objects.new('halo_cyan', None)
        h.location = tuple(p)
        h.scale = (r, r, r)
        bpy.context.scene.collection.objects.link(h)
    path = os.path.join(OUTDIR, f'fern_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=False, export_apply=False, export_animations=False, export_skins=False,
                              export_morph=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_attributes=True, export_normals=True,
                              export_tangents=False, export_texcoords=True, export_materials='EXPORT', export_extras=False, export_image_format='NONE')
    V = np.asarray(M['V'])
    tris = sum(len(f) - 2 for f in M['F'])
    print(f'fern_lod{lod}: {tris} tris, {len(M["halos"])} halos, {os.path.getsize(path) // 1024} KB, x[{V[:, 0].min():.2f},{V[:, 0].max():.2f}] '
          f'y[{V[:, 1].min():.2f},{V[:, 1].max():.2f}]', flush=True)


if __name__ == '__main__':
    for lod in (0, 1, 2):
        export(lod)
