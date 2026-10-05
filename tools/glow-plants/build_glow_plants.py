"""The oasis's glow plants, built headless in Blender (bpy module). Two plants, three levels of detail each.

    python3 tools/glow-plants/build_glow_plants.py --outdir public/models/vegetation/glow-plants [--only reed|lantern] [--lod 0|1|2]

Writes glow_reed_lod{0,1,2}.glb and lantern_bloom_lod{0,1,2}.glb.

  Glow reed      a clump of nine slender stalks (about 1.3 m at the tallest) that arch over and end in a nodding teardrop
                 bulb in a small cup of petals, with a fan of long blades at the foot. About a metre and a half across. Most
                 bulbs glow cyan (the hero tree's pods), one in four violet (the crystals). For the pond's edge and shallows.
  Lantern bloom  a single fleshy stem about 1.5 m tall in a rosette of broad folded leaves, with six tendrils hanging from
                 its crown, each strung with glowing pods, and a tall bud at the top. About two metres across. For the
                 banks and the foot of the hero tree.

By day they are quiet dark-teal plants with a soft glow; at night the bulbs and pods are what lights them (the game sets the
glow strength and adds the soft halos, src/glow-garden.js).

Materials (names are what the game looks them up by):
  "Glow plant stem"   stalks, stems and tendrils: closed solids, single sided
  "Glow plant leaf"   blades, rosette leaves and petals: thin sheets, double sided
  "Glow"              the cyan bulbs and pods: emissive, closed solids
  "Glow violet"       the violet bulbs: emissive, closed solids

UVs (every surface has them, for the bigger texture pass to come; no image is stored in the files). Stems: u once round, v in
metres along the stem (one tile per metre). Leaves and petals: u across (the midrib at 0.5), v along, tip at 1. Bulbs and pods:
u round, v from the stalk end (0) to the tip (1). Colours are in the vertices (a "Col" attribute) until real textures arrive.

Frame: built directly in glTF axes (exported with "Y up" off, so nothing is converted): +Y up, the origin on the ground at the
middle of the plant, metres. Every level of detail grows its parts from the same seeds, so a stalk that survives to the far
levels has the same length, lean and nod there; the far levels draw fewer of them.
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


OUTDIR = opt("--outdir", "public/models/vegetation/glow-plants")
ONLY = opt("--only", None)
ONLY_LOD = opt("--lod", None)

UP = np.array([0.0, 1.0, 0.0])
TAU = math.tau
GOLDEN = 2.399963229728653

STEM, LEAF, GLOW, VIOLET = 0, 1, 2, 3


def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)


def lerp(a, b, t):
    return a + (b - a) * t


def srgb(h):
    """0xRRGGBB as the linear colour the glTF exporter expects for vertex colours."""
    return np.array([((h >> s & 255) / 255.0) ** 2.2 for s in (16, 8, 0)])


def mix(c0, c1, t):
    t = min(max(t, 0.0), 1.0)
    return np.asarray(c0) * (1 - t) + np.asarray(c1) * t


def noise3(p, seed=0.0):
    x = math.sin(p[0] * 127.1 + p[1] * 311.7 + p[2] * 74.7 + seed) * 43758.5453
    return (x - math.floor(x)) * 2.0 - 1.0


# Palette (sRGB hex): dark teal bodies, a lighter teal on the edges and tips, a glow-tinted stalk end.
STEM_BASE, STEM_TOP, STEM_TIP = srgb(0x0b3236), srgb(0x14595a), srgb(0x2f8f86)
LEAF_BASE, LEAF_MID, LEAF_EDGE, LEAF_TIP = srgb(0x082b30), srgb(0x11494c), srgb(0x1d6d68), srgb(0x3aa89b)
RIB = srgb(0x2f8c82)
BULB_BASE = srgb(0x1a7f88)      # the vertex colour under the glow: the glow itself comes from the material's emission
PETAL_BASE, PETAL_TIP = srgb(0x0f4a4b), srgb(0x4fc2b3)


# ----------------------------------------------------------------------------- the mesh
class Mesh:
    """Vertices with a colour each, faces (triangles or quads) with a material, and one (u, v) per face corner."""

    def __init__(self):
        self.V, self.C, self.F, self.M, self.UV = [], [], [], [], []

    def tris(self, mat=None):
        return sum(len(f) - 2 for f, m in zip(self.F, self.M) if mat is None or m == mat)

    def vertex(self, p, c):
        self.V.append(np.asarray(p, float))
        self.C.append(np.asarray(c, float))
        return len(self.V) - 1

    def shell(self, rings, colours, mat, vs):
        """A closed tube through `rings` (equal-length rings of 3D points), capped at both ends, wound outward. vs[i] is the
        v of ring i; u runs once round."""
        base = len(self.V)
        K = len(rings[0])
        faces, uvs = [], []
        for ring, cols in zip(rings, colours):
            for p, c in zip(ring, cols):
                self.vertex(p, c)
        n = len(rings)
        for i in range(n - 1):
            for k in range(K):
                k2 = (k + 1) % K
                faces.append((base + i * K + k, base + i * K + k2, base + (i + 1) * K + k2, base + (i + 1) * K + k))
                u0, u1 = k / K, (k + 1) / K          # the last quad ends at u = 1: no smear where the texture wraps
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

    def sheet(self, rows, colours, mat=LEAF):
        """A thin open sheet: rows[i][j] are points, row i runs 'along' and j 'across'. u across, v along (0 to 1)."""
        base = len(self.V)
        J = len(rows[0])
        n = len(rows)
        for row, cols in zip(rows, colours):
            for p, c in zip(row, cols):
                self.vertex(p, c)
        for i in range(n - 1):
            for j in range(J - 1):
                a = base + i * J + j
                self.F.append((a, a + 1, a + J + 1, a + J))
                self.M.append(mat)
                u0, u1 = j / (J - 1), (j + 1) / (J - 1)
                v0, v1 = i / (n - 1), (i + 1) / (n - 1)
                self.UV.append(((u0, v0), (u1, v0), (u1, v1), (u0, v1)))


def ring_points(c, t, rx, ry, K, hint=UP, phase=0.0):
    """K points round `c` in the plane perpendicular to the direction `t`, radii rx and ry."""
    right = np.cross(t, hint)
    if np.linalg.norm(right) < 1e-4:
        right = np.cross(t, np.array([1.0, 0.0, 0.0]))
    right = norm(right)
    up = norm(np.cross(right, t))
    return np.array([c + right * rx * math.cos(phase + TAU * k / K) + up * ry * math.sin(phase + TAU * k / K) for k in range(K)])


def tube(M, path, radii, K, colour, mat=STEM, hint=UP, jitter=0.0, seed=0.0):
    """A closed tube along `path`. radii[i] is the radius at point i. colour(i, k) -> rgb. v = metres along the path."""
    path = [np.asarray(p, float) for p in path]
    rings, cols, vs = [], [], []
    run = 0.0
    for i, c in enumerate(path):
        a, b = path[max(i - 1, 0)], path[min(i + 1, len(path) - 1)]
        t = norm(b - a)
        r = max(radii[i], 0.0005)
        ring = ring_points(c, t, r, r, K, hint)
        if jitter:
            ring = np.array([c + (q - c) * (1.0 + jitter * noise3((k, i, 0.5), seed)) for k, q in enumerate(ring)])
        rings.append(ring)
        cols.append([colour(i, k) for k in range(K)])
        if i:
            run += np.linalg.norm(c - path[i - 1])
        vs.append(run)
    M.shell(rings, cols, mat, vs)


def teardrop(M, c, t, length, radius, K, rings, mat, base_colour, tip_colour=None):
    """A bulb hanging along direction t from point c: narrow at the stalk end, fullest a third of the way down, rounded at the tip.
    v runs 0 at the stalk end to 1 at the tip."""
    t = norm(t)
    profile = [0.26, 0.78, 1.0, 0.94, 0.74, 0.46, 0.14] if rings >= 7 else [0.30, 0.95, 0.85, 0.42, 0.10][:rings]
    if rings < 7 and len(profile) != rings:
        profile = list(np.interp(np.linspace(0, 1, rings), np.linspace(0, 1, len(profile)), profile))
    n = len(profile)
    path = [c + t * length * (i / (n - 1)) for i in range(n)]
    ring_list, cols, vs = [], [], []
    for i, (p, w) in enumerate(zip(path, profile)):
        ring_list.append(ring_points(p, t, radius * w, radius * w, K, UP))
        col = mix(base_colour, tip_colour if tip_colour is not None else base_colour, i / (n - 1))
        cols.append([col] * K)
        vs.append(i / (n - 1))
    M.shell(ring_list, cols, mat, vs)


def arch(origin, azimuth, el0, el1, length, steps, curve=1.0):
    """Points along an arch that starts at `origin` heading at elevation el0 (radians above horizontal) towards `azimuth`, and bends
    to elevation el1 by the end (the bend is gentle early on and sharper later when curve > 1). Returns (points, end direction)."""
    pts = [np.asarray(origin, float)]
    ds = length / (steps - 1)
    d = UP
    for i in range(steps - 1):
        t = (i + 0.5) / (steps - 1)
        el = el0 + (el1 - el0) * t ** curve
        d = np.array([math.cos(el) * math.cos(azimuth), math.sin(el), math.cos(el) * math.sin(azimuth)])
        pts.append(pts[-1] + d * ds)
    return pts, d


def blade(M, origin, azimuth, el0, el1, length, half_width, steps, across, colours, curve=1.0, fold=0.0, twist=0.0, shape=0.8):
    """A leaf blade: a ribbon that arches from `origin`, widest early (shape < 1) and ending in a point, folded along the midrib.
    colours = (base, mid, edge, tip)."""
    pts, _ = arch(origin, azimuth, el0, el1, length, steps, curve)
    side0 = np.array([-math.sin(azimuth), 0.0, math.cos(azimuth)])
    rows, cols = [], []
    for i, p in enumerate(pts):
        s = i / (steps - 1)
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        t = norm(b - a)
        side = norm(np.cross(t, np.cross(side0, t)))
        # twist the ribbon about its own axis a little along its length
        ang = twist * s
        up = norm(np.cross(side, t))
        side = side * math.cos(ang) + up * math.sin(ang)
        up = norm(np.cross(side, t))
        w = half_width * math.sin(math.pi * min(s ** shape, 1.0)) ** 0.8 if s < 0.999 else 0.0
        w = max(w, half_width * 0.04 * (1 - s))
        row, rc = [], []
        for j in range(across):
            x = -1.0 + 2.0 * j / (across - 1)
            lift = fold * (1.0 - abs(x)) * w / max(half_width, 1e-6)
            row.append(p + side * x * w + up * lift)
            edge = abs(x)
            c = mix(colours[0], colours[1], min(s * 2.0, 1.0))
            c = mix(c, colours[2], edge ** 2 * 0.8)
            c = mix(c, colours[3], max(0.0, s - 0.55) / 0.45 * 0.9)
            if edge < 0.01:
                c = mix(c, RIB, 0.55)
            rc.append(c)
        rows.append(row)
        cols.append(rc)
    M.sheet(rows, cols, LEAF)


# ----------------------------------------------------------------------------- the glow reed clump
REED_STALKS = 13
REED_LEAVES = 10
# Per level: how many of the stalks and blades are drawn, the stalk's sides, its steps, the bulb's sides and rings, the petals per cup.
REED_LODS = {
    0: dict(stalks=13, blades=10, k=6, steps=11, bulb_k=10, bulb_rings=7, petals=5, buds=True, blade_rows=9),
    1: dict(stalks=9, blades=7, k=4, steps=7, bulb_k=6, bulb_rings=5, petals=3, buds=False, blade_rows=6),
    2: dict(stalks=6, blades=4, k=3, steps=5, bulb_k=5, bulb_rings=4, petals=0, buds=False, blade_rows=4),
}


def reed_specs():
    """The same nine stalks and eight blades for every level of detail. Order matters: a lower level keeps the first n of each,
    and they are listed so the kept ones still spread round and keep the tall ones."""
    stalks, blades = [], []
    for i in range(REED_STALKS):
        rng = random.Random(100 + i)
        # tallest first, spread round the clump
        phi = i * GOLDEN + rng.uniform(-0.2, 0.2)
        r = rng.uniform(0.03, 0.22)
        height = 1.85 - 0.075 * i + rng.uniform(-0.08, 0.08)
        stalks.append(dict(
            origin=np.array([r * math.cos(phi), 0.0, r * math.sin(phi)]),
            azimuth=phi + rng.uniform(-0.7, 0.7),
            el0=rng.uniform(1.34, 1.53), el1=rng.uniform(-1.3, -0.7),
            length=height * 1.12, radius=rng.uniform(0.0155, 0.021),
            bulb=rng.uniform(0.056, 0.085), violet=(i % 4 == 2), seed=i,
        ))
    for i in range(REED_LEAVES):
        rng = random.Random(200 + i)
        phi = i * GOLDEN + rng.uniform(-0.15, 0.15)
        r = rng.uniform(0.02, 0.16)
        blades.append(dict(
            origin=np.array([r * math.cos(phi), 0.01, r * math.sin(phi)]),
            azimuth=phi, el0=rng.uniform(1.05, 1.42), el1=rng.uniform(-0.25, 0.35),
            length=rng.uniform(0.62, 1.15) * (1.0 if i < 6 else 0.85), half_width=rng.uniform(0.030, 0.046),
            twist=rng.uniform(-0.5, 0.5), seed=i,
        ))
    return stalks, blades


def build_reed(lod):
    cfg = REED_LODS[lod]
    M = Mesh()
    stalks, blades = reed_specs()
    for sp in stalks[:cfg["stalks"]]:
        path, d_end = arch(sp["origin"], sp["azimuth"], sp["el0"], sp["el1"], sp["length"], cfg["steps"], curve=2.5)
        n = len(path)
        radii = [sp["radius"] * lerp(1.15, 0.55, i / (n - 1)) for i in range(n)]

        def stem_colour(i, k, n=n):
            return mix(STEM_BASE, STEM_TOP, i / (n - 1) * 1.2) * (0.92 + 0.08 * noise3((k, i, 0.0), 3.0))
        tube(M, path, radii, cfg["k"], stem_colour, STEM, jitter=0.05 if lod == 0 else 0.0, seed=sp["seed"])
        tip = path[-1]
        glow_mat = VIOLET if sp["violet"] else GLOW
        length = sp["bulb"] * 2.3
        teardrop(M, tip - d_end * 0.004, d_end, length, sp["bulb"], cfg["bulb_k"], cfg["bulb_rings"], glow_mat, BULB_BASE)
        if cfg["petals"]:
            # a small cup of petals round the neck of the bulb, opening upward
            across_ref = norm(np.cross(d_end, UP)) if abs(d_end[1]) < 0.98 else np.array([1.0, 0.0, 0.0])
            across_ref2 = norm(np.cross(d_end, across_ref))
            for p in range(cfg["petals"]):
                phi = TAU * p / cfg["petals"] + sp["seed"]
                outward = across_ref * math.cos(phi) + across_ref2 * math.sin(phi)
                start = tip - d_end * 0.012 + outward * sp["bulb"] * 0.25
                steps = 4
                rows, cols = [], []
                for i in range(steps):
                    s = i / (steps - 1)
                    centre = start + (-d_end * 0.5 + outward * 0.9) * s * sp["bulb"] * 1.9 + d_end * sp["bulb"] * 0.6 * s * s
                    tangent = norm(-d_end * 0.5 + outward * 0.9)
                    wide = np.cross(tangent, d_end)
                    wide = norm(wide) if np.linalg.norm(wide) > 1e-4 else across_ref
                    hw = sp["bulb"] * 0.42 * math.sin(math.pi * (0.15 + 0.85 * s) ** 0.9) * (1 - 0.3 * s)
                    rows.append([centre - wide * hw, centre, centre + wide * hw])
                    c = mix(PETAL_BASE, PETAL_TIP, s)
                    cols.append([c * 0.8, c, c * 0.8])
                M.sheet(rows, cols, LEAF)
        if cfg["buds"] and sp["seed"] % 2 == 0:
            # a small side bud on a short thread, off the stalk a little below the nodding end
            idx = max(n - 4, 1)
            base = path[idx]
            dirn = norm(np.array([math.cos(sp["azimuth"] + 1.9), -0.15, math.sin(sp["azimuth"] + 1.9)]))
            thread = [base + dirn * 0.045 * (j / 2.0) + np.array([0.0, -0.01 * (j / 2.0) ** 2, 0.0]) for j in range(3)]
            tube(M, thread, [0.0045, 0.0035, 0.003], 4, lambda i, k: STEM_TOP, STEM)
            teardrop(M, thread[-1], norm(dirn + np.array([0, -1.2, 0])), sp["bulb"] * 1.3, sp["bulb"] * 0.5, 6, 5, glow_mat, BULB_BASE)
    for sp in blades[:cfg["blades"]]:
        blade(M, sp["origin"], sp["azimuth"], sp["el0"], sp["el1"], sp["length"], sp["half_width"], cfg["blade_rows"], 3,
              (LEAF_BASE, LEAF_MID, LEAF_EDGE, LEAF_TIP), curve=1.4, fold=0.006, twist=sp["twist"], shape=0.7)
    return M


# ----------------------------------------------------------------------------- the lantern bloom
LANTERN_LODS = {
    0: dict(leaves=12, stem_k=9, stem_steps=15, across=7, rows=10, tendrils=8, tendril_k=5, tendril_steps=9, pod_k=10, pod_rings=7, pods=4, petals=6),
    1: dict(leaves=9, stem_k=6, stem_steps=8, across=5, rows=6, tendrils=6, tendril_k=4, tendril_steps=5, pod_k=6, pod_rings=5, pods=3, petals=4),
    2: dict(leaves=6, stem_k=4, stem_steps=5, across=3, rows=4, tendrils=4, tendril_k=3, tendril_steps=3, pod_k=5, pod_rings=4, pods=2, petals=0),
}
LANTERN_HEIGHT = 1.30


def stem_point(s):
    """The stem's centre line: an easy S-curve, up to the crown at s = 1."""
    return np.array([0.07 * math.sin(s * 2.4), s * LANTERN_HEIGHT, 0.05 * math.cos(s * 1.7) - 0.05])


