"""Spear: a hand-made survival spear, built headless in Blender (bpy module).

    python3 tools/spear/build_spear.py --out public/models/spear/spear.glb

A 1.47 m shaft of weathered brown wood with a leather-wrapped grip, a knapped blue-grey stone point lashed on with cream and
coral sinew, and a small tassel of alien feathers hanging from the lashing on a cord with a glowing cyan bead, so the spear
can be found at night. Vertex colours and one tiny extra material for the glow: no textures.

Frame: built directly in glTF axes (exported with "Y up" off, so nothing is converted). +Y runs up the shaft to the tip,
the origin is in the middle of the grip (so it is the point the hand closes on), the butt end is 0.52 m below it and the
tip 0.955 m above it. The stone's broad faces face +Z and -Z; the tassel hangs on the -Z side. Units are metres.

Objects: "Spear" (materials Spear and Glow: the point, the lashing and the tassel) and "Shaft" (Spear: the wooden shaft with
its grip wrap, the part the game's grip code fits the fingers to).
"""
import math
import os
import sys

import bpy
import bmesh  # must come after bpy
import numpy as np

A = sys.argv


def opt(name, default):
    return A[A.index(name) + 1] if name in A else default


OUT = opt("--out", "public/models/spear/spear.glb")

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
    """A cheap repeatable value in [-1, 1] that varies from point to point (colour mottling)."""
    x = math.sin(p[0] * 127.1 + p[1] * 311.7 + p[2] * 74.7 + seed) * 43758.5453
    return (x - math.floor(x)) * 2.0 - 1.0


def wave(k, y, seed=0.0):
    """Long wavy streaks: smooth along the length, different round the circumference (0..1)."""
    return 0.5 + 0.5 * math.sin(k * 1.9 + y * 11.0 + seed + 2.0 * math.sin(y * 5.0 + k * 0.7 + seed))


# Palette (sRGB hex).
WOOD = srgb(0x7A5A3E)          # weathered brown shaft
WOOD_DARK = srgb(0x4B3524)
WOOD_LIGHT = srgb(0xA58260)
CHAR = srgb(0x2A1F18)          # the fire-hardened butt
LEATHER = srgb(0x5A3A24)       # the grip wrap
LEATHER_EDGE = srgb(0x86593A)
STONE = srgb(0x3F5E69)         # knapped blue-grey stone, dark enough to read against the sky
STONE_DEEP = srgb(0x22393F)
STONE_EDGE = srgb(0x9DBAB9)
STONE_WARM = srgb(0x5A6E6A)
SINEW = srgb(0xE3D5AC)         # cream lashing
SINEW_SHADE = srgb(0xB89F6B)
CORAL = srgb(0xE5603B)
NAVY = srgb(0x1F2D5C)          # alien feathers: midnight blue, teal, cream, coral
TEAL = srgb(0x2FA3A8)
FEATHER_CREAM = srgb(0xEFE6C8)
BONE = srgb(0xD9CFB4)
CYAN = srgb(0x4DF2FF)

PART_SPEAR, PART_SHAFT = 0, 1
MAT_SPEAR, MAT_GLOW = 0, 1


