"""Giant bones: the ribcage and the skull of something enormous, half buried in the dunes. Built headless in Blender (bpy module).

    python3 tools/giant-bones/build_bones.py [--model ribs|skull|both] [--lod 0|1|2|all] [--outdir public/models/bones]

Two models, three levels of detail each (`giant_ribs_lod0.glb` ... `giant_skull_lod2.glb`). They are landmarks: something you see on the
horizon and walk out to. Vertex colours only (ivory, sand-stained where it is buried, a little teal mineral staining), one material.

Frame: built directly in glTF axes (exported with "Y up" off, so nothing is converted): +Y up, +Z is the length of the animal (the skull's
snout points to +Z), metres. y = 0 is the sand, and the game puts that on the ground. Whatever lies below y = 0 is buried, so the parts
that go into the dune are modelled long enough to still be hidden when the ground tips a metre or two.

  ribs   an arched ribcage lying on its belly, the spine along the top of the arches (a row of tall spines on it): seven pairs of ribs
         about 6 to 9 m tall, one rib missing, three snapped off and one fallen on the sand beside it, a stretch of spine collapsed. About 9 m
         across and 20 m long.
  skull  a long skull with a crest, two sweeping horns, deep eye sockets, nostrils, a mouth of conical teeth and a lower jaw hanging open.
         About 11 m long, 5 m wide across the cranium; the horns reach 6 m above it.
"""
import math
import os
import sys

import bpy
import bmesh  # must come after bpy
import numpy as np
from mathutils import noise as bnoise
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "props"))
from propkit import (opt, norm, lerp, smoothstep, srgb, mix, shade, wave, Shape, tube,  # noqa: E402
                     make_materials, make_object, smooth_by_angle, export_glb)

# ----------------------------------------------------------------------------------------------------------------- palette (sRGB hex)
BONE = srgb(0xE9E0C6)
BONE_LIGHT = srgb(0xF8F1DD)
BONE_SHADE = srgb(0xBFB192)
SAND_STAIN = srgb(0xC2A56F)
CREVICE = srgb(0x4B3D2E)
SOCKET = srgb(0x15110E)
TEAL = srgb(0x3F9690)
ENAMEL = srgb(0xF2EAD2)
TOOTH_ROOT = srgb(0xB59F79)

# What each level of detail costs. `rings` scales how many rings a tube has, `sides` how many points round it.
LODS = {
    0: dict(rings=1.0, sides=1.0, teeth=1.0, stations=1.0, label="close"),
    1: dict(rings=0.42, sides=0.55, teeth=0.7, stations=0.5, label="middle"),
    2: dict(rings=0.17, sides=0.36, teeth=0.4, stations=0.22, label="far"),
}


def n_of(base, scale, minimum=3):
    return max(minimum, int(round(base * scale)))


def fbm(p, seed=0.0, octaves=3, base=1.0):
    """Smooth coherent noise in roughly [-1, 1] (Blender's Perlin noise, a few octaves)."""
    total, amp, freq, norm_ = 0.0, 1.0, base, 0.0
    for o in range(octaves):
        total += amp * bnoise.noise(Vector((p[0] * freq + seed * 7.1, p[1] * freq + seed * 3.7, p[2] * freq + seed * 5.3)))
        norm_ += amp
        amp *= 0.5
        freq *= 2.1
    return total / norm_


def catmull(xs, ys, x):
    """A smooth curve through the points (xs ascending): Catmull-Rom with finite-difference ends."""
    x = min(max(x, xs[0]), xs[-1])
    i = max(0, min(len(xs) - 2, int(np.searchsorted(xs, x, side="right")) - 1))
    x0, x1 = xs[i], xs[i + 1]
    t = (x - x0) / (x1 - x0) if x1 != x0 else 0.0
    m0 = (ys[i + 1] - ys[i - 1]) / (xs[i + 1] - xs[i - 1]) * (x1 - x0) if i > 0 else (ys[i + 1] - ys[i])
    m1 = (ys[i + 2] - ys[i]) / (xs[i + 2] - xs[i]) * (x1 - x0) if i + 2 < len(xs) else (ys[i + 1] - ys[i])
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * m1


