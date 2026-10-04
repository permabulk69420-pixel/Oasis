"""Pickaxe: a hand-made stone pick, built headless in Blender (bpy module).

    python3 tools/pickaxe/build_pickaxe.py --out public/models/pickaxe/pickaxe.glb

A 0.8 m haft of weathered brown wood with a leather-wrapped grip, and a curved head of dark knapped stone lashed across the top
with cream and coral sinew: a long pick on one side (it curves down to a point) and a short flat adze edge on the other. A small
tassel hangs from the lashing on a cord with a glowing cyan bead, like the spear's, so the pickaxe can be found at night. Vertex
colours and one tiny extra material for the glow: no textures.

Frame: built directly in glTF axes (exported with "Y up" off, so nothing is converted). +Y runs up the haft, the origin is the
middle of the grip (the point the hand closes on), the butt end is 0.31 m below it and the top of the haft 0.50 m above it. The
head runs along X: the long pick points to +X and curves down, the adze to -X. The head's broad faces face +Z and -Z and the tassel
hangs on the -Z side. Units are metres.

Objects: "Pickaxe" (materials Pickaxe and Glow: the head, the lashing, the butt binding, the tassel) and "Shaft" (Pickaxe: the
haft with its grip wrap, the part the game's grip code fits the fingers to).
"""
import math
import os
import sys

import bpy
import bmesh  # must come after bpy
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "props"))
from propkit import (opt, UP, norm, lerp, smoothstep, srgb, mix, shade, noise3, wave, Shape, tube, sphere, lumpy,  # noqa: E402
                     make_materials, make_object, smooth_by_angle, export_glb)

OUT = opt("--out", "public/models/pickaxe/pickaxe.glb")

# Palette (sRGB hex).
WOOD = srgb(0x77573B)
WOOD_DARK = srgb(0x48321F)
WOOD_LIGHT = srgb(0xA27F5C)
CHAR = srgb(0x2A1F18)
LEATHER = srgb(0x5A3A24)
LEATHER_EDGE = srgb(0x86593A)
STONE = srgb(0x3B3A3C)         # dark basalt-grey with a warm cast, so it is not the spear's blue-grey
STONE_DEEP = srgb(0x2A2A2E)
STONE_WARM = srgb(0x5B4A3C)
STONE_EDGE = srgb(0xCBBFA6)    # the pale flint edge where it was knapped
SINEW = srgb(0xE3D5AC)
SINEW_SHADE = srgb(0xB89F6B)
CORAL = srgb(0xE5603B)
NAVY = srgb(0x1F2D5C)
TEAL = srgb(0x2FA3A8)
FEATHER_CREAM = srgb(0xEFE6C8)
BONE = srgb(0xD9CFB4)
CYAN = srgb(0x4DF2FF)

PART_PICK, PART_SHAFT = 0, 1
MAT_BODY, MAT_GLOW = 0, 1

# ----------------------------------------------------------------------------- the dimensions (metres)
BUTT_Y = -0.310
TOP_Y = 0.500
HEAD_Y = 0.425            # the height of the head's middle on the haft
GRIP_LO, GRIP_HI = -0.150, 0.105
PICK_LEN = 0.290          # the long pick, +X
ADZE_LEN = 0.175          # the short chisel edge, -X
PICK_DROOP = 0.085
ADZE_DROOP = 0.040
KNOTS = [(-0.12, 0.0020, 0.014), (0.26, 0.0016, 0.012)]


def centre(y):
    """Where the haft's axis is at height y: a very gentle S, zero at the grip."""
    return np.array([0.0028 * math.sin(2.6 * y), y, 0.0020 * math.sin(2.1 * y + 0.4) - 0.0020 * math.sin(0.4)])


def haft_radius(y):
    t = (y - BUTT_Y) / (TOP_Y - BUTT_Y)
    r = lerp(0.0192, 0.0158, min(max(t / 0.55, 0.0), 1.0))
    r += 0.0058 * smoothstep(0.62, 0.86, t)                     # swells where the head sits
    r += 0.0040 * (1.0 - smoothstep(0.0, 0.10, t))              # the butt knob, so it does not slip out of the hand
    for ky, kr, kw in KNOTS:
        r += kr * math.exp(-(((y - ky) / kw) ** 2))
    return r


