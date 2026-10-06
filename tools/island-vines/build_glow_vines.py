"""The glowing vines that hang off the island's cliff rim and under the hollow's overhang (vines), built headless in Blender (bpy module). Replaces the
old ones (thin strands with flat diamond leaves and diamond beads).

    python3 tools/island-vines/build_glow_vines.py [--outdir public/models/island]

Writes vines_lod0.glb, _lod1.glb, _lod2.glb.

Six ropy vines hang from a line about 3.6 m long (the origin is the middle of the edge they hang from; they fall along -Y), each a different length
(to about 3.7 m), twisting a little as they fall. Curved heart-shaped leaves alternate down each one, smaller toward the tip, and clusters of
glowing pods hang at a few nodes and at every tip. Every vertex carries a sway weight (the custom attribute _SWAY, 0 at the top to 1 at the bottom)
that the game's hanging-sway patch swings in the wind; the brightest pod clusters carry a cyan halo (empty nodes halo_cyan).

Levels (the game switches at 30 m and 70 m): lod0 everything; lod1 five vines, plainer, a leaf in two; lod2 four vines as three-sided ropes and their tip pods.

What the game reads (src/island-glb.js): "Body" (plain colour, the game's own material, double sided), COLOR_0 (shading), NORMAL, _EMIT (glow),
_SWAY and the halo nodes. Frame: glTF axes directly (+Y up, metres), exported with "Y up" off.
"""
import math
import os
import random
import sys

import bpy
import bmesh  # must come after bpy
import numpy as np

A = sys.argv
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUTDIR = A[A.index('--outdir') + 1] if '--outdir' in A else os.path.join(ROOT, 'public', 'models', 'island')
TAU = math.tau
UP = np.array([0.0, 1.0, 0.0])
DEPTH = 3.7                          # the longest vine; sway runs 0..1 over it

ROPE = np.array([0.02, 0.05, 0.048])
LEAF = np.array([0.014, 0.055, 0.042])
LEAF_LIGHT = np.array([0.03, 0.1, 0.075])
POD = np.array([0.05, 0.14, 0.18])
CYAN = np.array([0.03, 0.62, 1.0])
# (x along the edge, z off it, length)
VINES = [(-1.6, 0.05, 3.1), (-0.95, -0.08, 3.7), (-0.25, 0.1, 2.4), (0.4, -0.05, 3.4), (1.05, 0.08, 2.0), (1.75, -0.04, 2.9)]
LODS = {0: dict(vines=6, sides=5, step=0.3, leaf_every=1, leaf_rows=3, leaf_cols=3, pod_sides=6),
        1: dict(vines=5, sides=3, step=0.6, leaf_every=2, leaf_rows=1, leaf_cols=2, pod_sides=4),
        2: dict(vines=4, sides=3, step=1.2, leaf_every=0, leaf_rows=1, leaf_cols=2, pod_sides=3)}


def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)