def lantern_specs():
    leaves, tendrils = [], []
    for i in range(12):
        rng = random.Random(300 + i)
        phi = i * GOLDEN + rng.uniform(-0.1, 0.1)
        y = 0.04 + 0.5 * (i / 11.0) ** 1.3 + rng.uniform(-0.02, 0.02)
        s = y / LANTERN_HEIGHT
        c = stem_point(s)
        leaves.append(dict(
            origin=np.array([c[0] + 0.05 * math.cos(phi), y, c[2] + 0.05 * math.sin(phi)]), azimuth=phi,
            el0=rng.uniform(0.55, 1.0) + 0.12 * (i / 11.0), el1=rng.uniform(-0.75, -0.3),
            length=rng.uniform(1.1, 1.7) * (1.0 - 0.2 * (i / 11.0)), half_width=rng.uniform(0.13, 0.20),
            twist=rng.uniform(-0.6, 0.6), seed=i,
        ))
    for i in range(8):
        rng = random.Random(400 + i)
        phi = i * GOLDEN + rng.uniform(-0.2, 0.2)
        tendrils.append(dict(
            azimuth=phi, el0=rng.uniform(0.35, 0.9), el1=rng.uniform(-1.35, -1.0),
            length=rng.uniform(0.62, 1.12), pods=[0.42, 0.62, 0.80, 1.0], seed=i,
        ))
    return leaves, tendrils


