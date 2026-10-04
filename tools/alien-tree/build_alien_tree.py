"""Alien desert tree: a blue "veil palm", built headless in Blender (bpy module). Three levels of detail.

    python3 tools/alien-tree/build_alien_tree.py --outdir public/models/vegetation/alien-tree [--lod 0|1|2]

Writes alien_tree_lod0.glb (up close), alien_tree_lod1.glb and alien_tree_lod2.glb (the far silhouette). The tree is about
4.4 m tall at scale 1: a slim banded trunk with root flares that leans a little towards the top, a pale crownshaft, and a
fountain of 24 arching, drooping fronds in three rings (long drooping ones outside, shorter ones standing up inside) round a
new spear leaf. Close up the fronds are feathers: a thin rachis with two rows of tapering drooping leaflets. Further away each
frond is one saw-toothed ribbon (the teeth are the leaflets) and, furthest, the far levels draw only half of the fronds. A
handful of pale veils hang from the crownshaft (the veil tree's trick, small). Every level grows its fronds from the same
seeds, so they have the same length, angle and droop and the tree does not change shape when one level takes over from
another. Vertex colours and two materials. Every surface has UVs for the shared detail textures that the game puts on
(src/surface-textures.js): bark u once round, v = height in metres * 1.25; leaves u across (midrib at 0.5), v along, tip at 1.
No image is stored in the files:
  "Banded teal bark"        the trunk and roots, single sided, closed solids
  "Waxy blue leaf tissue"   every leaf and veil, double sided thin sheets
The material names are what src/oasis-vegetation.js picks the wind sway by.

Frame: built directly in glTF axes (exported with "Y up" off, so nothing is converted). +Y is up, the origin is where the
trunk meets the ground (the trunk is straight and on the origin up to 1.9 m, which is the axe's chop zone), units are metres.
"""
import math
import os
import random
import sys

import bpy
import bmesh  # must come after bpy
import numpy as np

A = sys.argv


def opt(name, default):
    return A[A.index(name) + 1] if name in A else default


OUTDIR = opt("--outdir", "public/models/vegetation/alien-tree")
ONLY = opt("--lod", None)

# ----------------------------------------------------------------------------- helpers
UP = np.array([0.0, 1.0, 0.0])


def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(a, b, x):
    if a == b:
        return 0.0 if x < a else 1.0
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def srgb(h):
    """0xRRGGBB as the linear colour the glTF exporter expects for vertex colours."""
    return np.array([((h >> s & 255) / 255.0) ** 2.2 for s in (16, 8, 0)])


def mix(c0, c1, t):
    t = min(max(t, 0.0), 1.0)
    return np.asarray(c0) * (1 - t) + np.asarray(c1) * t


def shade(c, k):
    return np.clip(np.asarray(c) * k, 0.0, 1.0)


def noise3(p, seed=0.0):
    """A cheap repeatable value in [-1, 1] that varies from point to point."""
    x = math.sin(p[0] * 127.1 + p[1] * 311.7 + p[2] * 74.7 + seed) * 43758.5453
    return (x - math.floor(x)) * 2.0 - 1.0


# Palette (sRGB hex).
BARK = srgb(0x4F7F78)          # dark teal-slate
BARK_LIGHT = srgb(0x93C2B0)
BARK_DARK = srgb(0x1B2D30)
BAND = srgb(0x9DBFB0)          # the pale rings round the trunk
SHAFT = srgb(0x86BFB0)         # the crownshaft: the smooth pale sleeve the fronds grow from
# One palette per ring of fronds: deepest outside and brightest in the middle (the hero tree's blues).
LEAF = [
    dict(base=srgb(0x1B7A9E), mid=srgb(0x1F5CB8), tip=srgb(0x30B2DA), rib=srgb(0x7FDDE9), edge=srgb(0x17317E)),
    dict(base=srgb(0x1F8AA8), mid=srgb(0x2870CC), tip=srgb(0x44C2EA), rib=srgb(0x8AE4EE), edge=srgb(0x1B3C90)),
    dict(base=srgb(0x23A0AE), mid=srgb(0x3488DC), tip=srgb(0x6ED8F0), rib=srgb(0x9EEDF4), edge=srgb(0x224EA2)),
    dict(base=srgb(0x1A6070), mid=srgb(0x1D4F8C), tip=srgb(0x2F8FA8), rib=srgb(0x5FB8B8), edge=srgb(0x143060)),   # older, duller
]
SPEAR_LEAF = dict(base=srgb(0x45C2C9), mid=srgb(0x86E2EC), tip=srgb(0xD2FAFF), rib=srgb(0xF2FFFF), edge=srgb(0x4FA8D8))
BARK_FLOOR = (0.020, 0.052, 0.050)   # linear light the materials give off by themselves (see make_materials)
LEAF_FLOOR = (0.030, 0.095, 0.098)
VEIL = srgb(0x93E6EE)
VEIL_END = srgb(0x5FC4E2)