# ----------------------------------------------------------------------------- solid shells
class Shape:
    """Every closed shell of the spear with a colour on each vertex."""

    def __init__(self):
        self.V, self.C, self.F, self.M, self.P = [], [], [], [], []
        self.flat = set()   # indices of faces to shade flat (the faceted stone)
        self.shells = 0

    def tris(self, part=None, mat=None):
        return sum(len(f) - 2 for f, m, p in zip(self.F, self.M, self.P)
                   if (part is None or p == part) and (mat is None or m == mat))

    def shell(self, rings, colours, mat=MAT_SPEAR, part=PART_SPEAR, flat=False):
        """A closed tube through `rings` (equal-length rings of 3D points), capped at both ends. colours[i][k] is the
        colour of vertex k of ring i. Faces are wound outward whatever order the rings came in."""
        base = len(self.V)
        K = len(rings[0])
        faces = []
        for ring, cols in zip(rings, colours):
            for p, c in zip(ring, cols):
                self.V.append(np.asarray(p, float))
                self.C.append(np.asarray(c, float))
        n = len(rings)
        for i in range(n - 1):
            for k in range(K):
                k2 = (k + 1) % K
                faces.append((base + i * K + k, base + i * K + k2, base + (i + 1) * K + k2, base + (i + 1) * K + k))
        for end in (0, n - 1):
            ring = np.asarray(rings[end], float)
            self.V.append(ring.mean(axis=0))
            self.C.append(np.asarray(colours[end], float).mean(axis=0))
            ci = len(self.V) - 1
            for k in range(K):
                k2 = (k + 1) % K
                faces.append((ci, base + end * K + k, base + end * K + k2))
        volume = 0.0
        for f in faces:
            p = [self.V[i] for i in f]
            for j in range(1, len(p) - 1):
                volume += np.dot(p[0], np.cross(p[j], p[j + 1])) / 6.0
        if volume < 0:
            faces = [tuple(reversed(f)) for f in faces]
        if flat:
            self.flat.update(range(len(self.F), len(self.F) + len(faces)))
        self.F.extend(faces)
        self.M.extend([mat] * len(faces))
        self.P.extend([part] * len(faces))
        self.shells += 1


def super_ring(c, a_axis, b_axis, ra, rb, K, p=2.0, phase=0.0):
    """K points around a superellipse in the plane of a_axis and b_axis (p = 2 is an ellipse, higher is boxier, lower is
    a diamond)."""
    pts = []
    for k in range(K):
        t = phase + math.tau * k / K
        ct, st = math.cos(t), math.sin(t)
        x = math.copysign(abs(ct) ** (2.0 / p), ct)
        y = math.copysign(abs(st) ** (2.0 / p), st)
        pts.append(c + a_axis * ra * x + b_axis * rb * y)
    return np.array(pts)


def frames_along(path, hint):
    """right/up unit vectors at every point of `path`, perpendicular to the way it runs; `hint` says which way is up."""
    out = []
    for i in range(len(path)):
        a, b = path[max(i - 1, 0)], path[min(i + 1, len(path) - 1)]
        t = norm(b - a)
        right = np.cross(t, hint)
        if np.linalg.norm(right) < 1e-4:
            right = np.cross(t, np.array([1.0, 0.0, 0.0]))
        right = norm(right)
        up = np.cross(right, t)
        out.append((right, norm(up)))
    return out


def tube(S, path, radii, K, hint, colour, p=2.0, phase=0.0, mat=MAT_SPEAR, part=PART_SPEAR, jitter=None, flat=False):
    """A tube along `path` (rows of 3D points). radii[i] = (half size along `right`, half size along `up`) where right
    and up are perpendicular to the path (see frames_along). colour(point, i, k) -> rgb."""
    path = [np.asarray(q, float) for q in path]
    fr = frames_along(path, np.asarray(hint, float))
    rings, cols = [], []
    for i, (c, (right, up)) in enumerate(zip(path, fr)):
        ra, rb = radii[i]
        ring = super_ring(c, right, up, max(ra, 0.0006), max(rb, 0.0006), K, p, phase)
        if jitter:
            ring = jitter(ring, c, i)
        rings.append(ring)
        cols.append([colour(q, i, k) for k, q in enumerate(ring)])
    S.shell(rings, cols, mat, part, flat)


# ----------------------------------------------------------------------------- the dimensions (metres)
BUTT_Y = -0.520
SHAFT_TOP_Y = 0.745
TIP_Y = 0.955
GRIP_LO, GRIP_HI = -0.155, 0.125
KNOTS = [(-0.33, 0.0022, 0.014), (0.31, 0.0018, 0.012), (0.52, 0.0014, 0.010)]  # y, bump, width: the odd knot in the wood


def centre(y):
    """Where the shaft's axis is at height y: a gentle S, zero at the grip, so it looks cut from a real branch."""
    return np.array([0.0030 * math.sin(2.3 * y), y, 0.0022 * math.sin(1.9 * y + 0.4) - 0.0022 * math.sin(0.4)])


def shaft_radius(y):
    t = (y - BUTT_Y) / (SHAFT_TOP_Y - BUTT_Y)
    r = lerp(0.0188, 0.0150, min(max(t, 0.0), 1.0) ** 0.9)
    for ky, kr, kw in KNOTS:
        r += kr * math.exp(-(((y - ky) / kw) ** 2))
    return r