# ----------------------------------------------------------------------------------------------------------------- the colour of old bone
def bone_colour(q, k=0, seed=0.0, stain=1.0, lightness=1.0):
    """Ivory with a slow mottle, long streaks along the bone, cracks, sand stain near and below the ground, and a few patches of teal mineral.
    Everything varies over metres, not over a ring's spacing, so it never aliases into bands."""
    q = np.asarray(q, float)
    slow = fbm(q * 0.22, seed, 3)                   # -1..1 over metres
    fine = fbm(q * 1.4, seed + 11.0, 2)
    c = mix(BONE, BONE_LIGHT, min(max(0.5 + 0.9 * slow, 0.0), 1.0))
    c = shade(c, (0.92 + 0.08 * wave(k, q[1] * 0.03 + q[2] * 0.025, seed)) * (0.96 + 0.05 * fine))   # long streaks, slowly changing along the bone
    c = mix(c, BONE_SHADE, smoothstep(0.15, 0.7, -fbm(q * 0.5, seed + 2.0, 2)) * 0.5)               # darker, older patches
    crack = 1.0 - smoothstep(0.0, 0.07, abs(fbm(q * 0.8, seed + 9.0, 2)))                           # dark lines where a noise field crosses zero
    c = mix(c, CREVICE, crack * 0.30)
    buried = smoothstep(1.8, -0.6, q[1])
    c = mix(c, SAND_STAIN, buried * 0.8 * stain)
    c = shade(c, 1.0 - 0.34 * smoothstep(-0.2, -2.6, q[1]))       # down in the sand it is dark
    teal = smoothstep(0.30, 0.58, fbm(q * 0.3, seed + 5.0, 2) + 0.1 * fine)
    c = mix(c, TEAL, teal * 0.38)
    return np.clip(c * lightness, 0.0, 1.0)


# ----------------------------------------------------------------------------------------------------------------- tubes along curves
def sample_curve(fn, n):
    return [np.asarray(fn(i / (n - 1)), float) for i in range(n)]


def rot_x(points, degrees, about):
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    out = []
    for p in points:
        d = p - about
        out.append(about + np.array([d[0], d[1] * c - d[2] * s, d[1] * s + d[2] * c]))
    return out


def rot_y(points, degrees, about):
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    out = []
    for p in points:
        d = p - about
        out.append(about + np.array([d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c]))
    return out


def lumpy_ring(amount, seed, flutes=0, flute_amount=0.0):
    """A jitter that gives a bone a living outline: coherent lumps plus long flutes round the shaft."""
    def apply(ring, c, i):
        out = []
        K = len(ring)
        for k, q in enumerate(ring):
            th = math.tau * k / K
            m = 1.0 + amount * fbm(q * 0.9, seed, 2) + flute_amount * math.cos(flutes * th + i * 0.05)
            out.append(c + (q - c) * m)
        return np.array(out)
    return apply


# ----------------------------------------------------------------------------------------------------------------- ribs
RIB_STATIONS = 8           # spine stations; one is empty (its ribs are gone)
RIB_SPACING = 2.55


def rib_path(side, height, reach, widest, head, bottom, count):
    """A rib seen from the end of the animal: from the spine at the top (x = head, y = height) out and down to the widest point
    (x = reach), then curling in towards the breastbone far below the sand. Two quarter ellipses, smooth where they meet.
    The `count` points are spread evenly along the length (so every ring of the tube is the same distance from the next) and the
    second value says how far along the widest point is (0..1)."""
    dense = []
    for i in range(241):
        b = (math.pi / 2) * i / 240
        dense.append(np.array([side * (head + (reach - head) * math.sin(b)), widest + (height - widest) * math.cos(b), 0.0]))
    join = len(dense) - 1
    for i in range(1, 241):
        g = (math.pi / 2) * i / 240
        dense.append(np.array([side * (reach * 0.5 + reach * 0.5 * math.cos(g)), widest - (widest + bottom) * math.sin(g), 0.0]))
    seg = [float(np.linalg.norm(dense[i + 1] - dense[i])) for i in range(len(dense) - 1)]
    along = np.concatenate([[0.0], np.cumsum(seg)])
    pts = []
    for j in range(count):
        d = along[-1] * j / (count - 1)
        i = min(int(np.searchsorted(along, d, side="right")) - 1, len(dense) - 2)
        t = (d - along[i]) / max(along[i + 1] - along[i], 1e-9)
        pts.append(dense[i] + (dense[i + 1] - dense[i]) * t)
    return pts, along[join] / along[-1]