MAT_BARK, MAT_LEAF = 0, 1


# ----------------------------------------------------------------------------- the mesh
class Mesh:
    """Vertices with a colour each, and faces (triangles or quads) with a material."""

    def __init__(self):
        self.V, self.C, self.F, self.M, self.UV = [], [], [], [], []   # UV: one (u, v) per face corner

    def tris(self, mat=None):
        return sum(len(f) - 2 for f, m in zip(self.F, self.M) if mat is None or m == mat)

    def vertex(self, p, c):
        self.V.append(np.asarray(p, float))
        self.C.append(np.asarray(c, float))
        return len(self.V) - 1

    def shell(self, rings, colours, mat=MAT_BARK, vs=None):
        """A closed tube through `rings` (equal-length rings of 3D points), capped at both ends. Faces are wound outward
        whatever order the rings came in."""
        base = len(self.V)
        K = len(rings[0])
        faces, uvs = [], []
        vs = vs if vs is not None else [float(i) for i in range(len(rings))]
        for ring, cols in zip(rings, colours):
            for p, c in zip(ring, cols):
                self.vertex(p, c)
        n = len(rings)
        for i in range(n - 1):
            for k in range(K):
                k2 = (k + 1) % K
                faces.append((base + i * K + k, base + i * K + k2, base + (i + 1) * K + k2, base + (i + 1) * K + k))
                u0, u1 = k / K, (k + 1) / K            # the last quad ends at u = 1, so the texture wraps without a smear
                uvs.append(((u0, vs[i]), (u1, vs[i]), (u1, vs[i + 1]), (u0, vs[i + 1])))
        for end in (0, n - 1):
            ci = self.vertex(np.asarray(rings[end], float).mean(axis=0), np.asarray(colours[end], float).mean(axis=0))
            for k in range(K):
                k2 = (k + 1) % K
                faces.append((ci, base + end * K + k, base + end * K + k2))
                uvs.append(((0.5, vs[end]), (k / K, vs[end]), ((k + 1) / K, vs[end])))
        volume = 0.0
        for f in faces:
            p = [self.V[i] for i in f]
            for j in range(1, len(p) - 1):
                volume += np.dot(p[0], np.cross(p[j], p[j + 1])) / 6.0
        if volume < 0:
            faces = [tuple(reversed(f)) for f in faces]
            uvs = [tuple(reversed(u)) for u in uvs]
        self.F.extend(faces)
        self.UV.extend(uvs)
        self.M.extend([mat] * len(faces))

    def sheet(self, rows, colours, mat=MAT_LEAF):
        """A thin open sheet: rows[i][j] are points, row i runs 'along' and j 'across'. Wound so the face normal is
        (across x along)."""
        base = len(self.V)
        J = len(rows[0])
        for row, cols in zip(rows, colours):
            for p, c in zip(row, cols):
                self.vertex(p, c)
        for i in range(len(rows) - 1):
            for j in range(J - 1):
                a = base + i * J + j
                self.F.append((a, a + 1, a + J + 1, a + J))
                self.M.append(mat)
                u0, u1 = j / (J - 1), (j + 1) / (J - 1)
                v0, v1 = i / (len(rows) - 1), (i + 1) / (len(rows) - 1)
                self.UV.append(((u0, v0), (u1, v0), (u1, v1), (u0, v1)))


# ----------------------------------------------------------------------------- the trunk
BARK_TILES_PER_METRE = 1.25          # must match BARK.tilesPerMetre in src/surface-textures.js
TRUNK_TOP = 3.74
CROWN_Y = 3.62                       # where the fronds leave the trunk
SHAFT_Y = 3.14                       # the crownshaft starts here
BAND_FIRST, BAND_EVERY, BAND_HALF = 0.55, 0.37, 0.028


