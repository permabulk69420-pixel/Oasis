"""The island's twisted root arch (rootArch), fixed up in headless Blender (bpy module). The arch itself (a braid of roots with glowing seams and glowing
tendrils hanging under the crown) is kept; what was wrong with it is fixed:
  - six loose horn-shaped roots were stuck on round the two feet: they are deleted, and the braid's OWN strands splay apart at each foot and dive into
    the ground (each strand is twisted round to a different side there, so they fan out like roots growing from the arch, swelling as they go under)
  - moss on the faces that look up, and shading baked into the vertex colours (rays against the arch: inside the braid and under it darker)

    python3 tools/island-trees/fix_root_arch.py [--outdir public/models/island]

Reads tools/island-trees/source/rootArch_lod{0,1,2}.glb (saved from the game's files the first time this runs; open those in Blender to change the arch)
and writes public/models/island/rootArch_lod{0,1,2}.glb.

What the game reads (src/island-glb.js): "Body" (plain colour, the game's own material), COLOR_0, NORMAL, _EMIT (the seams and tendril tips glow) and
the halo nodes (kept). The importer turns glTF's +Y up into Blender's +Z up and the exporter turns it back.
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
NAME = 'rootArch'
SPLAY = dict(height=1.5, reach=0.95, sink=0.9, swell=0.3)     # metres up the foot it starts, how far out and down it goes, how much fatter
MOSS = (0.035, 0.085, 0.05)


def source(lod):
    src = os.path.join(HERE, 'source', f'{NAME}_lod{lod}.glb')
    if not os.path.exists(src):
        os.makedirs(os.path.dirname(src), exist_ok=True)
        shutil.copyfile(os.path.join(OUTDIR, f'{NAME}_lod{lod}.glb'), src)
        print('saved the original to', os.path.relpath(src, ROOT))
    return src


def parts_of(bm):
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
    parts = parts_of(bm)
    span = lambda p: max(v.co.z for v in p)                                       # noqa: E731
    strands = [p for p in parts if span(p) > 4.5 and min(v.co.z for v in p) < 0.2]
    roots = [p for p in parts if min(v.co.z for v in p) < 0.0 and span(p) < 2.2 and len(p) > 12]
    bmesh.ops.delete(bm, geom=[v for p in roots for v in p], context='VERTS')
    # the two feet: the middle of the braid's strands near the ground, one each side
    low = [v.co for p in strands for v in p if v.is_valid and v.co.z < 0.4]
    feet = {}
    for side in (-1, 1):
        pts = [c for c in low if c.x * side > 0]
        feet[side] = Vector((sum(c.x for c in pts) / len(pts), sum(c.y for c in pts) / len(pts), 0.0))
    # each strand splays: at every height below SPLAY.height its ring slides out from its foot's middle (and down), growing toward the ground
    for p in strands:
        verts = [v for v in p if v.is_valid and v.co.z < SPLAY['height']]
        # one direction for the whole strand (where its foot end sits round the foot), so it bends out smoothly
        end = [v.co for v in verts if v.co.z < 0.3]
        if not end:
            continue
        c0 = sum(end, Vector()) / len(end)
        foot = feet[-1 if c0.x < 0 else 1]
        out = Vector((c0.x - foot.x, c0.y - foot.y, 0.0))
        out = (out.normalized() if out.length > 1e-3 else Vector((0.0, 0.0, 0.0))) + Vector((foot.x, foot.y, 0.0)).normalized() * 0.6
        out.normalize()                                                              # and away from the arch's middle
        bands = {}
        for v in verts:
            bands.setdefault(round(v.co.z / 0.12), []).append(v)
        for band in bands.values():
            c = sum((v.co for v in band), Vector()) / len(band)
            for v in band:
                h = 1.0 - min(1.0, max(0.0, v.co.z / SPLAY['height']))
                k = h * h
                ring = v.co - c
                v.co = c + ring * (1.0 + SPLAY['swell'] * k) + out * SPLAY['reach'] * k - Vector((0.0, 0.0, SPLAY['sink'] * k))
    bm.to_mesh(me)
    bm.free()
    if 'custom_normal' in me.attributes:
        me.attributes.remove(me.attributes['custom_normal'])
    for poly in me.polygons:
        poly.use_smooth = True
    me.update()
    print(f'{NAME}_lod{lod}: removed {len(roots)} loose roots, splayed {len(strands)} braid strands into the ground')
    return ob


def shade(ob, rays=16, reach=1.5, strength=0.5, bake=True):
    """Moss on the faces that look up and ambient occlusion against the arch itself, into the colour attribute. Returns the mean darkening."""
    me = ob.data
    verts = [v.co.copy() for v in me.vertices]
    tree = BVHTree.FromPolygons(verts, [list(p.vertices) for p in me.polygons], all_triangles=False)
    rng = np.random.default_rng(12)
    u1, u2 = rng.random(rays), rng.random(rays)
    local = np.stack([np.sqrt(u1) * np.cos(math.tau * u2), np.sqrt(u1) * np.sin(math.tau * u2), np.sqrt(1 - u1)], 1)
    emit = me.attributes.get('_EMIT')
    occ, moss = [], []
    for v in me.vertices:
        n = v.normal.copy()
        glowing = emit is not None and max(emit.data[v.index].vector) > 0.05
        moss.append(0.0 if glowing else max(0.0, min(1.0, (n.z - 0.35) / 0.4)))
        if not bake:
            occ.append(1.0)
            continue
        a = n.cross(Vector((0.3, 0.2, 0.9))).normalized()
        b = n.cross(a)
        hit = 0.0
        o = v.co + n * 0.01
        for d in local:
            loc, _, _, dist = tree.ray_cast(o, a * d[0] + b * d[1] + n * d[2], reach)
            if loc is not None:
                hit += 1.0 - 0.5 * dist / reach
        occ.append(max(1.0 - strength * hit / rays, 0.4) * (0.75 + 0.25 * min(1.0, max(0.0, v.co.z / 1.5))))
    col = me.color_attributes.active_color or me.color_attributes[0]

    def paint(i, c):
        m = moss[i] * 0.7
        r = [c[k] * (1 - m) + MOSS[k] * m for k in range(3)]
        return (r[0] * occ[i], r[1] * occ[i], r[2] * occ[i], c[3])
    if col.domain == 'POINT':
        for i, d in enumerate(col.data):
            d.color = paint(i, d.color)
    else:
        for loop in me.loops:
            d = col.data[loop.index]
            d.color = paint(loop.vertex_index, d.color)
    return float(np.mean(occ))


def export(lod, mean=None):
    ob = fix(lod)
    if mean is None:
        mean = shade(ob)
    else:
        shade(ob, bake=False)
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
