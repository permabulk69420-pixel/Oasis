"""The island's stone, built headless in Blender (bpy module): a kit of rocks the game places from its layout (src/sky-island-rocks.js layoutRocks says
where every stone goes and how big; the game takes a piece of this kit for each, scales it to the stone's size and colours it with the ground's own
moss and tone, src/sky-island-rocks.js createRockMeshes).

    python3 tools/island-rocks/build_rocks.py [--outdir public/models/island]

Writes rocks_lod0.glb, rocks_lod1.glb, rocks_lod2.glb, each holding every piece of the kit as its own named object (open one in Blender to see them all):
  boulderA..D   fractured blocks: a lumpy ball cut by several flat fracture planes (Blender's bisect, the cut faces filled), edges chipped, flat
                underneath where it sits in the ground (left open: it is buried)
  pebbleA, B    rounded, water-worn stones (few, soft cuts): the small stones, the shingle and the lake's shallows
  slab          a closed, flattened block (its underside shows): the lookout ledge and the hollow's overhang
  column        a tapering, twisting blade of faceted stone with banded strata and a broken top: the spire's five blades (the game leans each one)
Every piece is unit sized round its middle (a ball of radius 1; the column 1 high on a base of radius 1, buried 0.12 under its foot), so the layout's
half sizes scale it straight. Shaded smooth by angle: the rounded body is smooth, the fracture edges stay crisp (Kane wanted smoother stone than the
old faceted blocks).

The three levels are the same stone: lod0 is the full shape, lod1 and lod2 are Blender's Decimate of it (about a quarter and a sixteenth). The game picks
by the stone's size (the stones are merged per patch of island and drawn whole): small stones use lod2, middling lod1, the big ones and landmarks lod0.

Frame: built in Blender's +Z up, exported with "Y up" on (so +Y up in the file, as the game expects).
"""
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector, noise

A = sys.argv
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUTDIR = A[A.index('--outdir') + 1] if '--outdir' in A else os.path.join(ROOT, 'public', 'models', 'island')
TAU = math.tau
LEVELS = {1: 0.25, 2: 0.065}             # Decimate ratios for lod1 and lod2
SHARP = math.radians(38)                 # an edge sharper than this stays a crisp edge; the rest shades smooth

# kind, seed, (fracture cuts, how deep they bite 0..1), lump strength, bottom cut (None: closed), squash
PIECES = {
    'boulderA': dict(seed=11, cuts=5, bite=0.7, lump=0.35, bottom=-0.55),
    'boulderB': dict(seed=23, cuts=6, bite=0.66, lump=0.3, bottom=-0.55),
    'boulderC': dict(seed=37, cuts=4, bite=0.62, lump=0.4, bottom=-0.55),
    'boulderD': dict(seed=41, cuts=7, bite=0.72, lump=0.28, bottom=-0.55),
    'pebbleA': dict(seed=53, cuts=2, bite=0.85, lump=0.18, bottom=-0.6),
    'pebbleB': dict(seed=67, cuts=1, bite=0.9, lump=0.22, bottom=-0.6),
    'slab': dict(seed=79, cuts=5, bite=0.75, lump=0.25, bottom=None),
}