# ----------------------------------------------------------------------------- the parts
def lumpy(amount, seed):
    """A jitter that nudges every vertex of a ring in or out a little, so a tube is not a perfect lathe turning."""
    def apply(ring, c, i):
        out = []
        for k, q in enumerate(ring):
            out.append(c + (q - c) * (1.0 + amount * noise3((k, i, 0.5), seed)))
        return np.array(out)
    return apply


def build_shaft(S):
    ys = [BUTT_Y] + list(np.linspace(BUTT_Y + 0.012, SHAFT_TOP_Y, 19))
    path = [centre(y) for y in ys]
    radii = []
    for y in ys:
        r = shaft_radius(y)
        if y == BUTT_Y:
            r *= 0.62  # the butt is rounded over: a small first ring, then straight out to full size
        radii.append((r, r * 0.97))

    def colour(q, i, k):
        y = q[1]
        # grain: each of the ten lines along the shaft keeps its own tone, wandering slowly with the length
        w = 0.5 + 0.5 * (0.70 * noise3((k, 0, 0), 1.7) + 0.30 * math.sin(y * 4.0 + k * 1.3))
        c = mix(WOOD, WOOD_DARK, 0.80 * w)
        c = mix(c, WOOD_LIGHT, 0.70 * (1 - w) * smoothstep(-0.3, 0.7, y))
        for ky, kr, kw in KNOTS:     # a darker scar round each knot
            c = mix(c, WOOD_DARK, 0.65 * math.exp(-(((y - ky) / (kw * 1.5)) ** 2)))
        c = mix(c, CHAR, 0.85 * smoothstep(-0.455, -0.52, y))      # the fire-hardened, charred butt
        c = shade(c, 1.0 + 0.06 * noise3((k, i, 0), 3.0))
        return c

    tube(S, path, radii, 10, (0, 0, 1), colour, 2.0, part=PART_SHAFT, jitter=lumpy(0.035, 1.0))


def build_grip(S):
    """The leather wrap the hand closes on: a thin strip wound over the shaft (alternate rings a touch fatter, so it reads
    as turns of leather), with a cord band at each end."""
    ys = np.linspace(GRIP_LO, GRIP_HI, 17)
    path = [centre(y) for y in ys]
    radii = []
    for i, y in enumerate(ys):
        r = shaft_radius(y) + 0.0020 + (0.0008 if i % 2 == 0 else -0.0004)
        if i in (0, len(ys) - 1):
            r -= 0.0008
        radii.append((r, r))

    def colour(q, i, k):
        y = q[1]
        w = wave(k, y, 4.0)
        c = mix(LEATHER, LEATHER_EDGE, 0.55 * w)
        c = mix(c, LEATHER_EDGE, 0.35 * (smoothstep(GRIP_LO + 0.04, GRIP_LO, y) + smoothstep(GRIP_HI - 0.04, GRIP_HI, y)))
        c = shade(c, 0.88 if i % 2 else 1.0)   # the grooves between turns
        return shade(c, 1.0 + 0.06 * noise3((k, i, 1), 5.0))

    tube(S, path, radii, 10, (0, 0, 1), colour, 2.0, part=PART_SHAFT)
    # two cord bands that hold the ends of the wrap down
    for y0 in (GRIP_LO + 0.004, GRIP_HI - 0.004):
        pair = [centre(y0 - 0.0045), centre(y0 + 0.0045)]
        r = shaft_radius(y0) + 0.0033
        tube(S, pair, [(r, r)] * 2, 10, (0, 0, 1), lambda q, i, k: mix(SINEW_SHADE, SINEW, 0.5 * wave(k, q[1], 7.0)), 2.0, part=PART_SHAFT)


