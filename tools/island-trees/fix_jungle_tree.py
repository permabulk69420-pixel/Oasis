"""The island's giant jungle trees (jungleA, jungleB, jungleC), fixed up in headless Blender (bpy module).

    python3 tools/island-trees/fix_jungle_tree.py [--only jungleA] [--outdir public/models/island]

Writes <name>_lod0.glb, _lod1.glb, _lod2.glb.

The trunk and limbs are kept as they were (the owner liked the root flare: it is the trunk's own, no loose fins). They live in
tools/island-trees/source/<name>_bark.glb, saved from the game's file the first time this runs: open that in Blender to change a trunk, then run this.
  lod0   the trunk as it is                       lod1   Blender's Decimate (collapse) of it to about 450 triangles
  lod2   the far trunk the old file had (64 triangles: a straight taper reads fine past 150 m)

The crown is redone. It was rosette pictures pointing every which way round each leaf blob, so many were seen edge-on as thin slivers, and its middle
level spent about 1,300 triangles on cards nobody could pick out at 60 m. Now each blob (where the old crown had them, tools/island-trees/jungle_crowns.json)
is a flattened ball of leaf clusters (the canopy atlas, own art) that all FACE OUTWARD and cup round it, so from any side you see into leaves:
  lod0   about 20 cupped clusters a blob, a couple of darker ones inside, shading baked by rays against the whole tree (the inside and the
         underside of the crown darker, so it has depth from the ground)
  lod1   a ring of five big clusters round each blob, one on top and one underneath (about 14 triangles a blob)
  lod2   three round the side and a cap (8 a blob)
Normals lean out from each blob and from the crown as a whole, so the crown lights as soft masses.

What the game reads (src/island-glb.js): "Leaf cards" (the game puts the canopy atlas on it) then "Bark" (the bark photo), COLOR_0 (tint and baked
shading), NORMAL, TEXCOORD_0. The vine anchors (src/island-model-data.js) are on the limbs, which do not change, so they stay right.
Frame: the importer turns glTF's +Y up into Blender's +Z up; everything is turned back and the file written in glTF axes ("Y up" off).
"""
import json
import math
import os
import random
import shutil
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

A = sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUTDIR = A[A.index('--outdir') + 1] if '--outdir' in A else os.path.join(ROOT, 'public', 'models', 'island')
ONLY = A[A.index('--only') + 1] if '--only' in A else None
SPRITES = json.load(open(os.path.join(ROOT, 'public', 'textures', 'island-leaves', 'sprites.json')))['canopy']
CROWNS = json.load(open(os.path.join(HERE, 'jungle_crowns.json')))
TAU, GOLDEN = math.tau, 2.399963229728653
UP = np.array([0.0, 1.0, 0.0])
BARK_TRIS = {1: 450}            # lod1's trunk, by Decimate


def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def rotate(v, axis, angle):
    k = norm(axis)
    return v * math.cos(angle) + np.cross(k, v) * math.sin(angle) + k * np.dot(k, v) * (1 - math.cos(angle))


def to_gltf(v):
    """Blender's +Z-up axes back to glTF's +Y up."""
    return np.array([v[0], v[2], -v[1]])


# ----------------------------------------------------------------------------------------------------------------------------- the trunk
def bark_source(name):
    """The trunk and limbs as their own file: saved once from the game's lod0 and lod2 (the "Bark" primitives only), then always read from there."""
    os.makedirs(os.path.join(HERE, 'source'), exist_ok=True)
    for lod in (0, 2):
        src = os.path.join(HERE, 'source', f'{name}_bark_lod{lod}.glb')
        if os.path.exists(src):
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=os.path.join(OUTDIR, f'{name}_lod{lod}.glb'))
        ob = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bark = [i for i, m in enumerate(ob.data.materials) if 'bark' in m.name.lower()]
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in bark], context='FACES')
        bm.to_mesh(ob.data)
        bm.free()
        bpy.ops.export_scene.gltf(filepath=src, export_format='GLB', export_animations=False, export_vertex_color='ACTIVE', export_normals=True,
                                  export_attributes=False, export_image_format='NONE')
        print('saved the trunk to', os.path.relpath(src, ROOT))
    return {lod: os.path.join(HERE, 'source', f'{name}_bark_lod{lod}.glb') for lod in (0, 2)}