def build_lantern(lod):
    cfg = LANTERN_LODS[lod]
    M = Mesh()
    leaves, tendrils = lantern_specs()

    # the stem: fat at the foot, slimming to the crown
    steps = cfg["stem_steps"]
    path = [stem_point(i / (steps - 1)) for i in range(steps)]
    radii = []
    for i in range(steps):
        s = i / (steps - 1)
        radii.append(0.092 * (1.0 - 0.52 * s) * (1.0 + 0.7 * (1.0 - s) ** 6))

    def stem_colour(i, k):
        s = i / (steps - 1)
        c = mix(STEM_BASE, STEM_TOP, s * 1.1)
        ring = 0.5 + 0.5 * math.sin(s * 40.0)  # faint growth rings up the stem
        return c * (0.88 + 0.16 * ring) * (0.94 + 0.06 * noise3((k, i, 0.2), 5.0))
    tube(M, path, radii, cfg["stem_k"], stem_colour, STEM, jitter=0.04 if lod == 0 else 0.0, seed=2.0)

    for sp in leaves[:cfg["leaves"]]:
        blade(M, sp["origin"], sp["azimuth"], sp["el0"], sp["el1"], sp["length"], sp["half_width"], cfg["rows"], cfg["across"],
              (LEAF_BASE, LEAF_MID, LEAF_EDGE, LEAF_TIP), curve=1.3, fold=0.035, twist=sp["twist"], shape=0.75)

    crown = stem_point(1.0)
    for sp in tendrils[:cfg["tendrils"]]:
        tpath, d_end = arch(crown + UP * -0.03, sp["azimuth"], sp["el0"], sp["el1"], sp["length"], cfg["tendril_steps"], curve=1.6)
        n = len(tpath)
        radii = [lerp(0.012, 0.0055, i / (n - 1)) for i in range(n)]
        tube(M, tpath, radii, cfg["tendril_k"], lambda i, k, n=n: mix(STEM_TOP, STEM_TIP, i / (n - 1)), STEM)
        # pods strung along the tendril, the last (and biggest) at the end
        for q, at in enumerate(sp["pods"][-cfg["pods"]:]):
            rng = random.Random(500 + sp["seed"] * 7 + q)
            idx = min(int(round(at * (n - 1))), n - 1)
            radius = rng.uniform(0.040, 0.058) * (1.35 if at == 1.0 else 1.0)
            where = tpath[idx] + np.array([0.0, -radius * 0.95, 0.0])
            teardrop(M, where + UP * radius * 0.9, -UP, radius * 1.9, radius, cfg["pod_k"], cfg["pod_rings"], GLOW, BULB_BASE)

    # the bud at the top: a tall, slim glowing bud in a ring of petals
    bud_rings = 7 if lod < 2 else 4
    teardrop(M, crown + UP * 0.02, UP, 0.40, 0.065, cfg["pod_k"], bud_rings, GLOW, BULB_BASE)
    if cfg["petals"]:
        for p in range(cfg["petals"]):
            phi = TAU * p / cfg["petals"] + 0.3
            blade(M, crown + UP * 0.03 + np.array([0.02 * math.cos(phi), 0.0, 0.02 * math.sin(phi)]), phi, 1.15, 0.35, 0.36, 0.045, 6, 3,
                  (PETAL_BASE, PETAL_BASE, PETAL_BASE, PETAL_TIP), curve=1.5, fold=0.008, shape=0.7)
    return M