def build_butt_binding(S):
    """A short coral and cream wrap near the butt, so the colours of the lashing are echoed at the other end."""
    ys = np.linspace(-0.464, -0.416, 6)
    path = [centre(y) for y in ys]
    radii = [(shaft_radius(y) + 0.0024 + (0.0007 if i % 2 == 0 else -0.0003), shaft_radius(y) + 0.0024 + (0.0007 if i % 2 == 0 else -0.0003)) for i, y in enumerate(ys)]
    pattern = "ccrrcc"
    tube(S, path, radii, 10, (0, 0, 1),
         lambda q, i, k: shade(CORAL if pattern[i] == "r" else mix(SINEW, SINEW_SHADE, 0.4 * wave(k, q[1], 6.0)), 1.0 + 0.05 * noise3((k, i, 3), 2.0)),
         2.0, part=PART_SHAFT)


# The stone point: a narrow tang (inside the lashing), shoulders, then a leaf. Faceted, as knapped stone is.
POINT_Y0 = 0.700
SHOULDER_Y = 0.797
WIDEST_Y = 0.832
POINT_WIDTH = 0.0295


def point_half_width(y):
    if y <= SHOULDER_Y:
        return 0.0125
    if y <= WIDEST_Y:
        return lerp(0.0125, POINT_WIDTH, smoothstep(SHOULDER_Y, WIDEST_Y, y))
    s = (y - WIDEST_Y) / (TIP_Y - WIDEST_Y)
    return POINT_WIDTH * max(0.0, 1.0 - s ** 1.7) ** 0.78


def build_point(S):
    ys = [POINT_Y0, 0.735, 0.770, SHOULDER_Y, 0.814, WIDEST_Y, 0.850, 0.868, 0.886, 0.904, 0.921, 0.936, 0.947, TIP_Y]
    x0, z0 = centre(SHAFT_TOP_Y)[0], centre(SHAFT_TOP_Y)[2]
    path = [np.array([x0, y, z0]) for y in ys]
    radii = []
    for i, y in enumerate(ys):
        w = point_half_width(y)
        if SHOULDER_Y < y < TIP_Y - 0.012:
            w *= 1.0 + 0.07 * (1 if i % 2 else -1)   # the little steps along an edge where flakes came off
        thick = 0.0045 if y <= SHOULDER_Y else 0.0045 + 0.0034 * math.sqrt(point_half_width(y) / POINT_WIDTH)
        radii.append((max(w, 0.0004), max(thick, 0.0004) if y < TIP_Y else 0.0004))

    def colour(q, i, k):
        y = q[1]
        local = noise3((q[0] * 41.0, y * 37.0, q[2] * 29.0), 8.0)
        c = mix(STONE, STONE_WARM, 0.5 + 0.5 * local)
        # K = 8: points 0 and 4 are the two cutting edges, 2 and 6 the ridges on the broad faces
        edge = 1.0 if k in (0, 4) else (0.30 if k in (1, 3, 5, 7) else 0.0)
        c = mix(c, STONE_EDGE, 0.75 * edge)
        c = mix(c, STONE_DEEP, 0.55 * (1.0 if k in (2, 6) else 0.0) * smoothstep(SHOULDER_Y, WIDEST_Y + 0.03, y))
        c = mix(c, STONE_DEEP, 0.60 * smoothstep(SHOULDER_Y, POINT_Y0, y))   # the tang, under the lashing
        c = mix(c, STONE_EDGE, 0.55 * smoothstep(TIP_Y - 0.035, TIP_Y, y))
        return shade(c, 1.0 + 0.10 * local)

    def chip(ring, c, i):
        """Move the facet corners a little, so no two facets lie in the same plane (the faces are flat shaded)."""
        out = []
        for k, q in enumerate(ring):
            d = np.array([noise3((q[0] * 53.0, q[1] * 61.0, k), 1.1), 0.0, noise3((q[2] * 47.0, q[1] * 59.0, k), 2.2)])
            out.append(q + 0.0009 * d * (0.0 if i in (0, len(ys) - 1) else 1.0))
        return np.array(out)

    tube(S, path, radii, 8, (0, 0, 1), colour, 1.5, jitter=chip, flat=True)


# The lashing: 16 wraps of sinew over the top of the shaft and the foot of the stone, with a few coral turns.
LASH_Y0, LASH_Y1 = 0.652, 0.800
LASH_PATTERN = "cccrrccccccrrccc"


