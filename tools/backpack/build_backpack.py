"""Backpack: a small low-poly survival rucksack, built headless in Blender (bpy module).

    python3 tools/backpack/build_backpack.py --out public/models/backpack/backpack.glb

A weathered teal canvas pack with a leather-strapped flap, a bedroll lashed to the front, two bottle pockets, padded
shoulder straps on the back, a carry handle on top and a thin glowing cyan trim (so it can be found at night). One mesh
with vertex colours and a tiny second material for the glow, plus the carry handle as a mesh of its own (the game's
grip code fits the fingers to that mesh alone). No textures.

Frame: built directly in glTF axes (exported with "Y up" off, so nothing is converted). +Y is up, +Z is the front of the
pack (the side away from the wearer's back), +X is its left. Units are metres. The origin is the middle of the base, so
y = 0 is where it stands on the ground. The handle is about 0.53 m up.

Objects: "Backpack" (materials Pack and Glow) and "CarryHandle" (Pack).
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


OUT = opt("--out", "public/models/backpack/backpack.glb")

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


def curve_through(points, n):
    """n samples along a smooth curve through the rows of `points` (uniform Catmull-Rom)."""
    P = np.asarray(points, float)
    m = len(P)
    out = []
    for t in np.linspace(0, m - 1, n):
        i = min(int(math.floor(t)), m - 2)
        u = t - i
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, m - 1)]
        out.append(0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


# Palette (sRGB hex).
CANVAS = srgb(0x2F7C78)       # the body: faded teal canvas
CANVAS_DEEP = srgb(0x1E5558)  # shadowed canvas, the back panel
FLAP = srgb(0x225F63)
POCKET = srgb(0x3A8780)
DUST = srgb(0xA08558)         # windblown sand worked into the bottom
LEATHER = srgb(0x4C301F)
LEATHER_EDGE = srgb(0x7A5033)
WEBBING = srgb(0x203F45)
BRASS = srgb(0xC9A03F)
BEDROLL = srgb(0xE3D5AC)
BEDROLL_SHADE = srgb(0xB89F6B)
ROLL_CORE = srgb(0x6C5530)
CORAL = srgb(0xE5603B)
CYAN = srgb(0x4DF2FF)

PART_PACK, PART_HANDLE = 0, 1
MAT_PACK, MAT_GLOW = 0, 1


# ----------------------------------------------------------------------------- solid shells
class Shape:
    """Every closed shell of the pack with a colour on each vertex."""

    def __init__(self):
        self.V, self.C, self.F, self.M, self.P = [], [], [], [], []
        self.shells = 0

    def tris(self, part=None, mat=None):
        return sum(len(f) - 2 for f, m, p in zip(self.F, self.M, self.P)
                   if (part is None or p == part) and (mat is None or m == mat))

    def shell(self, rings, colours, mat=MAT_PACK, part=PART_PACK):
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
        self.F.extend(faces)
        self.M.extend([mat] * len(faces))
        self.P.extend([part] * len(faces))
        self.shells += 1


def super_ring(c, a_axis, b_axis, ra, rb, K, p=2.0, phase=0.0):
    """K points around a superellipse in the plane of a_axis and b_axis (p = 2 is an ellipse, higher is boxier)."""
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


def tube(S, path, radii, K, hint, colour, p=2.0, phase=0.0, mat=MAT_PACK, part=PART_PACK):
    """A tube along `path` (rows of 3D points). radii[i] = (half size along `right`, half size along `up`) where right
    and up are perpendicular to the path (see frames_along). colour(point, i, k) -> rgb."""
    path = [np.asarray(q, float) for q in path]
    fr = frames_along(path, np.asarray(hint, float))
    rings, cols = [], []
    for i, (c, (right, up)) in enumerate(zip(path, fr)):
        ra, rb = radii[i]
        ring = super_ring(c, right, up, max(ra, 0.0012), max(rb, 0.0012), K, p, phase)
        rings.append(ring)
        cols.append([colour(q, i, k) for k, q in enumerate(ring)])
    S.shell(rings, cols, mat, part)


# ----------------------------------------------------------------------------- the dimensions (metres)
BACK_Z = -0.090            # the flat back panel
BODY_TOP = 0.4715
# stations: y, half width, front z
BODY = [
    (0.000, 0.118, 0.040), (0.012, 0.150, 0.078), (0.045, 0.163, 0.094), (0.110, 0.167, 0.102), (0.220, 0.168, 0.104),
    (0.330, 0.165, 0.099), (0.410, 0.160, 0.090), (0.440, 0.152, 0.078), (0.462, 0.136, 0.060), (BODY_TOP, 0.100, 0.038),
]
FLAP_PATH = [  # y, z of the middle of the flap: over the top and down the front
    (0.4550, -0.0905), (0.4740, -0.0730), (0.4838, -0.0300), (0.4835, 0.0150), (0.4750, 0.0520), (0.4560, 0.0820), (0.4250, 0.1010),
    (0.3800, 0.1130), (0.3400, 0.1170), (0.3150, 0.1190), (0.3000, 0.1200),
]
FLAP_HALF_WIDTH = [0.141, 0.157, 0.168, 0.173, 0.174, 0.174, 0.173, 0.171, 0.166, 0.153, 0.132]
FLAP_THICK = 0.0075
ROLL = dict(y=0.134, z=0.155, r=0.058, half_length=0.176)


def flap_point(y):
    """The middle of the flap, outer surface, at height y on the front slope (y between the tip and the shoulder)."""
    pts = FLAP_PATH
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        if y1 <= y <= y0:
            t = (y0 - y) / (y0 - y1)
            return lerp(z0, z1, t) + FLAP_THICK
    return pts[-1][1] + FLAP_THICK


def body_front(y):
    """z of the front of the body at height y."""
    for (y0, _, z0), (y1, _, z1) in zip(BODY, BODY[1:]):
        if y0 <= y <= y1:
            return lerp(z0, z1, (y - y0) / (y1 - y0))
    return BODY[-1][2]


# ----------------------------------------------------------------------------- the parts
def build_body(S):
    n_rings = 20
    st = curve_through(BODY, n_rings)
    K = 22
    rings, cols = [], []
    for i, (y, rx, zf) in enumerate(st):
        zc, rz = (zf + BACK_Z) / 2, (zf - BACK_Z) / 2
        roundness = 3.0 if 0.03 < y < 0.40 else 2.4
        ring = super_ring(np.array([0.0, y, zc]), np.array([1.0, 0, 0]), np.array([0, 0, 1.0]), rx, rz, K, roundness)
        rings.append(ring)
        row = []
        for q in ring:
            c = CANVAS
            back = smoothstep(BACK_Z + 0.030, BACK_Z + 0.004, q[2])  # the back panel is deeper in colour
            c = mix(c, CANVAS_DEEP, 0.75 * back)
            c = mix(c, DUST, 0.60 * smoothstep(0.17, 0.0, q[1]))      # sand worked into the base
            c = mix(c, CANVAS_DEEP, 0.30 * smoothstep(0.40, 0.46, q[1]))  # shadow under the flap
            side = abs(q[0]) / max(rx, 1e-6)
            c = shade(c, 1.0 - 0.10 * smoothstep(0.80, 1.0, side))     # a little wear to the edges
            c = shade(c, 1.0 + 0.07 * noise3(q))
            row.append(c)
        cols.append(row)
    S.shell(rings, cols)


def build_flap(S):
    path = [np.array([0.0, y, z]) for y, z in FLAP_PATH]
    # the flap is a thin flattened tube: thickness along the surface normal, width across the pack
    fr = frames_along(path, np.array([1.0, 0.0, 0.0]))
    K = 14
    rings, cols = [], []
    last = len(path) - 1
    for i, (c, (normal, across)) in enumerate(zip(path, fr)):
        hw = FLAP_HALF_WIDTH[i]
        ring = super_ring(c, across, normal, hw, FLAP_THICK, K, 4.0)
        rings.append(ring)
        row = []
        t = i / last
        for q in ring:
            col = FLAP
            col = mix(col, CORAL, 0.95 * smoothstep(0.80, 0.86, t) * (1 - smoothstep(0.94, 1.0, t)))  # a coral band near the edge
            col = mix(col, LEATHER, 0.55 * smoothstep(0.96, 1.0, t))
            col = shade(col, 1.0 + 0.07 * noise3(q, 3.0))
            col = shade(col, 1.0 - 0.18 * (smoothstep(0.82, 1.0, abs(q[0]) / hw)))  # the edges are darker
            row.append(col)
        cols.append(row)
    S.shell(rings, cols)


def build_side_pockets(S):
    stations = [(0.040, 0.024, 0.030), (0.068, 0.036, 0.046), (0.130, 0.041, 0.054), (0.195, 0.039, 0.051), (0.232, 0.034, 0.045)]
    st = curve_through(stations, 8)
    K = 14
    for side in (1, -1):
        rings, cols = [], []
        for i, (y, rx, rz) in enumerate(st):
            ring = super_ring(np.array([side * 0.196, y, 0.010]), np.array([1.0, 0, 0]), np.array([0, 0, 1.0]), rx, rz, K, 2.4)
            rings.append(ring)
            row = []
            for q in ring:
                c = mix(POCKET, DUST, 0.5 * smoothstep(0.10, 0.0, q[1]))
                c = mix(c, CANVAS_DEEP, 0.55 * smoothstep(0.205, 0.232, q[1]))  # the mouth of the pocket, in shade
                c = shade(c, 1.0 + 0.07 * noise3(q, 7.0))
                row.append(c)
            cols.append(row)
        S.shell(rings, cols)


def build_bedroll(S):
    cy, cz, r, hl = ROLL["y"], ROLL["z"], ROLL["r"], ROLL["half_length"]
    stations = [(-hl, 0.030, ROLL_CORE), (-hl, 0.046, BEDROLL_SHADE), (-hl + 0.005, r * 0.99, BEDROLL), (-0.15, r, BEDROLL),
                (0.15, r, BEDROLL), (hl - 0.005, r * 0.99, BEDROLL), (hl, 0.046, BEDROLL_SHADE), (hl, 0.030, ROLL_CORE)]
    K = 18
    rings, cols = [], []
    for x, rad, base_col in stations:
        ring = super_ring(np.array([x, cy, cz]), np.array([0, 1.0, 0]), np.array([0, 0, 1.0]), rad, rad, K, 2.0)
        rings.append(ring)
        row = []
        for q in ring:
            c = base_col
            if abs(x) < hl - 0.01:  # the outside of the roll: lighter on top, dustier underneath
                c = mix(c, DUST, 0.55 * smoothstep(cy + 0.005, cy - r, q[1]))
            c = shade(c, 1.0 + 0.08 * noise3(q, 11.0))
            row.append(c)
        cols.append(row)
    S.shell(rings, cols)


def roll_wrap(x, deg):
    """A point just outside the bedroll at angle `deg` (0 = straight out the front, 90 = the top)."""
    a = math.radians(deg)
    rr = ROLL["r"] + 0.0065
    return np.array([x, ROLL["y"] + rr * math.sin(a), ROLL["z"] + rr * math.cos(a)])


def build_front_straps(S):
    """Two leather straps from the flap, over the bedroll and under it, with a brass buckle each."""
    for x in (-0.072, 0.072):
        top = np.array([x, 0.3015, flap_point(0.3015) + 0.0035])
        down = np.array([x, 0.236, body_front(0.236) + 0.0105])
        wrap = [roll_wrap(x, d) for d in (112, 90, 60, 30, 0, -30, -55)]
        path = curve_through([top, np.array([x, 0.268, body_front(0.268) + 0.0085]), down, *wrap], 17)

        def colour(q, i, k, x=x):
            c = LEATHER
            c = mix(c, LEATHER_EDGE, 0.5 * (1 if k % 4 in (1, 3) else 0))
            return shade(c, 1.0 + 0.06 * noise3(q, 5.0))

        tube(S, path, [(0.0036, 0.0150)] * len(path), 6, (1, 0, 0), colour, 4.0)
        # the buckle: a brass plate where the strap crosses the front of the roll
        mid = roll_wrap(x, 4)
        along = norm(np.array([0.0, math.cos(math.radians(4)), -math.sin(math.radians(4))]))
        a, b = mid - along * 0.018, mid + along * 0.018
        tube(S, [a, b], [(0.0042, 0.0225), (0.0042, 0.0225)], 4, (1, 0, 0),
             lambda q, i, k: shade(BRASS, 1.0 + 0.10 * noise3(q, 9.0)), 4.0)


def build_shoulder_straps(S):
    for x in (-0.078, 0.078):
        pts = [(0.436, -0.0955), (0.380, -0.1000), (0.300, -0.1030), (0.200, -0.1030), (0.110, -0.1005), (0.050, -0.0960), (0.024, -0.0925)]
        path = curve_through([np.array([x, y, z]) for y, z in pts], 14)
        radii = []
        for i in range(len(path)):
            t = i / (len(path) - 1)
            pad = math.sin(math.pi * t) ** 0.6
            radii.append((0.0045 + 0.0055 * pad, 0.0235 + 0.004 * pad))

        def colour(q, i, k):
            return shade(mix(WEBBING, LEATHER, 0.35 * smoothstep(0.88, 1.0, q[1] / 0.45) + 0.35 * smoothstep(0.08, 0.0, q[1])), 1.0 + 0.07 * noise3(q, 13.0))

        tube(S, path, radii, 8, (1, 0, 0), colour, 3.0)


def build_handle(S):
    """The carry handle: a leather loop on top of the flap, in a mesh of its own."""
    ytop = max(y for y, _ in FLAP_PATH) + FLAP_THICK
    n = 14
    path = []
    for i in range(n):
        t = i / (n - 1)
        x = lerp(-0.078, 0.078, t)
        y = ytop - 0.005 + 0.062 * math.sin(math.pi * t) ** 0.75
        path.append(np.array([x, y, -0.010]))
    radii = [(0.0055, 0.0155)] * n
    tube(S, path, radii, 8, (0, 0, 1), lambda q, i, k: shade(mix(LEATHER, LEATHER_EDGE, 0.25), 1.0 + 0.07 * noise3(q, 17.0)), 3.2,
         part=PART_HANDLE)


def build_glow(S):
    """A thin cyan trim along the front edge and sides of the flap, and a small glowing mark on it."""
    outline = [(-0.1715, 0.395), (-0.1700, 0.360), (-0.1650, 0.328), (-0.1520, 0.307), (-0.1300, 0.2985), (0.0, 0.2975),
               (0.1300, 0.2985), (0.1520, 0.307), (0.1650, 0.328), (0.1700, 0.360), (0.1715, 0.395)]
    pts = []
    for x, y in outline:
        pts.append(np.array([x, y, flap_point(y) + 0.0010]))
    path = curve_through(pts, 26)
    tube(S, path, [(0.0034, 0.0034)] * len(path), 6, (0, 0, 1), lambda q, i, k: CYAN, 2.0, mat=MAT_GLOW)
    # the mark: a small diamond lying on the flap
    y0 = 0.392
    c = np.array([0.0, y0, flap_point(y0) + 0.002])
    slope = (flap_point(y0 + 0.01) - flap_point(y0 - 0.01)) / 0.02
    normal = norm(np.array([0.0, 1.0, -slope]))
    normal = normal if normal[2] > 0 else -normal
    a = c - normal * 0.0015
    b = c + normal * 0.0035
    tube(S, [a, b], [(0.019, 0.019), (0.019, 0.019)], 4, (0, 1, 0), lambda q, i, k: CYAN, 2.0, phase=math.pi / 2, mat=MAT_GLOW)


# ----------------------------------------------------------------------------- Blender objects
def make_materials():
    pack = bpy.data.materials.new("Pack")
    pack.use_nodes = True
    nt = pack.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.88
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.25
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    pack.use_backface_culling = True

    glow = bpy.data.materials.new("Glow")
    glow.use_nodes = True
    gb = glow.node_tree.nodes["Principled BSDF"]
    gb.inputs["Roughness"].default_value = 0.5
    gb.inputs["Base Color"].default_value = (0.02, 0.08, 0.10, 1)
    gb.inputs["Emission Color"].default_value = (0.25, 0.95, 1.0, 1)
    gb.inputs["Emission Strength"].default_value = 1.0
    glow.use_backface_culling = True
    return pack, glow


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
    return ob


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
    for part in (build_body, build_flap, build_side_pockets, build_bedroll, build_front_straps, build_shoulder_straps, build_handle, build_glow):
        before = S.tris()
        part(S)
        report.append(f"{part.__name__[6:]} {S.tris() - before}")
    print("   parts:", ", ".join(report))
    pack_mat, glow_mat = make_materials()
    pack_ob = make_object(S, PART_PACK, "Backpack", [pack_mat, glow_mat])
    handle_ob = make_object(S, PART_HANDLE, "CarryHandle", [pack_mat])
    for ob in (pack_ob, handle_ob):
        smooth_by_angle(ob)
    lows = np.min(np.asarray(S.V), axis=0)
    highs = np.max(np.asarray(S.V), axis=0)
    print(f"tris {S.tris()} (pack {S.tris(PART_PACK, MAT_PACK)}, glow {S.tris(PART_PACK, MAT_GLOW)}, handle {S.tris(PART_HANDLE)}) shells {S.shells} "
          f"verts {len(S.V)} bounds x[{lows[0]:.3f},{highs[0]:.3f}] y[{lows[1]:.3f},{highs[1]:.3f}] z[{lows[2]:.3f},{highs[2]:.3f}]")
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format="GLB", export_yup=False, export_apply=False,
        export_lights=False, export_cameras=False, export_animations=False, export_skins=False,
        export_vertex_color="MATERIAL", export_normals=True, export_tangents=False, export_texcoords=False,
        export_materials="EXPORT", export_extras=False)
    print("EXPORTED", OUT, f"{os.path.getsize(OUT)} bytes")


main()