def band_ys():
    ys, y = [], BAND_FIRST
    while y < SHAFT_Y - 0.15:
        ys.append(y)
        y += BAND_EVERY
    return ys


def trunk_center(y):
    """Straight and on the origin up to 1.9 m (the axe's chop zone is centred on it), then leaning away a little."""
    s = smoothstep(1.9, TRUNK_TOP, y)
    return np.array([0.40 * s ** 1.4, y, -0.15 * s ** 1.2])


def trunk_radius(y):
    base = lerp(0.128, 0.078, min(max(y / TRUNK_TOP, 0.0), 1.0) ** 0.85)
    flare = 0.07 * max(0.0, 1.0 - y / 0.42) ** 2.0
    shaft = 0.020 * smoothstep(SHAFT_Y - 0.05, SHAFT_Y + 0.10, y)
    return base + flare + shaft


def band_amount(y, bands):
    return max((max(0.0, 1.0 - abs(y - b) / BAND_HALF) for b in bands), default=0.0)


# Buttress flares: the trunk itself swells into a few low, rounded ridges that run down into the ground (no separate root
# pieces, so no spikes). Each ridge has its own angle, reach and width.
RIDGE_REACH = 0.18          # how far a full ridge stands out of the plain trunk at the ground, metres
RIDGE_HEIGHT = 0.80         # a ridge has faded into the trunk by this height


def ridge_params(n):
    out = []
    for i in range(n):
        out.append(dict(
            phi=math.tau * i / n + 0.35 + 0.30 * noise3((i, 7, 1), 11.0),
            reach=RIDGE_REACH * (0.75 + 0.30 * (0.5 + 0.5 * noise3((i, 3, 9), 13.0))),
            width=0.27 + 0.06 * noise3((i, 5, 2), 17.0),      # radians-ish: half width of the ridge round the trunk
        ))
    return out


def ridge_extra(theta, y, ridges):
    """How much wider the trunk is at angle `theta` and height `y` because of the ridges (0 above RIDGE_HEIGHT)."""
    if not ridges or y >= RIDGE_HEIGHT:
        return 0.0
    fade = (1.0 - smoothstep(-0.05, RIDGE_HEIGHT, y)) ** 2.4
    best = 0.0
    for r in ridges:
        d = abs((theta - r["phi"] + math.pi) % math.tau - math.pi)
        best = max(best, r["reach"] * max(0.0, math.cos(min(d / r["width"], 1.0) * math.pi / 2)) ** 2)
    return best * fade


def build_trunk(M, lod):
    bands = band_ys() if lod["bands"] else []
    ridges = ridge_params(lod["ridges"])
    ys = {-0.12, 0.0, 0.25, 1.0, 2.0, 3.0, SHAFT_Y - 0.05, SHAFT_Y + 0.10, TRUNK_TOP}
    if lod["bands"]:
        ys |= {0.08, 0.2, 0.34}
        if ridges:
            ys |= {-0.30, -0.04, 0.04, 0.14, 0.45, 0.62, 0.8}   # -0.30: sunk well into the ground, so a tree on a slope shows no underside
        for b in bands:
            ys |= {b - BAND_HALF, b, b + BAND_HALF}
        ys |= {3.4}
    else:
        ys |= {0.5, 1.5, 2.5}
    ys = sorted(ys)
    K = lod["trunk_k"]
    rings, cols = [], []
    for i, y in enumerate(ys):
        c = trunk_center(y)
        r = trunk_radius(y) * (1.0 + 0.10 * band_amount(y, bands))
        r *= 1.0 - 0.45 * smoothstep(TRUNK_TOP - 0.10, TRUNK_TOP, y)
        ring, rc = [], []
        for k in range(K):
            t = math.tau * k / K + 0.3
            wob = 1.0 + 0.045 * noise3((k, math.floor(y * 3.0), 0.5), 2.0)   # not a perfect lathe turning
            rr = r * wob + ridge_extra(t, y, ridges)
            ring.append(c + np.array([math.cos(t) * rr, 0.0, math.sin(t) * rr]))
            streak = 0.5 + 0.5 * noise3((k, 0, 0), 1.3)
            col = mix(BARK, BARK_LIGHT, 0.55 * streak * (0.35 + 0.65 * smoothstep(0.4, 3.0, y)))
            col = mix(col, BAND, 0.85 * band_amount(y, bands))
            col = mix(col, BARK_DARK, 0.55 * (1.0 - smoothstep(0.0, 0.55, y)))
            col = mix(col, SHAFT, 0.90 * smoothstep(SHAFT_Y - 0.05, SHAFT_Y + 0.10, y))
            rc.append(shade(col, 1.0 + 0.05 * noise3((k, i, 1), 4.0)))
        rings.append(np.array(ring))
        cols.append(rc)
    M.shell(rings, cols, MAT_BARK, vs=[y * BARK_TILES_PER_METRE for y in ys])