def bark_level(name, lod, sources):
    """The trunk for a level as plain arrays in glTF axes: positions, faces, per-corner uvs, colours and normals."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=sources[2 if lod == 2 else 0])
    ob = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    ob.data.transform(ob.matrix_world)
    ob.matrix_world.identity()
    if lod in BARK_TRIS:
        bpy.context.view_layer.objects.active = ob
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        mod = ob.modifiers.new('Decimate', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = BARK_TRIS[lod] / tris
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    me = ob.data
    me.calc_loop_triangles()
    col = me.color_attributes.get('Color')
    uv = me.uv_layers.active.data
    normals = [to_gltf(n.vector) for n in me.corner_normals]
    out = dict(V=[to_gltf(v.co) for v in me.vertices], F=[], UV=[], C=[], N=[])
    for p in me.polygons:
        loops = range(p.loop_start, p.loop_start + p.loop_total)
        out['F'].append(tuple(me.loops[i].vertex_index for i in loops))
        out['UV'].append(tuple(tuple(uv[i].uv) for i in loops))
        if col is None:
            out['C'].append(tuple((0.4, 0.3, 0.22) for _ in loops))
        elif col.domain == 'CORNER':
            out['C'].append(tuple(tuple(col.data[i].color[:3]) for i in loops))
        else:
            out['C'].append(tuple(tuple(col.data[me.loops[i].vertex_index].color[:3]) for i in loops))
        out['N'].append(tuple(normals[i] for i in loops))
    return out


# ----------------------------------------------------------------------------------------------------------------------------- the crown
LODS = {
    0: dict(rows=2, cols=3),
    1: dict(rings=[(5, 0.0, 1.3), (1, 1.0, 1.4), (1, -1.0, 1.25)], rows=1, cols=2),
    2: dict(rings=[(3, 0.1, 1.6), (1, 1.0, 1.55)], rows=1, cols=2),
}
SQUASH = 0.62           # a blob is a flattened ball, as the old crown's were


def crown(name, lod):
    """The leaf cards of every blob: positions, faces, uvs, colours, and the direction each vertex's normal leans."""
    spec, cfg = CROWNS[name], LODS[lod]
    blobs = spec['blobs']
    middle = np.mean([b['centre'] for b in blobs], axis=0)
    V, F, UV, C, B, G = [], [], [], [], [], []
    for bi, blob in enumerate(blobs):
        c, r = np.array(blob['centre']), blob['radius']
        radii = np.array([r, r * SQUASH, r])
        rng = random.Random(f'{name}-{bi}')
        sprites = spec['sprites']
        places = []
        if lod == 0:
            n = round(9 + 2.4 * r)
            places += [('shell', lerp(-0.6, 0.95, (k + 0.5) / n), k * GOLDEN + rng.uniform(-0.3, 0.3), 1.0) for k in range(n)]
            places += [('inner', rng.uniform(-0.3, 0.5), rng.uniform(0, TAU), 0.8) for _ in range(2)]
        else:
            for ring, (count, y, grow) in enumerate(cfg['rings']):
                places += [('shell', y, (k + 0.5 * ring) * TAU / count + bi, grow) for k in range(count)]
        # the lower blobs, and the underside of every blob, are in the crown's own shade
        low = smoothstep(middle[1] - 6, middle[1] + 6, c[1])
        for kind, y, a, grow in places:
            ring = math.sqrt(max(0.0, 1 - y * y))
            d = np.array([math.cos(a) * ring, y, math.sin(a) * ring])
            out = norm(d / radii)
            centre = c + d * radii * (rng.uniform(0.3, 0.5) if kind == 'inner' else rng.uniform(0.8, 1.0))
            size = r * rng.uniform(0.85, 1.05) * grow
            up_skin = UP - out * np.dot(UP, out)
            along = rotate(norm(up_skin), out, rng.uniform(-1.0, 1.0)) if np.linalg.norm(up_skin) > 1e-3 else norm(np.array([math.cos(a), 0.0, math.sin(a)]))
            across = norm(np.cross(out, along))
            sprite = sprites[rng.randrange(len(sprites))]
            x0, y0, w, h = SPRITES[sprite]
            tone = blob['tone'] * rng.uniform(0.9, 1.08) * lerp(0.62, 1.0, (y + 1) / 2) * lerp(0.75, 1.0, low) * (0.55 if kind == 'inner' else 1.0)
            hue = np.array([rng.uniform(0.95, 1.05), 1.0, rng.uniform(0.92, 1.04)])
            rows, cols = cfg['rows'], cfg['cols']
            cup = 0.14 if cols > 2 else 0.0
            idx = []
            for i in range(rows + 1):
                t = i / rows
                row = []
                for j in range(cols):
                    s = -1.0 + 2.0 * j / (cols - 1)
                    p = centre + along * (t - 0.5) * size + across * s * size * 0.5 - out * cup * size * (s * s + (2 * t - 1) ** 2 * 0.5)
                    V.append(p)
                    C.append(hue * tone)
                    B.append(norm(0.65 * norm(p - c) + 0.35 * norm(p - (middle - UP * 4))))
                    G.append(bi)
                    row.append(len(V) - 1)
                idx.append(row)
            for i in range(rows):
                for j in range(cols - 1):
                    def uv(ii, jj):
                        return ((x0 + 1 + jj / (cols - 1) * (w - 2)) / 1024.0, 1.0 - (y0 + 1 + (1 - ii / rows) * (h - 2)) / 1024.0)
                    F.append((idx[i][j], idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j]))
                    UV.append((uv(i, j), uv(i, j + 1), uv(i + 1, j + 1), uv(i + 1, j)))
    return dict(V=V, F=F, UV=UV, C=C, B=B, G=G)


