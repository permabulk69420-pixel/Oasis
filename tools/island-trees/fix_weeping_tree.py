"""The island's weeping glow-tree (weepingTree), fixed up in headless Blender (bpy module). The tree itself (the twisting trunk with its glow seams,
the arching limbs, the hanging strands and glowing pods) is kept; what was wrong with it is fixed:
  - five loose root fins stood against the foot (one read as a pale peg from the front): they are deleted and the trunk's own foot swells into five
    buttress lobes instead (the rule for every island tree: roots are the trunk's own flare, nothing loose)
  - shading baked into the vertex colours (rays against the tree: the inside of the crown, under the limbs and the foot darker)

    python3 tools/island-trees/fix_weeping_tree.py [--outdir public/models/island]

Reads tools/island-trees/source/weepingTree_lod{0,1,2}.glb (saved from the game's files the first time this runs; open those in Blender to change
the tree) and writes public/models/island/weepingTree_lod{0,1,2}.glb.

What the game reads (src/island-glb.js): "Body" (plain colour, the game's own material), COLOR_0, NORMAL, _EMIT (the seams and pods glow), _SWAY
(the strands' hanging weight) and the halo nodes (kept as they were). The importer turns glTF's +Y up into Blender's +Z up and the exporter turns it back.
"""
import math
import os
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
NAME = 'weepingTree'
FLARE = dict(height=1.1, swell=0.85, lobes=5)       # the foot: how high it swells, by how much, in how many lobes


def source(lod):
    src = os.path.join(HERE, 'source', f'{NAME}_lod{lod}.glb')
    if not os.path.exists(src):
        os.makedirs(os.path.dirname(src), exist_ok=True)
        shutil.copyfile(os.path.join(OUTDIR, f'{NAME}_lod{lod}.glb'), src)
        print('saved the original to', os.path.relpath(src, ROOT))
    return src


def parts_of(bm):
    """Connected pieces of the mesh, as lists of vertices."""
    seen, parts = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        parts.append(comp)
    return parts


def fix(lod):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=source(lod))
    ob = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    parts = parts_of(bm)
    trunk = max(parts, key=lambda p: max(v.co.z for v in p) - min(v.co.z for v in p) if min(v.co.z for v in p) < 0.2 else -1)
    trunk_ids = {v.index for v in trunk}
    # ---- the loose root fins: pieces that start below the ground and stay low, other than the trunk
    fins = [p for p in parts if p is not trunk and min(v.co.z for v in p) < 0.0 and max(v.co.z for v in p) < 1.6 and len(p) > 12]
    bmesh.ops.delete(bm, geom=[v for p in fins for v in p], context='VERTS')
    bm.verts.ensure_lookup_table()
    # ---- the foot swells into buttress lobes (only the trunk's own vertices, pushed out from its middle at their height)
    low = [v for v in trunk if v.is_valid and v.co.z < FLARE['height']]
    for v in low:
        band = [o for o in trunk if o.is_valid and abs(o.co.z - v.co.z) < 0.08]
        cx = sum(o.co.x for o in band) / len(band)
        cy = sum(o.co.y for o in band) / len(band)
        dx, dy = v.co.x - cx, v.co.y - cy
        a = math.atan2(dy, dx)
        h = 1.0 - min(1.0, max(0.0, v.co.z / FLARE['height']))
        lobe = 0.55 + 0.45 * max(0.0, math.cos(a * FLARE['lobes'] + 0.6)) ** 2
        k = 1.0 + FLARE['swell'] * h * h * lobe * 2.0
        v.co.x, v.co.y = cx + dx * k, cy + dy * k
    bm.to_mesh(me)
    bm.free()
    if 'custom_normal' in me.attributes:             # the imported normals are stale where the foot moved: let Blender shade it smooth again
        me.attributes.remove(me.attributes['custom_normal'])
    for poly in me.polygons:
        poly.use_smooth = True
    me.update()
    print(f'{NAME}_lod{lod}: removed {len(fins)} loose root fins')
    return ob


def bake(ob, rays=16, reach=1.4, strength=0.5):
    """Ambient occlusion per vertex against the tree itself, into the colour attribute."""
    me = ob.data
    verts = [v.co.copy() for v in me.vertices]
    tree = BVHTree.FromPolygons(verts, [list(p.vertices) for p in me.polygons], all_triangles=False)
    rng = np.random.default_rng(6)
    u1, u2 = rng.random(rays), rng.random(rays)
    local = np.stack([np.sqrt(u1) * np.cos(math.tau * u2), np.sqrt(u1) * np.sin(math.tau * u2), np.sqrt(1 - u1)], 1)
    shade = []
    for v in me.vertices:
        n = v.normal.copy()
        if n.z < -0.2 and v.co.z > 2.0:
            n = -n                                  # thin hanging strands and leaves: look out from whichever face looks up
        a = n.cross(Vector((0.3, 0.2, 0.9))).normalized()
        b = n.cross(a)
        hit = 0.0
        o = v.co + n * 0.01
        for d in local:
            loc, _, _, dist = tree.ray_cast(o, a * d[0] + b * d[1] + n * d[2], reach)
            if loc is not None:
                hit += 1.0 - 0.5 * dist / reach
        foot = 0.7 + 0.3 * min(1.0, max(0.0, v.co.z / 1.2))
        shade.append(max(1.0 - strength * hit / rays, 0.4) * foot)
    col = me.color_attributes.active_color or me.color_attributes[0]
    if col.domain == 'POINT':
        for i, s in enumerate(shade):
            c = col.data[i].color
            col.data[i].color = (c[0] * s, c[1] * s, c[2] * s, c[3])
    else:
        for loop in me.loops:
            s = shade[loop.vertex_index]
            c = col.data[loop.index].color
            col.data[loop.index].color = (c[0] * s, c[1] * s, c[2] * s, c[3])
    return float(np.mean(shade))


def export(lod, mean=None):
    ob = fix(lod)
    if mean is None:
        mean = bake(ob)
    else:
        col = ob.data.color_attributes.active_color or ob.data.color_attributes[0]
        for d in col.data:
            c = d.color
            d.color = (c[0] * mean, c[1] * mean, c[2] * mean, c[3])
    path = os.path.join(OUTDIR, f'{NAME}_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_animations=False, export_skins=False,
                              export_morph=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_attributes=True, export_normals=True,
                              export_tangents=False, export_texcoords=True, export_materials='EXPORT', export_extras=False, export_image_format='NONE')
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    halos = sum(1 for o in bpy.context.scene.objects if o.name.startswith('halo_'))
    print(f'{NAME}_lod{lod}: {tris} tris, {halos} halos, {os.path.getsize(path) // 1024} KB', flush=True)
    return mean


if __name__ == '__main__':
    m = export(0)
    export(1, m)
    export(2, m)
