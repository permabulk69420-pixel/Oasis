"""The island's bushes, built headless in Blender (bpy module). Replaces the old ones, which laid their leaf clusters flat like plates (so from the side
you saw them edge-on, like paper).

    python3 tools/island-bushes/build_bush.py [--only bushA|bushB] [--outdir public/models/island]

Writes <name>_lod0.glb, _lod1.glb, _lod2.glb.

A bush here is a low, lumpy dome covered in leaf clusters (the dense sprays painted in public/textures/island-leaves/canopy.png, own art). Each cluster
is a card lying on the dome's skin FACING OUTWARD and cupped round it, so from any side you look into the faces of leaves, never at a card edge-on.
Spiky slender clusters stand off the rim to break the outline, a few darker ones fill the inside so you cannot see through it, and the bottom ones
rest on the ground. The shading is baked into the vertex colours (darker inside and toward the foot, by rays cast against the bush itself), and the
normals lean out from the dome's middle so it lights as one soft mound.

  bushA   broad and fan clusters, fresh green, about 1.6 m tall and 2.6 m across
  bushB   fan and broad clusters with a few rusty ones going over, about 1.9 m tall and 2.9 m across

Levels (the game switches at 30 m and 70 m; there are about 1,900 of each on the island, mostly drawn far):
  lod0   the full bush, every cluster cupped round the dome
  lod1   thirteen bigger clusters: a ring round the sides, a smaller ring above, a cap (26 triangles)
  lod2   six big clusters round the sides and a cap on top (14 triangles)

What the game reads (src/island-glb.js): the material "Leaf cards" (the game puts the canopy atlas on it, FLORA_RENDER.map in src/island-flora.js),
COLOR_0 (the shading), NORMAL, TEXCOORD_0 into the atlas. Frame: glTF axes directly (+Y up, metres, the origin on the ground at the middle),
exported with "Y up" off so nothing is converted.
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
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUTDIR = A[A.index('--outdir') + 1] if '--outdir' in A else os.path.join(ROOT, 'public', 'models', 'island')
ONLY = A[A.index('--only') + 1] if '--only' in A else None
SPRITES = json.load(open(os.path.join(ROOT, 'public', 'textures', 'island-leaves', 'sprites.json')))['canopy']
TAU, GOLDEN = math.tau, 2.399963229728653
UP = np.array([0.0, 1.0, 0.0])

BUSHES = {
    'bushA': dict(seed=53, height=1.6, radius=1.2, sprites=['broad', 'fan', 'broad'], rim='slender', lobes=3),
    'bushB': dict(seed=67, height=1.9, radius=1.35, sprites=['fan', 'broad', 'fan', 'broad', 'rusty'], rim='slender', lobes=4),
}
# lod0: `shell` clusters spread evenly over the skin (a golden spiral), `rim` spiky ones standing off the shoulders, `inner` darker fillers inside.
# The coarse levels are planned instead (a thinned spiral leaves gaps): `rings` of (count, height on the dome -1..1, size against lod0's), the last a
# single cap on top, so the sides and the top are both closed from any angle. rows, cols: each card's grid.
LODS = {
    0: dict(shell=30, rim=8, inner=6, rows=2, cols=3),
    1: dict(rings=[(8, 0.0, 1.3), (4, 0.62, 1.25), (1, 1.0, 1.3)], rows=1, cols=2),
    2: dict(rings=[(6, 0.05, 1.6), (1, 1.0, 1.6)], rows=1, cols=2),
}


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


# ----------------------------------------------------------------------------------------------------------------------------- the dome
class Dome:
    """An ellipsoid pushed into a few soft lobes: where its skin is, and which way is out, in any direction from its middle."""

    def __init__(self, height, radius, lobes, seed):
        rng = random.Random(seed)
        self.c = np.array([0.0, height * 0.42, 0.0])
        self.r = np.array([radius, height * 0.58, radius])
        self.lobes = [(rng.uniform(0, TAU), rng.uniform(0.08, 0.16)) for _ in range(lobes)]

    def skin(self, d):
        a = math.atan2(d[2], d[0])
        lump = 1.0 + sum(amp * math.cos(a - ph) * (1 - abs(d[1])) for ph, amp in self.lobes) * 0.9
        return self.c + d * self.r * lump

    def outward(self, d):
        return norm(d / self.r)


# ----------------------------------------------------------------------------------------------------------------------------- mesh
class Mesh:
    def __init__(self, cols):
        self.cols = cols
        self.V, self.C, self.B, self.F = [], [], [], []

    def card(self, sprite, centre, out, along, size, colour, lean_from, rows, cup=0.0, lift=0.0, droop=0.0):
        """A square card of the sprite centred on `centre`, facing `out`, its picture's bottom-to-top running `along`. `cup`: the side edges fold back
        toward the dome (a share of the size) so it wraps round it; `lift`: the far end springs off the skin; `droop`: and sags."""
        x0, y0, w, h = SPRITES[sprite]
        cols = self.cols
        across = norm(np.cross(out, along))
        idx = []
        for i in range(rows + 1):
            t = i / rows
            row = []
            for j in range(cols):
                s = -1.0 + 2.0 * j / (cols - 1)
                p = (centre + along * (t - 0.5) * size + across * s * size * 0.5
                     - out * cup * size * s * s + out * lift * size * t * t - UP * droop * size * t * t)
                self.V.append(p)
                self.C.append(colour(t))
                self.B.append(norm(p - lean_from))
                row.append(len(self.V) - 1)
            idx.append(row)
        for i in range(rows):
            for j in range(cols - 1):
                def uv(ii, jj):
                    return ((x0 + 1 + jj / (cols - 1) * (w - 2)) / 1024.0, 1.0 - (y0 + 1 + (1 - ii / rows) * (h - 2)) / 1024.0)
                self.F.append(((idx[i][j], idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j]), (uv(i, j), uv(i, j + 1), uv(i + 1, j + 1), uv(i + 1, j))))

    def tris(self):
        return sum(len(f) - 2 for f, _ in self.F)


def build(name, lod):
    spec, cfg = BUSHES[name], LODS[lod]
    H, R = spec['height'], spec['radius']
    dome = Dome(H, R, spec['lobes'], spec['seed'])
    M = Mesh(cfg['cols'])
    lean_from = dome.c - UP * H * 0.3
    places = []                                                       # (kind, height on the dome, azimuth, size factor)
    if lod == 0:
        rng = random.Random(spec['seed'])
        places += [('shell', lerp(-0.62, 0.92, (k + 0.5) / cfg['shell']), k * GOLDEN + rng.uniform(-0.25, 0.25), 1.0) for k in range(cfg['shell'])]
        places += [('rim', rng.uniform(-0.1, 0.55), k * TAU / cfg['rim'] + rng.uniform(-0.3, 0.3), 1.0) for k in range(cfg['rim'])]
        places += [('inner', rng.uniform(-0.1, 0.6), rng.uniform(0, TAU), 1.0) for _ in range(cfg['inner'])]
    else:
        for ring, (count, y, grow) in enumerate(cfg['rings']):
            places += [('shell', y, (k + 0.5 * ring) * TAU / count + 0.4, grow) for k in range(count)]
    for k, (kind, y, a, grow) in enumerate(places):
        rng = random.Random(spec['seed'] * 7919 + k * 104729 + lod * 15485863)
        ring = math.sqrt(max(0.0, 1 - y * y))
        d = np.array([math.cos(a) * ring, y, math.sin(a) * ring])
        out = dome.outward(d)
        if kind == 'inner':
            centre = dome.c + (dome.skin(d) - dome.c) * rng.uniform(0.35, 0.55)
        else:
            centre = dome.skin(d) + out * (H * 0.12 if kind == 'rim' else 0.0)
        size = H * rng.uniform(0.6, 0.75) * grow * (0.75 if kind == 'rim' else 1.0)
        # the picture's base points down the skin toward the bush's foot, turned a little either way, so the clusters overlap like shingles
        up_skin = UP - out * np.dot(UP, out)
        up_skin = norm(up_skin) if np.linalg.norm(up_skin) > 1e-3 else norm(np.cross(out, [1.0, 0.0, 0.0]))
        along = rotate(up_skin, out, rng.uniform(-0.9, 0.9)) if y < 0.97 else norm(np.array([math.cos(a), 0.0, math.sin(a)]))
        foot = centre[1] - size * 0.5 * abs(along[1])
        if foot < -0.05:                                              # the skirt: keep the card's foot just under the ground
            centre = centre + UP * (-0.05 - foot)
        sprite = spec['rim'] if kind == 'rim' else spec['sprites'][rng.randrange(len(spec['sprites']))]
        tone = rng.uniform(0.88, 1.08) * lerp(0.82, 1.05, (d[1] + 1) / 2) * (0.55 if kind == 'inner' else 1.0)
        hue = np.array([rng.uniform(0.95, 1.05), 1.0, rng.uniform(0.9, 1.04)])
        M.card(sprite, centre, out, along, size, lambda t, tone=tone, hue=hue: hue * tone * lerp(0.9, 1.0, t), lean_from, cfg['rows'],
               cup=0.16 if cfg['cols'] > 2 else 0.0, lift=0.18 if kind == 'rim' else 0.06, droop=0.12 if kind == 'rim' else 0.0)
    return M


# ----------------------------------------------------------------------------------------------------------------------------- Blender
def to_blender(M, name):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in M.V], [], [f for f, _ in M.F])
    mat = bpy.data.materials.new('Leaf cards')
    mat.use_nodes = True
    vc = mat.node_tree.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    mat.node_tree.links.new(vc.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    me.materials.append(mat)
    uv = me.uv_layers.new(name='UVMap')
    for poly, (_, corners) in zip(me.polygons, M.F):
        poly.use_smooth = True
        for loop, c in zip(range(poly.loop_start, poly.loop_start + poly.loop_total), corners):
            uv.data[loop].uv = c
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, me


def bake_shading(M, height, rays=20, reach=0.6, strength=0.55, seed=1):
    """Ambient occlusion per vertex (rays out over the leaned normal against the bush itself; a card counts as about half solid, since its picture
    is about half leaf), and the foot of the bush darker. Multiplied into the colours."""
    tree = BVHTree.FromPolygons([Vector(v) for v in M.V], [list(f) for f, _ in M.F], all_triangles=False)
    rng = np.random.default_rng(seed)
    u1, u2 = rng.random(rays), rng.random(rays)
    local = np.stack([np.sqrt(u1) * np.cos(TAU * u2), np.sqrt(u1) * np.sin(TAU * u2), np.sqrt(1 - u1)], 1)
    for i, p in enumerate(M.V):
        n = M.B[i]
        a = norm(np.cross(n, [0.3, 0.9, 0.2]))
        b = np.cross(n, a)
        hit = 0.0
        o = Vector(p + n * 0.01)
        for d in local:
            loc, _, _, dist = tree.ray_cast(o, Vector(a * d[0] + b * d[1] + n * d[2]), reach)
            if loc is not None:
                hit += 0.55 * (1.0 - 0.5 * dist / reach)
        shade = (1.0 - strength * hit / rays) * lerp(0.62, 1.0, smoothstep(0.0, height * 0.45, p[1]))
        M.C[i] = M.C[i] * max(shade, 0.3)


def export(name, lod):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = build(name, lod)
    if lod < 2:
        bake_shading(M, BUSHES[name]['height'])
    else:
        for i, p in enumerate(M.V):                 # the far level: only the foot darkening (six cards have little to shade each other with)
            M.C[i] = M.C[i] * lerp(0.72, 1.0, smoothstep(0.0, BUSHES[name]['height'] * 0.45, p[1]))
    ob, me = to_blender(M, f'{name}_lod{lod}')
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    col.data.foreach_set('color', np.concatenate([np.clip(np.asarray(M.C), 0, 2), np.ones((len(M.C), 1))], 1).ravel())
    me.color_attributes.active_color = col
    me.normals_split_custom_set_from_vertices([tuple(b) for b in M.B])
    os.makedirs(OUTDIR, exist_ok=True)
    path = os.path.join(OUTDIR, f'{name}_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=False, export_apply=False, export_animations=False, export_skins=False,
                              export_morph=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_normals=True, export_tangents=False,
                              export_texcoords=True, export_materials='EXPORT', export_extras=False, export_image_format='NONE')
    V = np.asarray(M.V)
    print(f'{name}_lod{lod}: {M.tris()} tris, {len(M.V)} verts, {os.path.getsize(path) // 1024} KB, x[{V[:, 0].min():.2f},{V[:, 0].max():.2f}] '
          f'y[{V[:, 1].min():.2f},{V[:, 1].max():.2f}] z[{V[:, 2].min():.2f},{V[:, 2].max():.2f}]', flush=True)


if __name__ == '__main__':
    for name in BUSHES:
        if ONLY and ONLY != name:
            continue
        for lod in (0, 1, 2):
            export(name, lod)