def build_roots(M, lod):
    """Thick roots arching out of the trunk and into the ground."""
    n = lod["roots"]
    for i in range(n):
        phi = math.tau * i / n + 0.55 + 0.25 * noise3((i, 1, 2), 3.0)
        out = np.array([math.cos(phi), 0.0, math.sin(phi)])
        reach = 0.46 + 0.08 * noise3((i, 3, 1), 5.0)
        steps = 7
        path, radii = [], []
        for s in range(steps):
            t = s / (steps - 1)
            radial = 0.02 + (reach - 0.02) * t ** 0.85      # starts inside the trunk, so its cut end never shows
            y = 0.82 * (1.0 - t) ** 1.7 - 0.05 * t
            path.append(out * radial + UP * y)
            radii.append(lerp(0.075, 0.016, t ** 0.7))
        K = 6
        rings, cols = [], []
        for s, (c, r) in enumerate(zip(path, radii)):
            t = s / (steps - 1)
            d = norm(path[s + 1] - c) if s < steps - 1 else norm(c - path[s - 1])
            a = norm(np.cross(d, UP)) if abs(d[1]) < 0.97 else out
            b = norm(np.cross(a, d))
            ring, rc = [], []
            for k in range(K):
                th = math.tau * k / K
                ring.append(c + a * math.cos(th) * r + b * math.sin(th) * r)
                col = mix(BARK, BARK_DARK, 0.4 + 0.4 * t)
                rc.append(shade(col, 1.0 + 0.05 * noise3((k, s, i), 6.0)))
            rings.append(np.array(ring))
            cols.append(rc)
        M.shell(rings, cols, MAT_BARK, vs=[7.3 + i * 0.9 + s * (reach / (steps - 1)) * BARK_TILES_PER_METRE for s in range(steps)])


# ----------------------------------------------------------------------------- the fronds
# Three rings of fronds round the top of the trunk. n fronds each; length along the rachis; elevation of the first part
# (radians above level); droop (radians gained along the frond: the fronds arch over); and the longest leaflet.
RINGS = [
    dict(n=9, L=2.25, a0=0.50, droop=1.62, leaflet=0.46),
    dict(n=8, L=1.90, a0=0.88, droop=1.40, leaflet=0.40),
    dict(n=6, L=1.40, a0=1.15, droop=1.00, leaflet=0.30),
    dict(n=5, L=1.95, a0=0.12, droop=0.70, leaflet=0.36),   # old fronds, hanging low round the crownshaft
]
CENTRE_LEAF = dict(L=0.95, a0=1.50, droop=0.25, leaflet=0.15)
GOLDEN = 2.399963


def spine_of(origin, phi, L, a0, droop, ns, wobble):
    """Points along an arching rachis (angle a0 at the start, drooping by `droop` over the length), and the direction at each."""
    spine = [np.asarray(origin, float)]
    dirs = []
    ds = L / ns
    for i in range(ns):
        tm = (i + 0.5) / ns
        a = a0 - droop * tm ** 1.4
        ph = phi + wobble * tm
        d = np.array([math.cos(a) * math.cos(ph), math.sin(a), math.cos(a) * math.sin(ph)])
        dirs.append(d)
        spine.append(spine[-1] + d * ds)
    node_dirs = [dirs[0]] + [norm(dirs[i - 1] + dirs[i]) for i in range(1, ns)] + [dirs[-1]]
    return spine, node_dirs


def side_and_up(d, phi):
    flat = np.array([d[0], 0.0, d[2]])
    flat = norm(flat) if np.linalg.norm(flat) > 1e-6 else np.array([math.cos(phi), 0.0, math.sin(phi)])
    r = np.array([-flat[2], 0.0, flat[0]])                     # horizontal, across the frond
    r = norm(r - d * np.dot(r, d))
    return r, np.cross(r, d)