def boulder(name, spec):
    rng = random.Random(spec['seed'])
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
    off = Vector((rng.uniform(0, 50), rng.uniform(0, 50), rng.uniform(0, 50)))
    for v in bm.verts:
        d = v.co.normalized()
        lump = noise.noise(d * 1.4 + off) * 0.6 + noise.noise(d * 3.1 + off * 1.7) * 0.4
        v.co = d * (1.0 + lump * spec['lump'])
    # fracture planes: each cuts the stone flat where it bites, the cut face filled (a real broken face, not a dent)
    for k in range(spec['cuts']):
        phi = rng.uniform(0, TAU)
        nz = rng.uniform(-0.15, 0.95)
        rr = math.sqrt(max(0.0, 1 - nz * nz))
        n = Vector((math.cos(phi) * rr, math.sin(phi) * rr, nz))
        dist = spec['bite'] + rng.uniform(0.0, 0.18)
        res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=n * dist, plane_no=n, clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    # chips: a little fine noise over everything so the planes are not glassy
    for v in bm.verts:
        v.co += v.co.normalized() * noise.noise(v.co * 7.0 + off) * 0.025
    if spec['bottom'] is not None:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, spec['bottom']), plane_no=(0, 0, -1), clear_outer=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def column():
    """A blade of stone 1 high (buried 0.12) on a base of radius 1, tapering to 0.18, faceted on 10 sides, banded, twisting 0.7 rad, broken at the top."""
    rng = random.Random(7001)
    bm = bmesh.new()
    sides, rings = 10, 22
    jitter = [0.86 + rng.uniform(0, 0.26) for _ in range(sides)]
    grid = []
    for k in range(rings + 1):
        t = k / rings
        h = -0.12 + 1.12 * t
        u = max(h, 0.0)
        taper = 1.0 + (0.18 - 1.0) * u ** 0.85
        taper *= 1.0 + 0.3 * max(0.0, -h) * 4
        strata = 1.0 + 0.075 * math.sin(h * 40.0) + 0.05 * math.sin(h * 91.0)
        row = []
        for s in range(sides):
            a = (s / sides) * TAU + 0.7 * min(max(u, 0.0), 1.0)
            lump = 0.9 + 0.2 * (noise.noise(Vector((math.cos(a) * 1.4, h * 9.0, math.sin(a) * 1.4))) * 0.5 + 0.5)
            r = taper * strata * jitter[s] * lump
            row.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, h)))
        grid.append(row)
    for k in range(rings):
        for s in range(sides):
            s2 = (s + 1) % sides
            bm.faces.new((grid[k][s], grid[k][s2], grid[k + 1][s2], grid[k + 1][s]))
    top = grid[-1]
    cx = sum(v.co.x for v in top) / sides + rng.uniform(-0.07, 0.07)
    cy = sum(v.co.y for v in top) / sides + rng.uniform(-0.07, 0.07)
    apex = bm.verts.new((cx, cy, 1.0 + 0.12))
    for s in range(sides):
        bm.faces.new((top[s], top[(s + 1) % sides], apex))
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def make_object(name, bm, ratio=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if ratio:
        bpy.context.view_layer.objects.active = ob
        mod = ob.modifiers.new('Decimate', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # smooth by angle: the rounded body shades smooth, the fracture edges and the chips stay crisp
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = not (e.is_manifold and e.calc_face_angle(0.0) > SHARP)
    bm.to_mesh(me)
    bm.free()
    mat = bpy.data.materials.get('Island stone') or bpy.data.materials.new('Island stone')
    me.materials.append(mat)
    return ob


def build(lod):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    report = []
    for i, (name, spec) in enumerate(PIECES.items()):
        bm = boulder(name, spec)
        ob = make_object(name, bm, LEVELS.get(lod))
        bm.free()
        ob.location = ((i - 3) * 3.0, 0.0, 0.0)            # side by side, so a look in Blender shows the whole kit
        report.append(f'{name} {len(ob.data.polygons)}')
    bm = column()
    ob = make_object('column', bm, LEVELS.get(lod) and min(0.6, LEVELS[lod] * 3))
    bm.free()
    ob.location = (len(PIECES) * 3.0 - 9.0, 0.0, 0.0)
    report.append(f'column {len(ob.data.polygons)}')
    path = os.path.join(OUTDIR, f'rocks_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_animations=False, export_skins=False,
                              export_morph=False, export_normals=True, export_tangents=False, export_texcoords=False, export_materials='EXPORT',
                              export_extras=False, export_image_format='NONE')
    print(f'rocks_lod{lod}: ' + ', '.join(report) + f' triangles; {os.path.getsize(path) // 1024} KB', flush=True)


if __name__ == '__main__':
    for lod in (0, 1, 2):
        build(lod)