def build_haft(S):
    ys = [BUTT_Y] + list(np.linspace(BUTT_Y + 0.010, TOP_Y - 0.012, 22)) + [TOP_Y]
    path = [centre(y) for y in ys]
    radii = []
    for y in ys:
        r = haft_radius(y)
        if y == BUTT_Y:
            r *= 0.60
        if y == TOP_Y:
            r *= 0.55
        radii.append((r, r * 0.97))

    def colour(q, i, k):
        y = q[1]
        w = 0.5 + 0.5 * (0.70 * noise3((k, 0, 0), 2.7) + 0.30 * math.sin(y * 4.0 + k * 1.3))
        c = mix(WOOD, WOOD_DARK, 0.80 * w)
        c = mix(c, WOOD_LIGHT, 0.65 * (1 - w) * smoothstep(-0.3, 0.5, y))
        for ky, kr, kw in KNOTS:
            c = mix(c, WOOD_DARK, 0.65 * math.exp(-(((y - ky) / (kw * 1.5)) ** 2)))
        c = mix(c, CHAR, 0.85 * smoothstep(BUTT_Y + 0.05, BUTT_Y, y))
        return shade(c, 1.0 + 0.06 * noise3((k, i, 0), 3.0))

    tube(S, path, radii, 10, (0, 0, 1), colour, 2.0, part=PART_SHAFT, jitter=lumpy(0.035, 2.0))


def build_grip(S):
    """The leather wrap the hand closes on, with a cord band at each end."""
    ys = np.linspace(GRIP_LO, GRIP_HI, 15)
    path = [centre(y) for y in ys]
    radii = []
    for i, y in enumerate(ys):
        r = haft_radius(y) + 0.0020 + (0.0008 if i % 2 == 0 else -0.0004)
        if i in (0, len(ys) - 1):
            r -= 0.0008
        radii.append((r, r))

    def colour(q, i, k):
        y = q[1]
        w = wave(k, y, 5.0)
        c = mix(LEATHER, LEATHER_EDGE, 0.55 * w)
        c = mix(c, LEATHER_EDGE, 0.35 * (smoothstep(GRIP_LO + 0.04, GRIP_LO, y) + smoothstep(GRIP_HI - 0.04, GRIP_HI, y)))
        c = shade(c, 0.88 if i % 2 else 1.0)
        return shade(c, 1.0 + 0.06 * noise3((k, i, 1), 5.0))

    tube(S, path, radii, 10, (0, 0, 1), colour, 2.0, part=PART_SHAFT)
    for y0 in (GRIP_LO + 0.004, GRIP_HI - 0.004):
        pair = [centre(y0 - 0.0045), centre(y0 + 0.0045)]
        r = haft_radius(y0) + 0.0033
        tube(S, pair, [(r, r)] * 2, 10, (0, 0, 1), lambda q, i, k: mix(SINEW_SHADE, SINEW, 0.5 * wave(k, q[1], 7.0)), 2.0, part=PART_SHAFT)


def build_butt_binding(S):
    """A short coral and cream wrap above the butt knob, echoing the lashing at the other end."""
    ys = np.linspace(-0.255, -0.205, 6)
    path = [centre(y) for y in ys]
    radii = [(haft_radius(y) + 0.0024 + (0.0007 if i % 2 == 0 else -0.0003),) * 2 for i, y in enumerate(ys)]
    pattern = "ccrrcc"
    tube(S, path, radii, 10, (0, 0, 1),
         lambda q, i, k: shade(CORAL if pattern[i] == "r" else mix(SINEW, SINEW_SHADE, 0.4 * wave(k, q[1], 6.0)), 1.0 + 0.05 * noise3((k, i, 3), 2.0)),
         2.0, part=PART_PICK)


# ----------------------------------------------------------------------------- the stone head
def head_axis(x):
    """The curve the head follows: level in the middle, drooping toward both points (the pick droops further)."""
    if x >= 0:
        return HEAD_Y - PICK_DROOP * (x / PICK_LEN) ** 1.9
    return HEAD_Y - ADZE_DROOP * (-x / ADZE_LEN) ** 1.9


