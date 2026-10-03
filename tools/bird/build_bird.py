"""Alien bird: a rigged, skinned low-poly model in three levels of detail, built headless in Blender (bpy module).

    python3 tools/bird/build_bird.py --out-dir public/models/creatures [--lod 0|1|2]

Writes alien_bird_lod0.glb, alien_bird_lod1.glb and alien_bird_lod2.glb. All three share one skeleton (same bone
names and joint positions), so the game poses whichever level is showing with the same code.

Look: a heron-sized glider (about 0.75 m standing, 1.5 m across the wings) in the oasis colours: indigo back, cream
belly, teal wings that fade to glowing cyan finger-feathers, a coral crest of three blades, an amber beak and two
long tail streamers ending in glowing rackets.

Frame: the model is built directly in glTF axes (exported with "Y up" off, so nothing is converted): the bird faces +Z,
up is +Y and its left side is +X. The helper V(side, fwd, up) writes points the way a person would describe the bird.
Units are metres, the origin is the middle of the body at hip height; the feet are about 0.34 m below it.

Skeleton (every bone has an identity rest rotation, so rotating a bone in the game is a rotation about the world
axes of the standing bird):
    Root > Body > Neck1 > Neck2 > Head > Crest
                > WingIn_L > WingOut_L        (and _R)
                > Tail > Streamer_L > StreamerTip_L   (and _R)
         > Leg_L > Foot_L                     (and _R)
The wings are built spread out (the bind pose); the game folds them. Two materials: Bird (vertex colours) and Glow
(constant cyan emission: eyes, wing-tip dots, the rackets on the tail streamers).
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


OUT_DIR = opt("--out-dir", "public/models/creatures")
ONLY_LOD = int(opt("--lod", "-1"))


# ----------------------------------------------------------------------------- small helpers
def V(side, fwd, up):
    """A point described from the bird's point of view, in the model's axes (x = its left, y = up, z = forward)."""
    return np.array([side, up, fwd], float)


UP = np.array([0.0, 1.0, 0.0])


def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def srgb(h):
    """0xRRGGBB as the linear colour the glTF exporter expects for vertex colours."""
    return tuple(((h >> s & 255) / 255.0) ** 2.2 for s in (16, 8, 0))


def mix(c0, c1, t):
    t = min(max(t, 0.0), 1.0)
    return tuple(lerp(a, b, t) for a, b in zip(c0, c1))


def catmull_rom(points, n):
    """n samples along a smooth curve through the rows of `points` (uniform Catmull-Rom)."""
    P = np.asarray(points, float)
    m = len(P)
    if n <= m and n == 2:
        return np.array([P[0], P[-1]])
    out = []
    for t in np.linspace(0, m - 1, n):
        i = min(int(math.floor(t)), m - 2)
        u = t - i
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, m - 1)]
        out.append(0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


# Palette (sRGB hex, converted to linear above).
BACK = srgb(0x232A6B)       # indigo
SHOULDER = srgb(0x3A4AA8)   # lighter blue-violet
TEAL = srgb(0x0B8794)
DEEP_TEAL = srgb(0x0A4F66)
CYAN = srgb(0x4DF2FF)
BELLY = srgb(0xF1EAD6)
MINT = srgb(0xCDE6D8)
CORAL = srgb(0xFF6B3A)
YELLOW = srgb(0xFFC43D)
AMBER = srgb(0xF0A640)
BEAK_TIP = srgb(0x7A3B17)
LEG = srgb(0xD8664D)
TOE = srgb(0x7A3028)
EYE = srgb(0xFFD24A)

BONES = [  # name, parent, joint position (bird frame: side, fwd, up)
    ("Root", None, V(0, 0, 0)),
    ("Body", "Root", V(0, 0, 0)),
    ("Neck1", "Body", V(0, 0.165, 0.060)),
    ("Neck2", "Neck1", V(0, 0.245, 0.225)),
    ("Head", "Neck2", V(0, 0.285, 0.335)),
    ("Crest", "Head", V(0, 0.285, 0.385)),
    ("WingIn_L", "Body", V(0.060, 0.060, 0.055)),
    ("WingOut_L", "WingIn_L", V(0.340, 0.035, 0.062)),
    ("WingIn_R", "Body", V(-0.060, 0.060, 0.055)),
    ("WingOut_R", "WingIn_R", V(-0.340, 0.035, 0.062)),
    ("Tail", "Body", V(0, -0.255, 0.015)),
    ("Streamer_L", "Tail", V(0.020, -0.270, 0.012)),
    ("StreamerTip_L", "Streamer_L", V(0.045, -0.560, -0.010)),
    ("Streamer_R", "Tail", V(-0.020, -0.270, 0.012)),
    ("StreamerTip_R", "Streamer_R", V(-0.045, -0.560, -0.010)),
    ("Leg_L", "Root", V(0.050, 0.010, -0.075)),
    ("Foot_L", "Leg_L", V(0.050, -0.005, -0.335)),
    ("Leg_R", "Root", V(-0.050, 0.010, -0.075)),
    ("Foot_R", "Leg_R", V(-0.050, -0.005, -0.335)),
]
BONE_NAMES = [b[0] for b in BONES]


# ----------------------------------------------------------------------------- solid shells
class Shape:
    """Every solid shell of the bird, with a colour and bone weights on each vertex."""

    def __init__(self):
        self.V, self.C, self.W, self.F, self.M = [], [], [], [], []
        self.shells = 0

    def tris(self):
        return sum(len(f) - 2 for f in self.F)

    def tris_by_material(self):
        out = {}
        for f, m in zip(self.F, self.M):
            out[m] = out.get(m, 0) + len(f) - 2
        return out

    def shell(self, rings, colours, weights, mat=0):
        """A closed tube through `rings` (a list of equal-length rings of 3D points), capped at both ends.
        colours[i][k] and weights[i][k] (a {bone: weight} dict) describe each ring vertex. Faces are wound
        outward whatever order the rings came in."""
        base = len(self.V)
        K = len(rings[0])
        faces = []
        for ring, cols, ws in zip(rings, colours, weights):
            for p, c, w in zip(ring, cols, ws):
                self.V.append(np.asarray(p, float))
                self.C.append(c)
                self.W.append(w)
        n = len(rings)
        for i in range(n - 1):
            for k in range(K):
                k2 = (k + 1) % K
                faces.append((base + i * K + k, base + i * K + k2, base + (i + 1) * K + k2, base + (i + 1) * K + k))
        for end in (0, n - 1):
            ring = rings[end]
            centre = np.mean(ring, axis=0)
            self.V.append(centre)
            self.C.append(tuple(np.mean(np.asarray(colours[end], float), axis=0)))
            self.W.append(weights[end][0])
            ci = len(self.V) - 1
            for k in range(K):
                k2 = (k + 1) % K
                faces.append((ci, base + end * K + k, base + end * K + k2))
        # Signed volume of the shell: negative means the faces point inward, so flip them all.
        volume = 0.0
        for f in faces:
            p = [self.V[i] for i in f]
            for j in range(1, len(p) - 1):
                volume += np.dot(p[0], np.cross(p[j], p[j + 1])) / 6.0
        if volume < 0:
            faces = [tuple(reversed(f)) for f in faces]
        self.F.extend(faces)
        self.M.extend([mat] * len(faces))
        self.shells += 1


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


def ring_points(c, right, up, rx, ry, K, phase=0.0):
    """K points on an ellipse around c. Angle 0 is `right`, 90 degrees is `up`."""
    return np.array([c + right * math.cos(phase + math.tau * k / K) * rx + up * math.sin(phase + math.tau * k / K) * ry for k in range(K)])


def ring_angles(K, phase=0.0):
    return [phase + math.tau * k / K for k in range(K)]


def tube(shape, path, radii, K, hint, colour, weight, mat=0, phase=0.0):
    """A tapering tube along `path`. radii[i] = (half width along `right`, half height along `up`).
    colour(i, k, angle) -> rgb; weight(i, k) -> {bone: weight}."""
    path = [np.asarray(p, float) for p in path]
    fr = frames_along(path, np.asarray(hint, float))
    rings, cols, ws = [], [], []
    for i, (c, (right, up)) in enumerate(zip(path, fr)):
        rx, ry = radii[i]
        rings.append(ring_points(c, right, up, max(rx, 0.0015), max(ry, 0.0015), K, phase))
        cols.append([colour(i, k, a) for k, a in enumerate(ring_angles(K, phase))])
        ws.append([weight(i, k) for k in range(K)])
    shape.shell(rings, cols, ws, mat)


def one(bone):
    return lambda i, k=0: {bone: 1.0}


def blend(b0, b1, t):
    t = min(max(t, 0.0), 1.0)
    t = t * t * (3 - 2 * t)
    return {b0: 1.0 - t, b1: t} if 0.0 < t < 1.0 else ({b1: 1.0} if t >= 1.0 else {b0: 1.0})


def top_bottom(top, bottom, soft=0.35, lo=-0.25):
    """Colour by which side of a tube a vertex is on: `top` above, `bottom` below, blended around the sides."""
    return lambda i, k, a: mix(bottom, top, smoothstep(lo, lo + soft, math.sin(a)))


def resample_stations(stations, n):
    """Resample a list of tuples (the columns are numbers) to n rows along a smooth curve."""
    return catmull_rom(stations, n)


# ----------------------------------------------------------------------------- level of detail
LODS = [
    dict(name="lod0", body=(11, 10), neck=(7, 8), head=(6, 8), beak=(4, 6), eye=(3, 6), crest=(4, 4), crest_blades=3,
         panel=(4, 6), fingers=5, finger=(4, 6), dots=(2, 5), leg=(6, 6), toe=(2, 4), toes=3, hind_toe=True,
         fan=(4, 6), fan_feathers=5, streamer=(8, 4), racket=(4, 6), glow=True),
    dict(name="lod1", body=(7, 8), neck=(5, 6), head=(5, 6), beak=(3, 4), eye=None, crest=(3, 4), crest_blades=3,
         panel=(3, 4), fingers=4, finger=(3, 4), dots=None, leg=(4, 4), toe=None, toes=0, hind_toe=False,
         fan=(3, 4), fan_feathers=3, streamer=(5, 4), racket=(3, 4), glow=True),
    dict(name="lod2", body=(4, 5), neck=(2, 4), head=(2, 4), beak=(2, 3), eye=None, crest=(2, 3), crest_blades=1,
         panel=(2, 3), fingers=3, finger=(2, 3), dots=None, leg=(2, 3), toe=None, toes=0, hind_toe=False,
         fan=(2, 3), fan_feathers=1, streamer=(2, 3), racket=(2, 3), glow=False),
]


# ----------------------------------------------------------------------------- the parts
def build_body(S, L):
    stations = [  # fwd, up, half width, half height
        (0.215, 0.030, 0.012, 0.014), (0.185, 0.025, 0.045, 0.055), (0.130, 0.010, 0.080, 0.088), (0.050, -0.002, 0.095, 0.098),
        (-0.040, -0.010, 0.090, 0.090), (-0.130, -0.005, 0.068, 0.066), (-0.210, 0.008, 0.038, 0.038), (-0.265, 0.014, 0.014, 0.016),
    ]
    n, K = L["body"]
    st = resample_stations(stations, n)
    path = [V(0, f, u) for f, u, _, _ in st]
    radii = [(w, h) for _, _, w, h in st]
    length = len(st) - 1

    def colour(i, k, a):
        t = i / length  # 0 at the breast, 1 at the rump
        back = mix(SHOULDER, BACK, smoothstep(0.15, 0.7, t))
        belly = mix(MINT, BELLY, smoothstep(0.1, 0.5, t))
        edge = lerp(0.45, -0.25, smoothstep(0.0, 0.55, t))  # the cream reaches high on the breast and low at the rump
        return mix(belly, back, smoothstep(edge - 0.3, edge + 0.2, math.sin(a)))

    tube(S, path, radii, K, V(0, 0, 1), colour, lambda i, k: {"Body": 1.0})


def build_neck_and_head(S, L):
    neck_pts = [(0.165, 0.060), (0.195, 0.115), (0.230, 0.170), (0.245, 0.225), (0.262, 0.280), (0.285, 0.335)]
    neck_r = [0.054, 0.045, 0.036, 0.031, 0.028, 0.027]
    n, K = L["neck"]
    pts = resample_stations([(f, u, r) for (f, u), r in zip(neck_pts, neck_r)], n)
    path = [V(0, f, u) for f, u, _ in pts]
    radii = [(r, r) for _, _, r in pts]
    last = len(pts) - 1
    j2 = 0.62  # where Neck2 takes over (the joint at fwd 0.245 sits about 60% up the curve)

    def weight(i, k):
        t = i / last
        if t < j2:
            return blend("Neck1", "Neck2", t / j2)
        return blend("Neck2", "Head", (t - j2) / (1 - j2))

    def colour(i, k, a):
        t = i / last
        base = mix(MINT, BELLY, 0.5)
        nape = mix(BACK, SHOULDER, 0.5 * t)
        c = mix(base, nape, smoothstep(-0.1, 0.5, math.sin(a)))
        return mix(c, TEAL, 0.55 * smoothstep(0.75, 1.0, t))  # a teal collar under the head

    tube(S, path, radii, K, V(0, 0, 1), colour, weight)

    # head
    hn, hK = L["head"]
    hs = resample_stations([(0.268, 0.358, 0.018), (0.285, 0.366, 0.034), (0.305, 0.368, 0.039), (0.325, 0.364, 0.032), (0.345, 0.356, 0.016)], hn)
    hpath = [V(0, f, u) for f, u, _ in hs]
    hrad = [(r, r) for _, _, r in hs]
    tube(S, hpath, hrad, hK, V(0, 0, 1), lambda i, k, a: mix(mix(MINT, BELLY, 0.4), mix(BACK, TEAL, 0.35), smoothstep(-0.1, 0.5, math.sin(a))),
         lambda i, k: {"Head": 1.0})

    # beak: a slightly down-curved cone, amber with a dark tip
    bn, bK = L["beak"]
    bs = resample_stations([(0.335, 0.360, 0.018, 0.016), (0.380, 0.352, 0.0135, 0.012), (0.430, 0.338, 0.0075, 0.0068), (0.470, 0.322, 0.0045, 0.004), (0.505, 0.305, 0.0025, 0.0022)], bn)
    bpath = [V(0, f, u) for f, u, _, _ in bs]
    brad = [(w, h) for _, _, w, h in bs]
    blast = len(bs) - 1
    tube(S, bpath, brad, bK, V(0, 0, 1), lambda i, k, a: mix(AMBER, BEAK_TIP, smoothstep(0.65, 1.0, i / blast)),
         lambda i, k: {"Head": 1.0})

    # eyes: small glowing amber domes on the sides of the head
    if L["eye"]:
        en, eK = L["eye"]
        for side in (1, -1):
            c = V(side * 0.031, 0.322, 0.374)
            axis = norm(V(side * 1.0, 0.25, 0.1))
            path = [c - axis * 0.004, c + axis * 0.003, c + axis * 0.010][:en] if en == 3 else [c - axis * 0.004, c + axis * 0.010]
            radii = [(0.0045, 0.0045), (0.0110, 0.0110), (0.0045, 0.0045)][:en] if en == 3 else [(0.008, 0.008)] * 2
            tube(S, path, radii, eK, V(0, 0, 1), lambda i, k, a: EYE, lambda i, k: {"Head": 1.0}, mat=1)

    # crest: laterally flattened blades swept back from the top of the head, coral with yellow tips
    cn, cK = L["crest"]
    if L["crest_blades"] == 3:
        blades = [(0.0, 0.0, 0.205, 38), (0.012, 24, 0.150, 30), (-0.012, -24, 0.150, 30)]
    else:
        blades = [(0.0, 0.0, 0.180, 36)]
    for off, yaw, length, pitch in blades:
        base = V(off, 0.283, 0.386)
        d = norm(V(math.sin(math.radians(yaw)) * 0.9, -math.cos(math.radians(yaw)), math.sin(math.radians(pitch)) * 1.1))
        side_dir = norm(np.cross(d, UP))  # horizontal, across the blade
        pts = []
        for i in range(cn):
            t = i / (cn - 1)
            curl = UP * (-0.05 * length * t * t) + d * length * t
            pts.append(base + curl)
        rad = [(0.0125 * (1 - 0.7 * (i / (cn - 1)) ** 1.5) + 0.002, 0.003 * (1 - 0.5 * i / (cn - 1)) + 0.0015) for i in range(cn)]
        # width runs up the blade's own plane: use the sideways direction as the thin axis
        tube(S, pts, rad, cK, side_dir, lambda i, k, a, cn=cn: mix(CORAL, YELLOW, smoothstep(0.55, 1.0, i / (cn - 1))),
             lambda i, k: {"Crest": 1.0})


def build_wings(S, L):
    pn, pK = L["panel"]
    for side in (1, -1):
        sfx = "L" if side > 0 else "R"
        wing_in, wing_out = f"WingIn_{sfx}", f"WingOut_{sfx}"

        def P(s, f, u):
            return V(side * s, f, u)

        # inner wing: from inside the body out to the wrist (overlaps the hand a little)
        inner = [(0.040, 0.000, 0.045, 0.110, 0.020), (0.120, 0.000, 0.052, 0.108, 0.015), (0.230, -0.005, 0.058, 0.098, 0.011), (0.355, -0.015, 0.062, 0.076, 0.008)]
        st = resample_stations(inner, pn)
        path = [P(s, f, u) for s, f, u, _, _ in st]
        radii = [(c, t) for _, _, _, c, t in st]
        last = len(st) - 1

        def in_weight(i, k):
            t = i / last
            return blend(wing_in, wing_out, (t - 0.8) / 0.2) if t > 0.8 else {wing_in: 1.0}

        def in_colour(i, k, a):
            t = i / last
            top = mix(mix(BACK, SHOULDER, 0.5), mix(DEEP_TEAL, TEAL, 0.5), t)
            under = mix(MINT, BELLY, 0.5)
            s = math.sin(a)
            return mix(under, top, smoothstep(-0.3, 0.45, s)) if abs(math.cos(a)) < 0.9 else mix(top, under, 0.3)

        tube(S, path, radii, pK, V(0, 0, 1), in_colour, in_weight, phase=0.0)

        # hand: the outer panel the finger feathers grow from
        hand = [(0.325, -0.015, 0.062, 0.078, 0.008), (0.420, -0.030, 0.063, 0.062, 0.006), (0.500, -0.050, 0.063, 0.045, 0.005), (0.560, -0.070, 0.062, 0.030, 0.004)]
        hs = resample_stations(hand, pn)
        hpath = [P(s, f, u) for s, f, u, _, _ in hs]
        hradii = [(c, t) for _, _, _, c, t in hs]
        hlast = len(hs) - 1

        def hand_weight(i, k):
            t = i / hlast
            return blend(wing_in, wing_out, t / 0.2) if t < 0.2 else {wing_out: 1.0}

        def hand_colour(i, k, a):
            t = i / hlast
            top = mix(TEAL, mix(TEAL, CYAN, 0.6), t)
            under = mix(MINT, mix(MINT, CYAN, 0.3), t)
            s = math.sin(a)
            return mix(under, top, smoothstep(-0.3, 0.45, s)) if abs(math.cos(a)) < 0.9 else mix(top, under, 0.3)

        tube(S, hpath, hradii, pK, V(0, 0, 1), hand_colour, hand_weight)

        # finger feathers: splayed like the primaries of a raptor, the outermost longest
        fingers = [  # start (side, fwd, up), angle back from straight out in degrees, length
            (0.350, -0.080, 0.062, 60, 0.140), (0.420, -0.092, 0.063, 47, 0.180), (0.480, -0.095, 0.063, 34, 0.210),
            (0.530, -0.100, 0.062, 21, 0.225), (0.565, -0.100, 0.061, 9, 0.205),
        ]
        keep = {5: [0, 1, 2, 3, 4], 4: [0, 1, 3, 4], 3: [1, 3, 4]}[L["fingers"]]
        fn, fK = L["finger"]
        tips = []
        for idx in keep:
            s0, f0, u0, ang, length = fingers[idx]
            a = math.radians(ang)
            d = norm(V(math.cos(a) * side, -math.sin(a), 0.0))  # outward and back
            start = V(side * s0, f0, u0)
            pts = [start + d * length * (i / (fn - 1)) + UP * 0.025 * (i / (fn - 1)) ** 2 for i in range(fn)]
            wid = [0.021 * (1 - 0.62 * (i / (fn - 1)) ** 1.3) for i in range(fn)]
            thk = [0.0032 - 0.0012 * (i / (fn - 1)) for i in range(fn)]
            wid[-1] = max(wid[-1] * 0.55, 0.004)
            tube(S, pts, list(zip(wid, thk)), fK, V(0, 0, 1),
                 lambda i, k, a_, fn=fn: (mix(mix(TEAL, DEEP_TEAL, 0.3), CYAN, smoothstep(0.4, 1.0, i / (fn - 1))) if math.sin(a_) > -0.2
                                          else mix(MINT, CYAN, smoothstep(0.5, 1.0, i / (fn - 1)) * 0.6)),
                 lambda i, k: {wing_out: 1.0})
            tips.append((pts[-1], d))

        # glowing dots on the three outermost finger tips
        if L["dots"] and L["glow"]:
            dn, dK = L["dots"]
            for tip, d in tips[-3:]:
                c = tip - d * 0.02 + UP * 0.005
                dpath = [c - d * 0.006, c + d * 0.006] if dn == 2 else [c - d * 0.006, c, c + d * 0.006]
                tube(S, dpath, [(0.0085, 0.0085)] * len(dpath), dK, V(0, 0, 1), lambda i, k, a_: CYAN, lambda i, k: {wing_out: 1.0}, mat=1)


def build_legs(S, L):
    ln, lK = L["leg"]
    for side in (1, -1):
        sfx = "L" if side > 0 else "R"
        leg, foot = f"Leg_{sfx}", f"Foot_{sfx}"
        pts_ = [(0.010, -0.075, 0.016), (0.045, -0.150, 0.0125), (0.005, -0.250, 0.0078), (-0.005, -0.335, 0.0068)]
        pts = resample_stations(pts_, ln)
        path = [V(side * 0.050, f, u) for f, u, _ in pts]
        radii = [(r, r) for _, _, r in pts]
        last = len(pts) - 1

        def weight(i, k, leg=leg, foot=foot, last=last):
            t = i / last
            return blend(leg, foot, (t - 0.85) / 0.15) if t > 0.85 else {leg: 1.0}

        tube(S, path, radii, lK, V(0, 0, 1), lambda i, k, a: mix(TOE, LEG, 1 - 0.5 * smoothstep(0.6, 1.0, i / last)), weight)

        # toes lie on the ground, splayed
        if L["toe"]:
            tn, tK = L["toe"]
            ankle = V(side * 0.050, -0.005, -0.332)
            angles = [-28, 0, 28][:L["toes"]] if L["toes"] == 3 else [0]
            for ang in angles:
                a = math.radians(ang)
                d = norm(V(math.sin(a) * side, math.cos(a), 0.0))
                length = 0.075
                tp = [ankle + d * length * (i / (tn - 1)) + UP * 0.004 * (i / (tn - 1)) ** 2 for i in range(tn)]
                tube(S, tp, [(0.0055 - 0.0025 * i / (tn - 1),) * 2 for i in range(tn)], tK, V(0, 0, 1),
                     lambda i, k, a_: TOE, lambda i, k, foot=foot: {foot: 1.0})
            if L["hind_toe"]:
                d = norm(V(0.0, -1.0, 0.0))
                tp = [ankle + d * 0.045 * (i / (tn - 1)) for i in range(tn)]
                tube(S, tp, [(0.005 - 0.002 * i / (tn - 1),) * 2 for i in range(tn)], tK, V(0, 0, 1),
                     lambda i, k, a_: TOE, lambda i, k, foot=foot: {foot: 1.0})


def build_tail(S, L):
    fn, fK = L["fan"]
    count = L["fan_feathers"]
    angles = {5: [-34, -17, 0, 17, 34], 3: [-26, 0, 26], 1: [0]}[count]
    lengths = {5: [0.17, 0.21, 0.23, 0.21, 0.17], 3: [0.19, 0.23, 0.19], 1: [0.22]}[count]
    for ang, length in zip(angles, lengths):
        a = math.radians(ang)
        d = norm(V(math.sin(a), -math.cos(a), -0.12))  # back and slightly down
        start = V(0, -0.245, 0.018)
        pts = [start + d * length * (i / (fn - 1)) for i in range(fn)]
        wid = [0.012 + 0.020 * math.sin(math.pi * min(1.0, (i / (fn - 1)) * 1.15)) ** 0.7 for i in range(fn)]
        wid[-1] = max(wid[-1] * 0.5, 0.006)
        thk = [0.0045 - 0.0020 * i / (fn - 1) for i in range(fn)]
        tube(S, pts, list(zip(wid, thk)), fK, V(0, 0, 1),
             lambda i, k, a_, fn=fn: mix(mix(BACK, SHOULDER, 0.3), TEAL, smoothstep(0.55, 1.0, i / (fn - 1))) if math.sin(a_) > -0.2 else mix(MINT, TEAL, 0.5 * smoothstep(0.5, 1.0, i / (fn - 1))),
             lambda i, k: {"Tail": 1.0})

    # two long streamers: a thin shaft, then a glowing racket at the end
    sn, sK = L["streamer"]
    rn, rK = L["racket"]
    for side in (1, -1):
        sfx = "L" if side > 0 else "R"
        bone, tip = f"Streamer_{sfx}", f"StreamerTip_{sfx}"
        shaft = [(0.020, -0.268, 0.012), (0.034, -0.40, 0.002), (0.046, -0.56, -0.012), (0.056, -0.70, -0.020), (0.054, -0.82, -0.012)]
        pts = resample_stations(shaft, sn)
        path = [V(side * s, f, u) for s, f, u in pts]
        last = len(pts) - 1

        def weight(i, k, bone=bone, tip=tip, last=last):
            t = i / last
            return blend(bone, tip, (t - 0.35) / 0.3)

        radii = [(0.0055 - 0.0015 * i / last, 0.0030) for i in range(len(pts))]
        tube(S, path, radii, sK, V(0, 0, 1), lambda i, k, a_, last=last: mix(BACK, TEAL, smoothstep(0.3, 1.0, i / last)), weight)
        # racket
        rp = [(0.054, -0.80, -0.012), (0.056, -0.855, -0.009), (0.057, -0.905, -0.006), (0.058, -0.945, -0.004)]
        rs = resample_stations(rp, rn)
        rpath = [V(side * s, f, u) for s, f, u in rs]
        prof = [0.008, 0.030, 0.026, 0.006]
        rrad = [(w, 0.0035) for w in resample_stations([(p,) for p in prof], rn)[:, 0]]
        tube(S, rpath, rrad, rK, V(0, 0, 1), lambda i, k, a_: CYAN, lambda i, k, tip=tip: {tip: 1.0}, mat=1 if L["glow"] else 0)


# ----------------------------------------------------------------------------- Blender objects
def make_materials():
    bird = bpy.data.materials.new("Bird")
    bird.use_nodes = True
    nt = bird.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.62
    bsdf.inputs["Metallic"].default_value = 0.05
    bsdf.inputs["Specular IOR Level"].default_value = 0.35
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bird.use_backface_culling = True

    # One constant glow colour (cyan): the game turns the intensity up and down with the light.
    glow = bpy.data.materials.new("Glow")
    glow.use_nodes = True
    gb = glow.node_tree.nodes["Principled BSDF"]
    gb.inputs["Roughness"].default_value = 0.5
    gb.inputs["Base Color"].default_value = (0.02, 0.08, 0.10, 1)
    gb.inputs["Emission Color"].default_value = (0.25, 0.95, 1.0, 1)
    gb.inputs["Emission Strength"].default_value = 1.0
    glow.use_backface_culling = True
    return bird, glow


def make_armature():
    arm = bpy.data.armatures.new("AlienBird")
    ob = bpy.data.objects.new("AlienBird", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    edit = {}
    for name, parent, pos in BONES:
        eb = arm.edit_bones.new(name)
        eb.head = tuple(pos)
        eb.tail = tuple(pos + np.array([0.0, 0.04, 0.0]))  # every bone points along +Y with no roll: identity rest rotation
        eb.roll = 0.0
        edit[name] = eb
    for name, parent, _ in BONES:
        if parent:
            edit[name].parent = edit[parent]
            edit[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def build_mesh_object(S, arm_ob, bird_mat, glow_mat, name):
    me = bpy.data.meshes.new(name)
    faces = [tuple(f) for f in S.F]
    me.from_pydata([tuple(v) for v in S.V], [], faces)
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    rgba = np.concatenate([np.clip(np.asarray(S.C, float), 0, 1), np.ones((len(S.C), 1))], 1)
    ca.data.foreach_set("color", rgba.ravel())
    me.materials.append(bird_mat)
    me.materials.append(glow_mat)
    for poly, m in zip(me.polygons, S.M):
        poly.material_index = m
    me.shade_smooth()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    groups = {n: ob.vertex_groups.new(name=n) for n in BONE_NAMES}
    for i, w in enumerate(S.W):
        total = sum(w.values())
        for bone, weight in w.items():
            if weight > 1e-4:
                groups[bone].add([i], weight / total, "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_ob
    ob.parent = arm_ob
    return ob


def build_lod(index):
    L = LODS[index]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    S = Shape()
    report = []
    for part in (build_body, build_neck_and_head, build_wings, build_legs, build_tail):
        before = S.tris()
        part(S, L)
        report.append(f"{part.__name__[6:]} {S.tris() - before}")
    print("   parts:", ", ".join(report))
    bird_mat, glow_mat = make_materials()
    arm_ob = make_armature()
    build_mesh_object(S, arm_ob, bird_mat, glow_mat, "Bird")
    lows = np.min(np.asarray(S.V), axis=0)
    highs = np.max(np.asarray(S.V), axis=0)
    per_mat = S.tris_by_material()
    print(f"LOD{index} tris {S.tris()} (bird {per_mat.get(0, 0)}, glow {per_mat.get(1, 0)}) shells {S.shells} verts {len(S.V)} "
          f"bounds side[{lows[0]:.3f},{highs[0]:.3f}] up[{lows[1]:.3f},{highs[1]:.3f}] fwd[{lows[2]:.3f},{highs[2]:.3f}]")
    path = os.path.join(OUT_DIR, f"alien_bird_{L['name']}.glb")
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_yup=False, export_apply=False,
        export_lights=False, export_cameras=False, export_animations=False, export_skins=True,
        export_vertex_color="MATERIAL", export_normals=True, export_tangents=False, export_texcoords=False,
        export_materials="EXPORT", export_extras=False, export_all_influences=False)
    print("EXPORTED", path)


for lod in range(len(LODS)):
    if ONLY_LOD < 0 or ONLY_LOD == lod:
        build_lod(lod)