# ----------------------------------------------------------------------------- Blender objects
def make_materials():
    def body(name, roughness, cull, floor):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = 0.0
        # a flat, tiny light of its own so the shaded side does not go black under the game's lighting (the palms do the same)
        bsdf.inputs["Emission Color"].default_value = (*floor, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        m.use_backface_culling = cull
        return m

    def glow(name, colour):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.35
        bsdf.inputs["Base Color"].default_value = (*(c * 0.12 for c in colour), 1.0)
        bsdf.inputs["Emission Color"].default_value = (*colour, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
        m.use_backface_culling = True
        return m

    return [body("Glow plant stem", 0.62, True, (0.010, 0.040, 0.044)),
            body("Glow plant leaf", 0.55, False, (0.012, 0.046, 0.050)),
            glow("Glow", (0.22, 0.92, 1.0)),
            glow("Glow violet", (0.62, 0.32, 1.0))]


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


def smooth_by_angle(ob, degrees=40):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(degrees))
    except Exception:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(degrees))


PLANTS = {
    "reed": ("glow_reed", "GlowReed", build_reed),
    "lantern": ("lantern_bloom", "LanternBloom", build_lantern),
}


def export(kind, level):
    prefix, node, builder = PLANTS[kind]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = builder(level)
    ob = make_object(M, node, make_materials())
    smooth_by_angle(ob)
    lows = np.min(np.asarray(M.V), axis=0)
    highs = np.max(np.asarray(M.V), axis=0)
    print(f"{kind} LOD{level}: tris {M.tris()} (stem {M.tris(STEM)}, leaf {M.tris(LEAF)}, glow {M.tris(GLOW)}, violet {M.tris(VIOLET)}) "
          f"verts {len(M.V)} bounds x[{lows[0]:.2f},{highs[0]:.2f}] y[{lows[1]:.2f},{highs[1]:.2f}] z[{lows[2]:.2f},{highs[2]:.2f}]")
    os.makedirs(OUTDIR, exist_ok=True)
    out = os.path.join(OUTDIR, f"{prefix}_lod{level}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=False, export_apply=False,
        export_lights=False, export_cameras=False, export_animations=False, export_skins=False,
        export_vertex_color="MATERIAL", export_normals=True, export_tangents=False, export_texcoords=True,
        export_materials="EXPORT", export_extras=False)
    print("EXPORTED", out, f"{os.path.getsize(out)} bytes")


if __name__ == "__main__":
    for kind in PLANTS:
        if ONLY and ONLY != kind:
            continue
        for level in (0, 1, 2):
            if ONLY_LOD is not None and int(ONLY_LOD) != level:
                continue
            export(kind, level)