def head_radii(x):
    """(vertical half size, half thickness) at x: bulky round the haft, then tapering. The pick ends in a point, the adze in
    a thin, wide chisel edge."""
    boss = (0.0400, 0.0330)
    if x >= 0:
        s = x / PICK_LEN
        taper = max(0.0, 1.0 - smoothstep(0.06, 1.0, s)) ** 1.25
        return (lerp(0.0028, boss[0], taper), lerp(0.0028, boss[1], taper))
    s = -x / ADZE_LEN
    t = smoothstep(0.10, 1.0, s)
    return (lerp(boss[0], 0.0045, t ** 0.9), lerp(boss[1], 0.0290, t ** 0.7))


def build_head(S):
    xs = list(np.linspace(-ADZE_LEN, 0.0, 8)) + list(np.linspace(0.0, PICK_LEN, 14)[1:])
    path = [np.array([x, head_axis(x), 0.0]) for x in xs]
    radii = [head_radii(x) for x in xs]
    n = len(xs)

    def colour(q, i, k):
        local = noise3((q[0] * 37.0, q[1] * 41.0, q[2] * 33.0), 8.0)
        c = mix(STONE, STONE_WARM, 0.5 + 0.5 * local)
        # K = 8: points 0 and 4 are the top and bottom ridges (the knapped edges), 2 and 6 the broad faces
        edge = 1.0 if k in (0, 4) else (0.28 if k in (1, 3, 5, 7) else 0.0)
        c = mix(c, STONE_EDGE, 0.30 * edge * smoothstep(0.02, 0.5, abs(q[0]) / PICK_LEN))
        c = mix(c, STONE_DEEP, 0.40 * (1.0 if k in (2, 6) else 0.0))
        c = mix(c, STONE_EDGE, 0.50 * smoothstep(PICK_LEN - 0.04, PICK_LEN, q[0]))   # the freshly knapped point
        c = mix(c, STONE_EDGE, 0.55 * smoothstep(-ADZE_LEN + 0.025, -ADZE_LEN, q[0]))  # and the chisel edge
        return shade(c, 1.0 + 0.10 * local)

    def chip(ring, c, i):
        """Move the facet corners a little, so no two facets lie in the same plane (the faces are flat shaded)."""
        out = []
        for k, q in enumerate(ring):
            d = np.array([noise3((q[0] * 53.0, q[1] * 61.0, k), 1.1), noise3((q[1] * 43.0, q[2] * 51.0, k), 3.3), noise3((q[2] * 47.0, q[0] * 59.0, k), 2.2)])
            amount = 0.0026 if 0 < i < n - 1 else 0.0
            out.append(q + amount * d)
        return np.array(out)

    tube(S, path, radii, 8, (0, 0, 1), colour, 1.6, jitter=chip, flat=True, part=PART_PICK)


LASH_Y0, LASH_Y1 = HEAD_Y - 0.056, HEAD_Y + 0.056
LASH_PATTERN = "cccrrccccccrrccc"


def build_lashing(S):
    """Sixteen wraps of sinew round the haft's top and the head's middle, with a few coral turns."""
    n = len(LASH_PATTERN)
    ys = np.linspace(LASH_Y0, LASH_Y1, n)
    path = [np.array([centre(TOP_Y)[0], y, centre(TOP_Y)[2]]) for y in ys]
    radii = []
    for i, y in enumerate(ys):
        t = i / (n - 1)
        swell = smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.70, 1.0, t))
        r = lerp(0.0310, 0.0420, swell)
        r *= 1.0 + (0.06 if i % 2 == 0 else -0.045)
        radii.append((r, r * 0.95))   # a little narrower front to back than side to side: the head is thinner that way

    def colour(q, i, k):
        coral = LASH_PATTERN[i] == "r"
        c = CORAL if coral else mix(SINEW, SINEW_SHADE, 0.45 * wave(k, q[1], 2.0))
        c = shade(c, 0.84 if i % 2 else 1.0)
        return shade(c, 1.0 + 0.05 * noise3((k, i, 2), 9.0))

    tube(S, path, radii, 12, (0, 0, 1), colour, 2.0, jitter=lumpy(0.02, 4.0), part=PART_PICK)


def build_cap(S):
    """The haft's top end above the lashing: a rounded cap of the same wood."""
    pass