def build_ribs(S, lod, seed=3.0):
    L = LODS[lod]
    rng = np.random.default_rng(31)
    K = n_of(18, L["sides"], 4)
    per = n_of(38, L["rings"], 9)
    gap_station = 5                                    # no ribs here: they have fallen away
    snapped = {(1, 1): 0.62, (3, -1): 0.40, (6, 1): 0.55, (6, -1): 0.80}   # (station, side) -> fraction of the rib that is left
    heights, zs = [], []
    for i in range(RIB_STATIONS):
        z = (i - (RIB_STATIONS - 1) / 2) * RIB_SPACING
        # the middle of the chest is tallest, and the spine sags a little towards the tail
        h = 8.6 * (0.58 + 0.42 * math.sin(math.pi * (i + 0.5) / RIB_STATIONS)) - 0.12 * i
        heights.append(h)
        zs.append(z)
    spine_y = [h + 0.1 for h in heights]
    # ---- ribs
    for i in range(RIB_STATIONS):
        if i == gap_station:
            continue
        for side in (1, -1):
            h = heights[i] + rng.uniform(-0.25, 0.25)
            reach = 3.9 * (0.82 + 0.18 * math.sin(math.pi * (i + 0.6) / RIB_STATIONS)) + rng.uniform(-0.2, 0.2)
            widest = 0.57 * h
            full, s_join = rib_path(side, h, reach, widest, 0.95, 2.4, per)
            keep = snapped.get((i, side), 1.0)
            cut = max(5, int(len(full) * keep))
            path = full[:cut]
            lean = rng.uniform(-5, 5) + (3.0 if i > gap_station else 0.0)
            path = rot_x(path, lean, np.array([0.0, h, 0.0]))
            z_off = zs[i] + rng.uniform(-0.12, 0.12)                                   # one nudge for the whole rib (a nudge per ring made ledges)
            path = [p + np.array([0.0, 0.0, z_off]) for p in path]
            m = len(path)
            radii = []
            for j in range(m):
                s = j / (len(full) - 1)
                swell = 0.40 + 0.09 * math.sin(math.pi * min(1.0, s / (1.8 * s_join)))   # thickest around the shoulder
                head_knob = 0.24 * math.exp(-(s / 0.04) ** 2)                  # the rounded head where it meets the spine
                taper = 1.0 - 0.42 * smoothstep(s_join, 1.0, s)                # thinning as it curls under
                a = (swell + head_knob) * taper                                # across the curve: a flat blade of bone...
                radii.append((a * 0.82, a * 1.45))                             # ...wider along the animal than it is thick
            if keep < 1.0:                                                      # a snapped end: jagged and uneven
                radii[-1] = (radii[-1][0] * 0.82, radii[-1][1] * 0.82)
                radii[-2] = (radii[-2][0] * 1.02, radii[-2][1] * 1.02)
            jit = lumpy_ring(0.12, seed + i * 1.7 + (0.5 if side > 0 else 0.0), flutes=2, flute_amount=0.07)
            sd = seed + i * 3.1 + side
            tube(S, path, radii, K, (0, 0, 1), lambda q, ii, k, sd=sd: bone_colour(q, k, sd), p=2.4, phase=0.4 * i, jitter=jit)
    # ---- spine: two runs of beaded vertebrae (the middle has come apart), neural spines and the little arms the ribs hang from
    runs = [(0, gap_station - 1), (gap_station + 1, RIB_STATIONS - 1)]
    for (a, b) in runs:
        z0, z1 = zs[a] - 1.1, zs[b] + 1.1
        n = n_of(14 * (b - a + 1), L["rings"], 6)
        ps = []
        for j in range(n):
            z = lerp(z0, z1, j / (n - 1))
            ys = np.interp(z, zs, spine_y)
            ps.append(np.array([0.0, ys, z]))
        radii = []
        for p in ps:
            bump = max(math.exp(-((p[2] - z_s) / 0.78) ** 2) for z_s in zs[a:b + 1])
            r = 0.40 + 0.43 * bump
            radii.append((r * 0.95, r))
        sd = seed + 40 + a
        tube(S, ps, radii, n_of(12, L["sides"], 4), (1, 0, 0), lambda q, ii, k, sd=sd: bone_colour(q, k, sd), p=2.3, jitter=lumpy_ring(0.06, sd))
    for i in range(RIB_STATIONS):
        z = zs[i]
        y = spine_y[i]
        lean = rng.uniform(-0.5, 0.5)
        tip = y + 2.5 + rng.uniform(-0.4, 0.8)
        if i in (2, 6):
            tip = y + 1.1                                     # snapped
        path = [np.array([0.0, y + 0.3, z - 0.1]), np.array([0.0, lerp(y + 0.3, tip, 0.5), z + 0.2 * lean]), np.array([0.0, tip, z + 0.55 * lean - 0.25])]
        path = sample_curve(lambda t: (np.array([0.0, lerp(y + 0.3, tip, t), z + lean * t * t * 0.8 - 0.12 * t])), n_of(8, L["rings"], 3))
        radii = [(0.12 * (1 - 0.82 * j / (len(path) - 1)) + 0.02, 0.50 * (1 - 0.78 * (j / (len(path) - 1)) ** 0.8) + 0.03) for j in range(len(path))]
        sd = seed + 60 + i
        tube(S, path, radii, n_of(6, L["sides"], 3), (1, 0, 0), lambda q, ii, k, sd=sd: bone_colour(q, k, sd), p=2.4)
        if i != gap_station:
            for side in (1, -1):                               # the arm each rib hangs from
                arm = sample_curve(lambda t: (np.array([side * lerp(0.2, 1.0, t), y - 0.05 - 0.1 * t, z])), n_of(4, L["rings"], 2))
                tube(S, arm, [(0.20 - 0.04 * j / max(1, len(arm) - 1), 0.28) for j in range(len(arm))], n_of(6, L["sides"], 3), (0, 0, 1),
                     lambda q, ii, k, sd=sd: bone_colour(q, k, sd + 1), p=2.2)
    # ---- the fallen rib, lying half sunk in the sand beside the ribcage, and a few broken pieces
    def fallen(ctr_x, ctr_z, yaw, length, curl, radius, sd, sink=0.08):
        n = n_of(26, L["rings"], 6)
        pts = []
        for j in range(n):
            t = j / (n - 1)
            x = (t - 0.5) * length
            zc = curl * (math.sin(t * math.pi) - 0.0) * length * 0.18
            y = radius * sink * 0 + 0.22 + 0.16 * math.sin(t * math.pi) - 0.25 * (1 - t) ** 2
            pts.append(np.array([x, y, zc]))
        pts = rot_y(pts, yaw, np.array([0.0, 0.0, 0.0]))
        pts = [p + np.array([ctr_x, 0.0, ctr_z]) for p in pts]
        radii = []
        for j in range(n):
            t = j / (n - 1)
            r = radius * (1.0 - 0.52 * t ** 0.8) * (1.0 + 0.55 * math.exp(-(t / 0.07) ** 2))      # a knobbed head, thinning to the break
            if j == n - 1:
                r *= 0.8
            radii.append((r * 0.85, r * 1.45))
        tube(S, pts, radii, n_of(12, L["sides"], 4), (0, 1, 0), lambda q, ii, k, sd=sd: bone_colour(q, k, sd), p=2.7, jitter=lumpy_ring(0.12, sd, 2, 0.07))
    fallen(10.5, -1.5, 18, 12.0, 0.9, 0.52, seed + 80)
    fallen(8.0, 8.5, -35, 4.6, -0.6, 0.38, seed + 81)
    fallen(-8.2, -6.0, 70, 3.4, 0.5, 0.30, seed + 82)

    def vertebra(cx, cz, yaw, scale, sd, sink=0.35):
        """A loose vertebra lying in the sand: a spool-shaped body, a blade of a spine and two wings."""
        n = n_of(9, L["rings"], 4)
        body = [np.array([0.0, 0.0, (j / (n - 1) - 0.5) * 1.5]) for j in range(n)]
        radii = [((0.60 + 0.34 * (2 * abs(j / (n - 1) - 0.5)) ** 1.6) * 0.95, 0.60 + 0.34 * (2 * abs(j / (n - 1) - 0.5)) ** 1.6) for j in range(n)]
        parts = [(body, radii, (1, 0, 0))]
        parts.append(([np.array([0.0, 0.3, 0.0]), np.array([0.05, 1.0, -0.1]), np.array([0.1, 1.9, -0.3])], [(0.12, 0.38), (0.1, 0.3), (0.03, 0.05)], (1, 0, 0)))
        for side in (1, -1):
            parts.append(([np.array([side * 0.3, 0.05, 0.0]), np.array([side * 1.0, 0.1, 0.05]), np.array([side * 1.7, 0.0, 0.3])], [(0.22, 0.3), (0.17, 0.26), (0.05, 0.1)], (0, 0, 1)))
        for path, rr, hint in parts:
            pts = rot_y([p * scale for p in path], yaw, np.array([0.0, 0.0, 0.0]))
            pts = [p + np.array([cx, 0.55 * scale - sink * scale + 0.0, cz]) for p in pts]
            tube(S, pts, [(a * scale, b * scale) for a, b in rr], n_of(10, L["sides"], 4), hint, lambda q, ii, k, sd=sd: bone_colour(q, k, sd), p=2.3, jitter=lumpy_ring(0.1, sd))
    vertebra(-5.8, 8.6, 25, 1.0, seed + 90)
    vertebra(13.8, 5.2, -60, 0.8, seed + 91)
    vertebra(-3.5, -9.8, 110, 0.9, seed + 92, sink=0.6)