def build_lashing(S):
    n = len(LASH_PATTERN)
    ys = np.linspace(LASH_Y0, LASH_Y1, n)
    x0, z0 = centre(SHAFT_TOP_Y)[0], centre(SHAFT_TOP_Y)[2]
    path = [np.array([x0, y, z0]) for y in ys]
    radii = []
    for i, y in enumerate(ys):
        t = i / (n - 1)
        swell = smoothstep(0.0, 0.28, t) * (1.0 - smoothstep(0.55, 1.0, t))
        r = lerp(0.0163, 0.0236, swell)
        r *= 1.0 + (0.06 if i % 2 == 0 else -0.045)    # wraps and the grooves between them
        radii.append((r, r))

    def colour(q, i, k):
        coral = LASH_PATTERN[i] == "r"
        c = CORAL if coral else mix(SINEW, SINEW_SHADE, 0.45 * wave(k, q[1], 2.0))
        c = shade(c, 0.84 if i % 2 else 1.0)           # darker in the grooves
        return shade(c, 1.0 + 0.05 * noise3((k, i, 2), 9.0))

    tube(S, path, radii, 12, (0, 0, 1), colour, 2.0, jitter=lumpy(0.02, 4.0))


# The tassel hangs on the -Z side from the foot of the lashing: a cord, a bone bead, a glowing cyan bead and three feathers.
CORD_TOP_Y = 0.664
BEAD_Y = 0.576


def tassel_axis(y):
    """The cord runs nearly straight down from inside the lashing, a little out from the shaft."""
    t = (CORD_TOP_Y - y) / (CORD_TOP_Y - BEAD_Y)
    x0, z0 = centre(SHAFT_TOP_Y)[0], centre(SHAFT_TOP_Y)[2]
    return np.array([x0 + 0.0030 * t, y, z0 - 0.0150 - 0.0100 * t])


def sphere(S, c, r, mat, colour, K=8, rings=7, axis=UP):
    """A closed bead: a stack of rings whose radius follows a half circle."""
    a = norm(np.cross(axis, np.array([1.0, 0.0, 0.0])))
    path, radii = [], []
    for i in range(rings):
        t = (i + 0.5) / rings
        path.append(c + axis * r * math.cos(math.pi * t))
        s = math.sin(math.pi * t) * r
        radii.append((s, s))
    tube(S, path, radii, K, a, colour, 2.0, mat=mat)


def feather_half_width(t, half):
    """A broad leaf: a narrow quill, widest about a third of the way down, a rounded tip."""
    if t >= 0.985:
        return 0.0007
    return max(0.0007, half * math.sin(math.pi * t ** 0.55) ** 0.75)


def build_tassel(S):
    # cord
    ys = np.linspace(CORD_TOP_Y, BEAD_Y + 0.004, 5)
    cord = [tassel_axis(y) for y in ys]
    tube(S, cord, [(0.0017, 0.0017)] * len(cord), 6, (1, 0, 0), lambda q, i, k: mix(SINEW, SINEW_SHADE, 0.4 * wave(k, q[1], 3.0)), 2.0)
    # a bone bead near the top and the glowing bead at the end
    sphere(S, tassel_axis(0.632), 0.0052, MAT_SPEAR, lambda q, i, k: shade(BONE, 0.9 + 0.1 * noise3((k, i, 5), 1.0)))
    sphere(S, tassel_axis(BEAD_Y), 0.0095, MAT_GLOW, lambda q, i, k: CYAN)
    # three feathers hang from under the glowing bead, fanned out behind the shaft
    anchor = tassel_axis(BEAD_Y - 0.007)
    specs = [  # angle round the cord (270 is straight back), length, half width, colours (vane, edge, tip)
        (206.0, 0.172, 0.0165, (NAVY, TEAL, CORAL)),
        (270.0, 0.196, 0.0178, (TEAL, NAVY, FEATHER_CREAM)),
        (334.0, 0.156, 0.0158, (FEATHER_CREAM, TEAL, TEAL)),
    ]
    for angle, length, half, (vane, edge, tip) in specs:
        a = math.radians(angle)
        out = np.array([math.cos(a), 0.0, math.sin(a)])
        flat = np.array([-math.sin(a), 0.0, math.cos(a)])   # the vane's broad faces face along this, tangent to the fan
        steps = 10
        path, radii = [], []
        for i in range(steps):
            t = i / (steps - 1)
            path.append(anchor + (-UP) * length * t + out * (0.005 + 0.034 * t * t) * (length / 0.17))
            radii.append((feather_half_width(t, half), 0.0013))

        def colour(q, i, k, vane=vane, edge=edge, tip=tip):
            t = i / (steps - 1)
            c = mix(vane, edge, 0.55 if k in (0, 3) else 0.0)
            c = mix(c, tip, smoothstep(0.66, 0.90, t))
            if k in (1, 4):   # the rachis: a pale line down the middle of both faces
                c = mix(c, FEATHER_CREAM, 0.65)
            return c

        tube(S, path, radii, 6, flat, colour, 2.0)