def serrated(M, origin, phi, L, a0, droop, leaflet, twist, pal, teeth, seed, widen=1.0, tone=1.0):
    """One feather frond drawn as a single saw-toothed ribbon: the teeth stand for the leaflets (the far levels of detail).
    The same seed gives the same spine, length, droop and twist as `feather`, so the levels of detail line up."""
    rng = random.Random(seed)
    ns = teeth + 1
    spine, node_dirs = spine_of(origin, phi, L, a0, droop, ns, rng.uniform(-0.20, 0.20))
    frames = []
    for i in range(ns + 1):
        t = i / ns
        r, up = side_and_up(node_dirs[i], phi)
        tw = twist * t * t
        frames.append((r * math.cos(tw) + up * math.sin(tw), -r * math.sin(tw) + up * math.cos(tw)))

    def at(pos):
        """Point, direction, across and up at a fractional node index."""
        i0 = min(int(pos), ns - 1)
        f = pos - i0
        return (lerp(spine[i0], spine[i0 + 1], f), norm(lerp(node_dirs[i0], node_dirs[i0 + 1], f)),
                norm(lerp(frames[i0][0], frames[i0 + 1][0], f)), norm(lerp(frames[i0][1], frames[i0 + 1][1], f)))

    def size_at(pos):
        return leaflet * widen * max(0.22, math.sin(math.pi * min((pos / ns) ** 0.7, 1.0)) ** 0.7)

    rows, cols = [], []
    p, d, r, up = at(0.0)
    rows.append([p - r * 0.016, p, p + r * 0.016])
    rib0 = shade(pal["rib"], tone)
    cols.append([rib0, rib0, rib0])
    for i in range(1, ns):
        for pos, tooth in ((i - 0.5, False), (float(i), True)):
            p, d, r, up = at(pos)
            size = size_at(pos)
            k = tone * (1.0 + 0.07 * noise3((seed % 89, i, 1 if tooth else 2), 3.0))
            t = pos / ns
            c0 = shade(mix(pal["base"], pal["mid"], t), k)
            c1 = shade(mix(pal["mid"], pal["tip"], 0.55 + 0.3 * t), k)
            c2 = shade(mix(pal["tip"], pal["rib"], 0.35), k)
            rib = shade(pal["rib"], tone)
            if tooth:
                reach, fwd, down, edge, centre = 0.78, 0.30, 0.50, mix(c1, c2, 0.6), mix(rib, c1, 0.35)
            else:
                reach, fwd, down, edge, centre = 0.30, 0.08, 0.10, c0, mix(rib, c0, 0.45)
            rl = reach * size * (1.0 + 0.08 * noise3((seed % 83, i, 3 if tooth else 4), 5.0))
            rr = reach * size * (1.0 + 0.08 * noise3((seed % 79, i, 5 if tooth else 6), 5.0))
            lift = d * (fwd * size) - up * (down * size)
            rows.append([p - r * rl + lift, p, p + r * rr + lift])
            cols.append([edge, centre, edge])
    p, d, r, up = at(float(ns))
    rows.append([p - r * 0.004, p, p + r * 0.004])
    tip = shade(mix(pal["tip"], pal["rib"], 0.5), tone)
    cols.append([tip, tip, tip])
    M.sheet(rows, cols, MAT_LEAF)
    return spine