# ----------------------------------------------------------------------------------------------------------------- skull
# stations along the length: z, half width, half height, centre height
SKULL_ST = [
    (6.0, 0.30, 0.26, 0.00),
    (5.4, 0.55, 0.45, 0.05),
    (4.2, 0.92, 0.72, 0.12),
    (2.8, 1.22, 0.98, 0.22),
    (1.2, 1.62, 1.32, 0.34),
    (-0.4, 2.05, 1.68, 0.46),
    (-2.0, 2.35, 1.90, 0.56),
    (-3.5, 2.12, 1.80, 0.62),
    (-4.7, 1.42, 1.28, 0.55),
    (-5.2, 0.60, 0.70, 0.50),
]
SKULL_Z = [s[0] for s in reversed(SKULL_ST)]
SKULL_W = [s[1] for s in reversed(SKULL_ST)]
SKULL_H = [s[2] for s in reversed(SKULL_ST)]
SKULL_C = [s[3] for s in reversed(SKULL_ST)]


def skull_extent(z):
    return catmull(SKULL_Z, SKULL_W, z), catmull(SKULL_Z, SKULL_H, z), catmull(SKULL_Z, SKULL_C, z)


def skull_surface(z, theta, p=2.5):
    """A point on the skin of the cranium and snout at length z, angle theta round it (0 = the left side, pi/2 = the top)."""
    w, h, c = skull_extent(z)
    ct, st = math.cos(theta), math.sin(theta)
    x = w * math.copysign(abs(ct) ** (2.0 / p), ct)
    y_unit = math.copysign(abs(st) ** (2.0 / p), st)
    y = c + (h * y_unit if y_unit > 0 else h * 0.62 * y_unit)       # flatter underneath: the palate
    return np.array([x, y, z])