BLOB_SHADE = {}     # name -> each blob's average darkening from lod0's bake, put on the coarser levels so a tree does not brighten as it switches


def bake_crown(leaf, bark, rays=16, reach=3.5, strength=0.5, seed=3):
    """Ambient occlusion on the leaf cards against the whole tree (the cards count as about half solid: their pictures are about half leaf)."""
    verts = [Vector(v) for v in leaf['V']] + [Vector(v) for v in bark['V']]
    off = len(leaf['V'])
    polys = [list(f) for f in leaf['F']] + [[i + off for i in f] for f in bark['F']]
    tree = BVHTree.FromPolygons(verts, polys, all_triangles=False)
    rng = np.random.default_rng(seed)
    u1, u2 = rng.random(rays), rng.random(rays)
    local = np.stack([np.sqrt(u1) * np.cos(TAU * u2), np.sqrt(u1) * np.sin(TAU * u2), np.sqrt(1 - u1)], 1)
    for i, p in enumerate(leaf['V']):
        n = leaf['B'][i]
        a = norm(np.cross(n, [0.3, 0.9, 0.2]))
        b = np.cross(n, a)
        hit = 0.0
        o = Vector(p + n * 0.02)
        for d in local:
            loc, _, index, dist = tree.ray_cast(o, Vector(a * d[0] + b * d[1] + n * d[2]), reach)
            if loc is not None:
                hit += (0.55 if index < len(leaf['F']) else 1.0) * (1.0 - 0.5 * dist / reach)
        leaf['C'][i] = leaf['C'][i] * max(1.0 - strength * hit / rays, 0.35)


# ----------------------------------------------------------------------------------------------------------------------------- Blender
def export(name, lod, sources):
    bark = bark_level(name, lod, sources)
    leaf = crown(name, lod)
    if lod == 0:
        before = [np.mean(c) for c in leaf['C']]
        bake_crown(leaf, bark)
        ratio = {}
        for i, g in enumerate(leaf['G']):
            ratio.setdefault(g, []).append(np.mean(leaf['C'][i]) / max(before[i], 1e-6))
        BLOB_SHADE[name] = {g: float(np.mean(v)) for g, v in ratio.items()}
    else:
        for i, g in enumerate(leaf['G']):
            leaf['C'][i] = leaf['C'][i] * BLOB_SHADE[name][g]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    off = len(leaf['V'])
    me = bpy.data.meshes.new(f'{name}_lod{lod}')
    me.from_pydata([tuple(v) for v in leaf['V'] + bark['V']], [], leaf['F'] + [tuple(i + off for i in f) for f in bark['F']])
    for mname in ('Leaf cards', 'Bark'):
        m = bpy.data.materials.new(mname)
        m.use_nodes = True
        vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        m.node_tree.links.new(vc.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
        me.materials.append(m)
    uv = me.uv_layers.new(name='UVMap')
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    me.color_attributes.active_color = col
    corner_normals = []
    nleaf = len(leaf['F'])
    for p in me.polygons:
        p.use_smooth = True
        is_bark = p.index >= nleaf
        p.material_index = 1 if is_bark else 0
        f = p.index - nleaf if is_bark else p.index
        for k, loop in enumerate(range(p.loop_start, p.loop_start + p.loop_total)):
            uv.data[loop].uv = bark['UV'][f][k] if is_bark else leaf['UV'][f][k]
            c = bark['C'][f][k] if is_bark else leaf['C'][me.loops[loop].vertex_index]
            col.data[loop].color = (c[0], c[1], c[2], 1.0)
            corner_normals.append(tuple(bark['N'][f][k] if is_bark else leaf['B'][me.loops[loop].vertex_index]))
    me.update()
    me.normals_split_custom_set(corner_normals)
    ob = bpy.data.objects.new(f'{name}_lod{lod}', me)
    bpy.context.scene.collection.objects.link(ob)
    path = os.path.join(OUTDIR, f'{name}_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=False, export_apply=False, export_animations=False, export_skins=False,
                              export_morph=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_normals=True, export_tangents=False,
                              export_texcoords=True, export_materials='EXPORT', export_extras=False, export_image_format='NONE')
    lt = sum(len(f) - 2 for f in leaf['F'])
    bt = sum(len(f) - 2 for f in bark['F'])
    V = np.asarray(leaf['V'] + bark['V'])
    print(f'{name}_lod{lod}: {lt + bt} tris (leaf cards {lt}, bark {bt}), {os.path.getsize(path) // 1024} KB, '
          f'x[{V[:, 0].min():.1f},{V[:, 0].max():.1f}] y[{V[:, 1].min():.1f},{V[:, 1].max():.1f}] z[{V[:, 2].min():.1f},{V[:, 2].max():.1f}]', flush=True)


if __name__ == '__main__':
    for name in CROWNS:
        if ONLY and ONLY != name:
            continue
        sources = bark_source(name)
        for lod in (0, 1, 2):
            export(name, lod, sources)