def feather(M, origin, phi, L, a0, droop, leaflet, twist, pal, pairs, seed):
    """One feather frond: a thin rachis with a pair of tapering, drooping leaflets at every node (the near level of detail).
    Returns the spine."""
    rng = random.Random(seed)
    ns = pairs + 1
    spine, node_dirs = spine_of(origin, phi, L, a0, droop, ns, rng.uniform(-0.20, 0.20))
    frames = []
    for i, (p, d) in enumerate(zip(spine, node_dirs)):
        t = i / ns
        r, up = side_and_up(d, phi)
        tw = twist * t * t
        frames.append((r * math.cos(tw) + up * math.sin(tw), -r * math.sin(tw) + up * math.cos(tw)))

    # the rachis: a narrow strip, drawn every second node
    rows, cols = [], []
    for i in range(0, ns + 1, 2):
        t = i / ns
        r, _ = frames[i]
        hw = lerp(0.016, 0.0035, t)
        rows.append([spine[i] - r * hw, spine[i] + r * hw])
        c = mix(pal["rib"], pal["tip"], t * 0.6)
        cols.append([c, c])
    if len(rows) > 1:
        M.sheet(rows, cols, MAT_LEAF)

    for i in range(1, ns):
        t = i / ns
        p, d = spine[i], node_dirs[i]
        r, up = frames[i]
        size = leaflet * max(0.22, math.sin(math.pi * min(t ** 0.7, 1.0)) ** 0.7)
        for side in (-1.0, 1.0):
            jit = np.array([rng.uniform(-1, 1) for _ in range(3)]) * 0.07
            dirl = norm(side * r * 0.78 + d * 0.52 - up * 0.34 + jit)
            wv = norm(d - dirl * np.dot(d, dirl))
            base_hw = 0.037 * (size / leaflet) ** 0.5
            mid = p + dirl * (0.5 * size) - up * (0.03 * size)
            tip = p + dirl * size - up * (0.20 * size)
            rows = [[p - wv * base_hw * 0.5, p + wv * base_hw * 0.5], [mid - wv * base_hw, mid + wv * base_hw],
                    [tip - wv * 0.003, tip + wv * 0.003]]
            shade_k = 1.0 + 0.07 * noise3((seed % 89, i, side), 3.0)
            c0 = shade(mix(pal["base"], pal["mid"], t), shade_k)
            c1 = shade(mix(pal["mid"], pal["tip"], 0.55 + 0.3 * t), shade_k)
            c2 = shade(mix(pal["tip"], pal["rib"], 0.35), shade_k)
            M.sheet(rows, [[c0, c0], [c1, c1], [c2, c2]], MAT_LEAF)
    return spine


def build_crown(M, lod):
    """The fountain of fronds. Every level of detail grows its fronds from the same seeds, so a frond that survives to the far
    levels has the same length, angle and droop there (the far levels simply draw fewer of them, spread evenly)."""
    feathers = lod["style"] == "feather"
    crown = trunk_center(CROWN_Y)
    for w, spec in enumerate(RINGS):
        n = spec["n"]
        m = lod["rings"][w]
        for i in sorted({round(k * n / m) % n for k in range(m)}):
            seed = 1000 + w * 50 + i
            rng = random.Random(seed)
            phi = w * GOLDEN + math.tau * i / n + rng.uniform(-0.12, 0.12)
            origin = crown + np.array([math.cos(phi), 0.0, math.sin(phi)]) * trunk_radius(CROWN_Y) * 0.6 + UP * rng.uniform(-0.05, 0.05)
            L = spec["L"] * rng.uniform(0.90, 1.10)
            a0 = spec["a0"] + rng.uniform(-0.10, 0.10)
            droop = spec["droop"] + rng.uniform(-0.15, 0.15)
            twist = rng.uniform(-0.45, 0.45)
            if feathers:
                feather(M, origin, phi, L, a0, droop, spec["leaflet"], twist, LEAF[w], lod["pairs"], seed)
            else:
                serrated(M, origin, phi, L, a0, droop, spec["leaflet"], twist, LEAF[w], lod["teeth"], seed, lod["widen"], lod["tone"])
    spec = CENTRE_LEAF
    origin = crown + UP * 0.02
    if feathers:
        feather(M, origin, 0.4, spec["L"], spec["a0"], spec["droop"], spec["leaflet"], 0.0, SPEAR_LEAF, 8, 2000)
    else:
        serrated(M, origin, 0.4, spec["L"], spec["a0"], spec["droop"], spec["leaflet"], 0.0, SPEAR_LEAF, lod["centre_teeth"], 2000,
                 lod["widen"], lod["tone"])


def build_veils(M, lod):
    """Thin pale ribbons hanging from the crownshaft."""
    n = lod["veils"]
    for i in range(n):
        rng = random.Random(3000 + i)
        phi = math.tau * i / n + rng.uniform(-0.2, 0.2)
        out = np.array([math.cos(phi), 0.0, math.sin(phi)])
        across = np.array([-out[2], 0.0, out[0]])
        y0 = SHAFT_Y + rng.uniform(0.10, 0.38)
        start = trunk_center(y0) + out * (trunk_radius(y0) + 0.01)
        length = rng.uniform(0.95, 1.6)
        steps = 6
        rows, cols = [], []
        for s in range(steps):
            u = s / (steps - 1)
            sway = 0.06 * math.sin(u * 2.6 + i) * u
            p = start - UP * (u * length) + out * (0.16 * math.sin(u * math.pi * 0.9)) + across * sway
            hw = lerp(0.046, 0.016, u)
            c = mix(VEIL, VEIL_END, u)
            rows.append([p - across * hw, p + across * hw])
            cols.append([c, c])
        M.sheet(rows, cols, MAT_LEAF)