def skull_features(pt):
    """Eye sockets, brows, nostrils, cheek ridges, the openings in the roof of the skull and a roughness: moves the skin point.
    Returns (point, how dark)."""
    x, y, z = pt
    s = math.copysign(1.0, x) if abs(x) > 1e-6 else 1.0
    ax = abs(x)
    dark = 0.0
    # eye socket: deep, set on the side of the cranium, looking out and forward
    ey, ez = 0.95, -0.55
    m_eye = math.exp(-(((z - ez) / 0.92) ** 2 + ((y - ey) / 0.80) ** 2)) * smoothstep(0.7, 1.4, ax)
    ax -= 0.92 * smoothstep(0.08, 0.5, m_eye)
    dark = max(dark, smoothstep(0.22, 0.7, m_eye))
    # the brow over it, and a ridge down the cheek
    m_brow = math.exp(-(((z - ez - 0.1) / 1.30) ** 2 + ((y - ey - 1.0) / 0.26) ** 2))
    ax += 0.34 * m_brow * smoothstep(0.7, 1.4, ax)
    y += 0.10 * m_brow
    m_cheek = math.exp(-((y - (ey - 0.92)) / 0.20) ** 2) * smoothstep(-3.0, -1.0, z) * (1 - smoothstep(1.8, 3.6, z))
    ax += 0.19 * m_cheek * smoothstep(0.7, 1.4, ax)
    # nostrils: two pits on the top of the snout
    m_nose = math.exp(-(((ax - 0.42) / 0.20) ** 2 + ((z - 4.25) / 0.38) ** 2)) * smoothstep(0.3, 0.55, y)
    y -= 0.48 * smoothstep(0.1, 0.6, m_nose)
    dark = max(dark, smoothstep(0.30, 0.75, m_nose))
    # the two openings in the roof of the skull behind the eyes
    m_roof = math.exp(-(((ax - 1.12) / 0.46) ** 2 + ((z + 2.95) / 0.72) ** 2)) * smoothstep(1.2, 1.9, y)
    y -= 0.75 * smoothstep(0.1, 0.6, m_roof)
    dark = max(dark, smoothstep(0.28, 0.7, m_roof))
    # a lumpy, weathered skin
    rough = fbm(np.array([x, y, z]) * 0.8, 17.0, 3)
    ax += 0.05 * rough
    y += 0.05 * rough
    return np.array([s * ax, y, z]), dark