# ----------------------------------------------------------------------------- the tassel
CORD_TOP = np.array([0.0, HEAD_Y - 0.040, -0.0400])
BEAD_DROP = 0.082


def tassel_axis(t):
    """The cord hangs nearly straight down from the lashing's -Z side, a little out from it. t is 0 at the top, 1 at the bead."""
    return CORD_TOP + np.array([0.0035 * t, -BEAD_DROP * t, -0.016 * t])


def feather_half_width(t, half):
    if t >= 0.985:
        return 0.0007
    return max(0.0007, half * math.sin(math.pi * t ** 0.55) ** 0.75)


def build_tassel(S):
    ts = np.linspace(0.0, 0.96, 5)
    cord = [tassel_axis(t) for t in ts]
    tube(S, cord, [(0.0016, 0.0016)] * len(cord), 6, (1, 0, 0), lambda q, i, k: mix(SINEW, SINEW_SHADE, 0.4 * wave(k, q[1], 3.0)), 2.0, part=PART_PICK)
    sphere(S, tassel_axis(0.42), 0.0048, MAT_BODY, lambda q, i, k: shade(BONE, 0.9 + 0.1 * noise3((k, i, 5), 1.0)), part=PART_PICK)
    sphere(S, tassel_axis(1.0), 0.0092, MAT_GLOW, lambda q, i, k: CYAN, part=PART_PICK)
    anchor = tassel_axis(1.0) + np.array([0.0, -0.006, 0.0])
    specs = [  # angle round the cord (270 is straight back), length, half width, colours (vane, edge, tip)
        (212.0, 0.120, 0.0125, (NAVY, TEAL, CORAL)),
        (274.0, 0.138, 0.0135, (TEAL, NAVY, FEATHER_CREAM)),
        (332.0, 0.108, 0.0120, (FEATHER_CREAM, TEAL, TEAL)),
    ]
    for angle, length, half, (vane, edge, tip) in specs:
        a = math.radians(angle)
        out = np.array([math.cos(a), 0.0, math.sin(a)])
        flat = np.array([-math.sin(a), 0.0, math.cos(a)])
        steps = 10
        path, radii = [], []
        for i in range(steps):
            t = i / (steps - 1)
            path.append(anchor + (-UP) * length * t + out * (0.004 + 0.026 * t * t) * (length / 0.12))
            radii.append((feather_half_width(t, half), 0.0012))

        def colour(q, i, k, vane=vane, edge=edge, tip=tip):
            t = i / (steps - 1)
            c = mix(vane, edge, 0.55 if k in (0, 3) else 0.0)
            c = mix(c, tip, smoothstep(0.66, 0.90, t))
            if k in (1, 4):
                c = mix(c, FEATHER_CREAM, 0.65)
            return c

        tube(S, path, radii, 6, flat, colour, 2.0, part=PART_PICK)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    S = Shape()
    report = []
    for part in (build_haft, build_grip, build_butt_binding, build_head, build_lashing, build_tassel):
        before = S.tris()
        part(S)
        report.append(f"{part.__name__[6:]} {S.tris() - before}")
    print("   parts:", ", ".join(report))
    body_mat, glow_mat = make_materials("Pickaxe")
    pick_ob, pick_flat = make_object(S, PART_PICK, "Pickaxe", [body_mat, glow_mat])
    shaft_ob, shaft_flat = make_object(S, PART_SHAFT, "Shaft", [body_mat])
    for ob, flat in ((pick_ob, pick_flat), (shaft_ob, shaft_flat)):
        smooth_by_angle(ob)
        for j in flat:   # the stone's facets stay facets
            ob.data.polygons[j].use_smooth = False
        ob.data.update()
    lows = np.min(np.asarray(S.V), axis=0)
    highs = np.max(np.asarray(S.V), axis=0)
    print(f"tris {S.tris()} (pickaxe {S.tris(PART_PICK)}, shaft {S.tris(PART_SHAFT)}) shells {S.shells} verts {len(S.V)} "
          f"bounds x[{lows[0]:.3f},{highs[0]:.3f}] y[{lows[1]:.3f},{highs[1]:.3f}] z[{lows[2]:.3f},{highs[2]:.3f}]")
    export_glb(OUT)


main()