# ----------------------------------------------------------------------------- Blender objects
def make_materials():
    def base(name, roughness, cull, floor):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = 0.0
        # A little light of its own, so the shaded side (most of what you see looking up into the crown) stays teal instead of
        # going black under the game's lighting. Flat, and tiny next to the night exposure.
        bsdf.inputs["Emission Color"].default_value = (*floor, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        m.use_backface_culling = cull
        return m

    return base("Banded teal bark", 0.87, True, BARK_FLOOR), base("Waxy blue leaf tissue", 0.72, False, LEAF_FLOOR)


def make_object(M, name, mats):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in M.V], [], [tuple(f) for f in M.F])
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    cols = np.clip(np.asarray(M.C, float), 0, 1)
    rgba = np.concatenate([cols, np.ones((len(cols), 1))], 1)
    ca.data.foreach_set("color", rgba.ravel())
    for m in mats:
        me.materials.append(m)
    uv = me.uv_layers.new(name="UVMap")
    for poly, mat, corners in zip(me.polygons, M.M, M.UV):
        poly.material_index = mat
        for loop, c in zip(range(poly.loop_start, poly.loop_start + poly.loop_total), corners):
            uv.data[loop].uv = c
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def smooth_by_angle(ob, degrees=35):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(degrees))
    except Exception:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(degrees))


LODS = {
    0: dict(trunk_k=18, bands=True, roots=0, ridges=6, style="feather", pairs=17, rings=[9, 8, 6, 5], veils=6),
    1: dict(trunk_k=7, bands=False, roots=0, ridges=0, style="serrated", teeth=7, centre_teeth=4, widen=1.0, tone=0.90, rings=[9, 8, 6, 5], veils=0),
    2: dict(trunk_k=5, bands=False, roots=0, ridges=0, style="serrated", teeth=3, centre_teeth=2, widen=1.3, tone=0.84, rings=[5, 4, 3, 3], veils=0),
}


def build(level):
    lod = LODS[level]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = Mesh()
    build_trunk(M, lod)
    if lod["roots"]:
        build_roots(M, lod)
    build_crown(M, lod)
    build_veils(M, lod)
    bark, leaf = make_materials()
    ob = make_object(M, "AlienTree", [bark, leaf])
    smooth_by_angle(ob)
    lows = np.min(np.asarray(M.V), axis=0)
    highs = np.max(np.asarray(M.V), axis=0)
    print(f"LOD{level}: tris {M.tris()} (bark {M.tris(MAT_BARK)}, leaves {M.tris(MAT_LEAF)}) verts {len(M.V)} "
          f"bounds x[{lows[0]:.2f},{highs[0]:.2f}] y[{lows[1]:.2f},{highs[1]:.2f}] z[{lows[2]:.2f},{highs[2]:.2f}]")
    leaf_pts = sorted({i for f, m in zip(M.F, M.M) if m == MAT_LEAF for i in f})
    out = [M.V[i] for i in leaf_pts if math.hypot(M.V[i][0], M.V[i][2]) > 0.45]
    print(f"   leaves beyond 0.45 m of the axis: lowest {min(p[1] for p in out):.2f} m, reach {max(math.hypot(p[0], p[2]) for p in out):.2f} m")
    os.makedirs(OUTDIR, exist_ok=True)
    out = os.path.join(OUTDIR, f"alien_tree_lod{level}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=False, export_apply=False,
        export_lights=False, export_cameras=False, export_animations=False, export_skins=False,
        export_vertex_color="MATERIAL", export_normals=True, export_tangents=False, export_texcoords=True,
        export_materials="EXPORT", export_extras=False)
    print("EXPORTED", out, f"{os.path.getsize(out)} bytes")


for level in ([int(ONLY)] if ONLY is not None else sorted(LODS)):
    build(level)