JAW_HINGE = np.array([0.0, -1.15, -2.65])      # the line the mouth opens about (along x)
JAW_OPEN = 0.46                                 # radians the upper skull is tipped up off the lower jaw


def nose_up(S, start, angle=JAW_OPEN, pivot=JAW_HINGE):
    """Tip every vertex made since `start` up about the jaw hinge: the skull is built shut and then opened."""
    c, sn = math.cos(angle), math.sin(angle)
    for i in range(start, len(S.V)):
        p = S.V[i]
        dy, dz = p[1] - pivot[1], p[2] - pivot[2]
        S.V[i] = np.array([p[0], pivot[1] + dy * c + dz * sn, pivot[2] - dy * sn + dz * c])


def build_skull(S, lod, seed=7.0):
    L = LODS[lod]
    K = n_of(56, L["sides"], 8)
    ns = n_of(84, L["stations"], 10)
    zs = np.linspace(SKULL_Z[-1], SKULL_Z[0], ns)
    first = len(S.V)
    LIFT = np.array([0.0, 2.2, 0.0])
    # ---- cranium and snout, one loft with the features pushed into the skin
    rings, cols = [], []
    for z in zs:
        ring, col = [], []
        for k in range(K):
            th = math.tau * k / K
            pt, dark = skull_features(skull_surface(z, th))
            base = bone_colour(pt + LIFT, k, seed, stain=0.9)
            col.append(mix(base, SOCKET, dark))
            ring.append(pt)
        rings.append(ring)
        cols.append(col)
    S.shell(rings, cols, mat=0, part=0)
    # ---- sagittal crest: a thin plate standing on the top of the cranium
    n = n_of(18, L["rings"], 5)
    crest = []
    for j in range(n):
        t = j / (n - 1)
        z = lerp(-0.6, -4.9, t)
        w, h, c = skull_extent(z)
        crest.append(np.array([0.0, c + h * 0.92 + 0.62 * math.sin(math.pi * t) ** 0.8, z]))
    radii = [(0.10 + 0.04 * math.sin(math.pi * j / (n - 1)), 0.20 + 0.34 * math.sin(math.pi * (j / (n - 1))) ** 0.7) for j in range(n)]
    tube(S, crest, radii, n_of(8, L["sides"], 4), (1, 0, 0), lambda q, i, k: bone_colour(q + LIFT, k, seed + 3), p=2.2)
    # ---- horns: two heavy ridged horns sweeping out, back and up from the back of the skull, curling at the tips
    for side in (1, -1):
        n = n_of(40, L["rings"], 8)
        pts = []
        for j in range(n):
            t = j / (n - 1)
            x = side * (1.60 + 2.9 * t - 0.9 * t * t)
            y = 1.55 + 4.6 * t + 1.3 * t ** 3
            z = -3.55 - 3.9 * t + 0.4 * t * t - 1.1 * t ** 3
            pts.append(np.array([x, y, z]))
        radii = []
        for j in range(n):
            t = j / (n - 1)
            r = 0.78 * (1 - t) ** 0.9 + 0.035
            ridge = 1.0 + 0.08 * math.sin(t * 44) * (1 - t)
            radii.append((r * ridge, r * 0.80 * ridge))
        tube(S, pts, radii, n_of(14, L["sides"], 4), (0, 0, 1), lambda q, i, k, sd=seed + 9 + side: bone_colour(q + LIFT, k, sd, stain=0.2),
             p=2.4, jitter=lumpy_ring(0.07, seed + side, 5, 0.06))
    # ---- spikes: three on each brow and one down from each cheek, pointing back
    def spike(base, tip, r0, sd, bend=(0.0, 0.0, 0.0)):
        steps = n_of(6, L["rings"], 3)
        path = []
        radii = []
        mid = (base + tip) / 2 + np.asarray(bend)
        for j in range(steps):
            t = j / (steps - 1)
            path.append((1 - t) ** 2 * base + 2 * (1 - t) * t * mid + t * t * tip)
            r = r0 * (1 - t) ** 0.9 + 0.012
            radii.append((r, r * 0.85))
        tube(S, path, radii, n_of(8, L["sides"], 3), (0, 0, 1), lambda q, i, k: bone_colour(q + LIFT, k, sd, stain=0.2), p=2.3)
    for side in (1, -1):
        for j, (bz, bl) in enumerate([(0.55, 1.5), (-0.4, 1.9), (-1.35, 1.6)]):
            w, h, c = skull_extent(bz)
            spike(np.array([side * (w * 0.78), c + h * 0.62, bz]), np.array([side * (w * 0.78 + 0.35), c + h * 0.62 + bl, bz - 0.9]), 0.30, seed + 50 + j + side)
        spike(np.array([side * 2.1, -0.45, -2.2]), np.array([side * 3.0, -1.5, -4.6]), 0.42, seed + 56 + side, bend=(side * 0.4, -0.2, -0.3))
    # ---- teeth in the upper jaw: big at the front, smaller towards the cheek
    def tooth(base, length, radius, lean, sd, root=0.6, down=-1.0):
        steps = n_of(5, L["rings"], 3)
        path = []
        radii = []
        for j in range(steps):
            t = j / (steps - 1)
            path.append(base + np.array([0.0, down * length * t, lean * length * t * t]))
            r = radius * (1 - t) ** 0.7 + 0.01
            radii.append((r, r))
        tube(S, path, radii, n_of(7, L["sides"], 3), (1, 0, 0),
             lambda q, i, k: mix(TOOTH_ROOT, ENAMEL, smoothstep(0.0, root, i / (len(path) - 1))), p=2.0)
    nt = n_of(10, L["teeth"], 3)
    rng = np.random.default_rng(5)
    for side in (1, -1):
        for j in range(nt):
            t = j / (nt - 1)
            z = lerp(5.1, -0.9, t) + rng.uniform(-0.12, 0.12)
            w, h, c = skull_extent(z)
            x = side * w * 0.80
            y = c - h * 0.62 * 0.85 + 0.12
            big = 1.0 if j in (1, 2) else 0.62 + 0.38 * (1 - t)
            if (side, j) in ((1, 5), (-1, 3)):
                continue                                          # lost
            broken = 0.45 if (side, j) in ((1, 2), (-1, 6)) else 1.0
            tooth(np.array([x, y, z]), (0.55 + 0.75 * big) * broken * rng.uniform(0.85, 1.12), 0.17 + 0.07 * big, -0.5 + rng.uniform(-0.2, 0.2), seed + j)
    # ---- the braces behind the eyes (the bone that joins the cheek to the jaw hinge)
    for side in (1, -1):
        n = n_of(12, L["rings"], 4)
        pts = [np.array([side * lerp(2.05, 1.95, j / (n - 1)), lerp(0.1, -1.0, (j / (n - 1)) ** 1.3), lerp(-1.6, -2.65, j / (n - 1))]) for j in range(n)]
        radii = [(0.34, 0.5 * (1 - 0.15 * j / (n - 1))) for j in range(n)]
        tube(S, pts, radii, n_of(8, L["sides"], 4), (1, 0, 0), lambda q, i, k: bone_colour(q + LIFT, k, seed + 40), p=2.3)
    # ---- everything so far is the upper skull: tip it up off the jaw, which stays lying flat
    nose_up(S, first)
    # ---- the lower jaw: two long rami lying on the sand, a bar across the chin, and teeth pointing up
    for side in (1, -1):
        n = n_of(30, L["rings"], 6)
        pts, radii = [], []
        hinge = np.array([side * 1.95, JAW_HINGE[1], JAW_HINGE[2]])
        for j in range(n):
            t = j / (n - 1)
            reach = 7.35 * t                                # length of the jaw
            p = hinge + np.array([-side * 1.18 * t ** 0.9, 0.34 * math.sin(t * math.pi) - 0.12 * t, reach])
            pts.append(p)
            hh = 0.70 * (1 - 0.55 * t) + 0.40 * math.exp(-(t / 0.12) ** 2)       # tall at the hinge (the coronoid), slim at the chin
            ww = 0.48 * (1 - 0.35 * t)
            radii.append((ww, hh))
        sd = seed + 20 + side
        tube(S, pts, radii, n_of(14, L["sides"], 4), (1, 0, 0), lambda q, i, k, sd=sd: bone_colour(q + LIFT, k, sd, stain=0.5), p=2.4,
             jitter=lumpy_ring(0.06, sd))
        nl = n_of(8, L["teeth"], 3)
        for j in range(nl):
            if (side, j) in ((1, 2), (-1, 5)):
                continue                                          # lost
            t = lerp(0.18, 0.96, j / (nl - 1))
            idx = min(len(pts) - 1, int(t * (len(pts) - 1)))
            p = pts[idx]
            hh = radii[idx][1]
            big = 0.5 + 0.5 * math.sin(math.pi * (j + 0.6) / (nl + 0.2))
            tooth(p + np.array([-side * 0.05, hh * 0.78, 0.0]), (0.35 + 0.5 * big) * rng.uniform(0.8, 1.15), 0.14 + 0.05 * big, 0.45 + rng.uniform(-0.2, 0.2), seed + 30 + j + side, down=1.0)
    tip = pts[-1]
    bar = [np.array([-1.2, tip[1] - 0.05, tip[2] - 0.15]), np.array([-0.4, tip[1] - 0.1, tip[2] + 0.1]), np.array([0.4, tip[1] - 0.1, tip[2] + 0.1]), np.array([1.2, tip[1] - 0.05, tip[2] - 0.15])]
    tube(S, bar, [(0.36, 0.40), (0.38, 0.42), (0.38, 0.42), (0.36, 0.40)], n_of(10, L["sides"], 4), (0, 1, 0), lambda q, i, k: bone_colour(q + LIFT, k, seed + 33, stain=0.5), p=2.3)
    # ---- sit the jaw on the sand: its underside is y = 0
    low = min(v[1] for v in S.V[first:])
    jaw_low = min(v[1] for v in S.V[-300:])
    for i in range(first, len(S.V)):
        S.V[i] = S.V[i] + np.array([0.0, 1.78, 0.0])