# ----------------------------------------------------------------------------- Blender objects
def make_materials():
    spear = bpy.data.materials.new("Spear")
    spear.use_nodes = True
    nt = spear.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.90
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.25
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    spear.use_backface_culling = True

    glow = bpy.data.materials.new("Glow")
    glow.use_nodes = True
    gb = glow.node_tree.nodes["Principled BSDF"]
    gb.inputs["Roughness"].default_value = 0.5
    gb.inputs["Base Color"].default_value = (0.02, 0.08, 0.10, 1)
    gb.inputs["Emission Color"].default_value = (0.25, 0.95, 1.0, 1)
    gb.inputs["Emission Strength"].default_value = 1.0
    glow.use_backface_culling = True
    return spear, glow


def make_object(S, part, name, mats):
    keep = [i for i, p in enumerate(S.P) if p == part]
    used, remap = [], {}
    faces = []
    for i in keep:
        f = []
        for v in S.F[i]:
            if v not in remap:
                remap[v] = len(used)
                used.append(v)
            f.append(remap[v])
        faces.append(tuple(f))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(S.V[v]) for v in used], [], faces)
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    cols = np.clip(np.asarray([S.C[v] for v in used], float), 0, 1)
    rgba = np.concatenate([cols, np.ones((len(cols), 1))], 1)
    ca.data.foreach_set("color", rgba.ravel())
    for m in mats:
        me.materials.append(m)
    for poly, i in zip(me.polygons, keep):
        poly.material_index = S.M[i] if len(mats) > 1 else 0
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, [j for j, i in enumerate(keep) if i in S.flat]


def smooth_by_angle(ob, degrees=38):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(degrees))
    except Exception:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(degrees))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    S = Shape()
    report = []
    for part in (build_shaft, build_grip, build_butt_binding, build_point, build_lashing, build_tassel):
        before = S.tris()
        part(S)
        report.append(f"{part.__name__[6:]} {S.tris() - before}")
    print("   parts:", ", ".join(report))
    spear_mat, glow_mat = make_materials()
    spear_ob, spear_flat = make_object(S, PART_SPEAR, "Spear", [spear_mat, glow_mat])
    shaft_ob, shaft_flat = make_object(S, PART_SHAFT, "Shaft", [spear_mat])
    for ob, flat in ((spear_ob, spear_flat), (shaft_ob, shaft_flat)):
        smooth_by_angle(ob)
        for j in flat:   # the stone's facets stay facets
            ob.data.polygons[j].use_smooth = False
        ob.data.update()
    lows = np.min(np.asarray(S.V), axis=0)
    highs = np.max(np.asarray(S.V), axis=0)
    print(f"tris {S.tris()} (spear {S.tris(PART_SPEAR, MAT_SPEAR)}, glow {S.tris(PART_SPEAR, MAT_GLOW)}, shaft {S.tris(PART_SHAFT)}) shells {S.shells} "
          f"verts {len(S.V)} bounds x[{lows[0]:.3f},{highs[0]:.3f}] y[{lows[1]:.3f},{highs[1]:.3f}] z[{lows[2]:.3f},{highs[2]:.3f}]")
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format="GLB", export_yup=False, export_apply=False,
        export_lights=False, export_cameras=False, export_animations=False, export_skins=False,
        export_vertex_color="MATERIAL", export_normals=True, export_tangents=False, export_texcoords=False,
        export_materials="EXPORT", export_extras=False)
    print("EXPORTED", OUT, f"{os.path.getsize(OUT)} bytes")


main()