def build(lod):
    cfg = LODS[lod]
    V, C, E, S, F = [], [], [], [], []
    halos = []

    def vert(p, c, e=None):
        V.append(np.asarray(p, float))
        C.append(np.asarray(c, float))
        E.append(np.zeros(3) if e is None else np.asarray(e, float))
        S.append(min(1.0, max(0.0, -p[1] / DEPTH)) ** 1.1)
        return len(V) - 1

    def tube(path, radii, sides, colour, emit=None, cap=True):
        rings = []
        for i, p in enumerate(path):
            T = norm(path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)])
            s = norm(np.cross(T, [0.0, 0.0, 1.0]) if abs(T[2]) < 0.9 else np.cross(T, [1.0, 0.0, 0.0]))
            u = np.cross(s, T)
            rings.append([vert(p + (s * math.cos(TAU * k / sides) + u * math.sin(TAU * k / sides)) * radii[i], colour, emit) for k in range(sides)])
        for i in range(len(rings) - 1):
            for k in range(sides):
                k2 = (k + 1) % sides
                F.append((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
        if cap:
            for end, sign in ((0, -1), (len(rings) - 1, 1)):
                T = norm(path[-1] - path[-2]) if sign > 0 else norm(path[0] - path[1])
                c = vert(path[end] + T * radii[end] * 0.8, colour, emit)
                for k in range(sides):
                    a, b = rings[end][k], rings[end][(k + 1) % sides]
                    F.append((a, b, c) if sign > 0 else (b, a, c))

    def pod(c, r, glow):
        n = cfg['pod_sides']
        tube([c + UP * r * 0.9, c, c - UP * r * 1.1], [r * 0.45, r, r * 0.55], n, POD, CYAN * glow)

    for vi, (x, z, L) in enumerate(VINES[:cfg['vines']] if lod == 0 else [VINES[i] for i in (1, 3, 0, 5, 2)[:cfg['vines']]]):
        rng = random.Random(70 + vi)
        ph = rng.uniform(0, TAU)
        n = max(3, int(round(L / cfg['step'])) + 1)
        path = []
        for i in range(n):
            t = i / (n - 1)
            path.append(np.array([x + 0.12 * math.sin(t * 5.0 + ph) * t, -L * t, z + 0.1 * math.cos(t * 4.0 + ph) * t + 0.15 * t ** 2]))
        radii = [0.018 * (1.0 - 0.55 * i / (n - 1)) for i in range(n)]
        tube(path, radii, cfg['sides'], ROPE)
        # leaves, alternating sides down the vine, smaller toward the tip
        if cfg['leaf_every']:
            k = 0
            y = -0.15
            while -y < L - 0.2:
                k += 1
                y -= rng.uniform(0.1, 0.15)
                if k % cfg['leaf_every']:
                    continue
                t = min(1.0, -y / L)
                at = np.array([x + 0.12 * math.sin(t * 5.0 + ph) * t, y, z + 0.1 * math.cos(t * 4.0 + ph) * t + 0.15 * t ** 2])
                az = (k % 2) * math.pi + rng.uniform(-0.7, 0.7) + vi
                out = np.array([math.cos(az), 0.0, math.sin(az)])
                side = np.array([-out[2], 0.0, out[0]])
                size = 0.21 * (1.0 - 0.4 * t) * rng.uniform(0.85, 1.15)
                rows, cols = cfg['leaf_rows'] + 1, cfg['leaf_cols']
                grid = []
                for i in range(rows):
                    s = i / (rows - 1)
                    c = at + out * size * (0.1 + 0.9 * s) + UP * size * (0.15 - 0.55 * s * s)     # out from the vine, then drooping
                    w = size * 0.62 * math.sin(math.pi * min(1.0, 0.3 + s * 0.8)) ** 0.6           # a broad heart, widest a third of the way out
                    row = []
                    for j in range(cols):
                        q = -1.0 + 2.0 * j / (cols - 1)
                        row.append(vert(c + side * q * w + UP * abs(q) * w * 0.3, LEAF_LIGHT * 0.9 if (abs(q) < 0.01) else LEAF * (0.85 + 0.3 * s)))
                    grid.append(row)
                for i in range(rows - 1):
                    for j in range(cols - 1):
                        F.append((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
        # glowing pods: a cluster at the tip, and a few at nodes on the longer vines
        tip = path[-1]
        for p in range(3 if lod < 2 else 1):
            pod(tip + np.array([0.03 * math.cos(p * 2.1), -0.05 - 0.04 * p, 0.03 * math.sin(p * 2.1)]), 0.03 - 0.005 * p, 0.9)
        if lod == 0 and L > 2.8:
            for t in (0.45, 0.72):
                at = path[int(t * (n - 1))]
                pod(at + np.array([0.04, -0.04, 0.0]), 0.022, 0.75)
                pod(at + np.array([-0.03, -0.07, 0.02]), 0.018, 0.7)
        if vi in (1, 3, 5):
            halos.append((tip - UP * 0.08, 0.5))
    return dict(V=V, C=C, E=E, S=S, F=F, halos=halos)


def export(lod):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = build(lod)
    me = bpy.data.meshes.new(f'vines_lod{lod}')
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
    sw = me.attributes.new('_sway', 'FLOAT', 'POINT')
    sw.data.foreach_set('value', np.asarray(M['S'], float))
    # tidy: leaf tips and strip ends that close to a point leave zero-area faces; merge the coincident points and dissolve them (attributes ride along)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges[:])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(f'vines_lod{lod}', me)
    bpy.context.scene.collection.objects.link(ob)
    for p, r in M['halos']:
        h = bpy.data.objects.new('halo_cyan', None)
        h.location = tuple(p)
        h.scale = (r, r, r)
        bpy.context.scene.collection.objects.link(h)
    path = os.path.join(OUTDIR, f'vines_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=False, export_apply=False, export_animations=False, export_skins=False,
                              export_morph=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_attributes=True, export_normals=True,
                              export_tangents=False, export_texcoords=True, export_materials='EXPORT', export_extras=False, export_image_format='NONE')
    V = np.asarray(M['V'])
    tris = sum(len(f) - 2 for f in M['F'])
    print(f'vines_lod{lod}: {tris} tris, {len(M["halos"])} halos, {os.path.getsize(path) // 1024} KB, x[{V[:, 0].min():.2f},{V[:, 0].max():.2f}] '
          f'y[{V[:, 1].min():.2f},{V[:, 1].max():.2f}]', flush=True)


if __name__ == '__main__':
    for lod in (0, 1, 2):
        export(lod)