# ----------------------------------------------------------------------------------------------------------------- main
def build(model, lod, outdir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    S = Shape()
    {"ribs": build_ribs, "skull": build_skull}[model](S, lod)
    mat, glow = make_materials("Bone", base_roughness=0.93)
    name = {"ribs": "GiantRibs", "skull": "GiantSkull"}[model]
    ob, _ = make_object(S, 0, name, [mat])
    smooth_by_angle(ob, 52)
    lows = np.min(np.asarray(S.V), axis=0)
    highs = np.max(np.asarray(S.V), axis=0)
    path = os.path.join(outdir, f"giant_{model}_lod{lod}.glb")
    print(f"{model} lod{lod}: tris {S.tris()} shells {S.shells} verts {len(S.V)} "
          f"x[{lows[0]:.2f},{highs[0]:.2f}] y[{lows[1]:.2f},{highs[1]:.2f}] z[{lows[2]:.2f},{highs[2]:.2f}]")
    export_glb(path)


def main():
    outdir = opt("--outdir", "public/models/bones")
    which = opt("--model", "both")
    lods = [0, 1, 2] if opt("--lod", "all") == "all" else [int(opt("--lod", "0"))]
    for model in (["ribs", "skull"] if which == "both" else [which]):
        for lod in lods:
            build(model, lod, outdir)


if __name__ == "__main__":
    main()
