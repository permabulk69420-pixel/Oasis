"""Campfire: stone ring, leaning logs, ash bed and embers, built headless in Blender (bpy module).

Blender is Z-up, the glTF exporter converts to +Y up. Units are metres, origin = centre of the fire at
ground level. Objects: Stones, Logs, Ash, Embers (+ empty FlameAnchor).
Materials: Stone, Bark, Char (all base-colour textures / vertex colours) and Ember (emissive).

    python3 tools/campfire/build_campfire.py --out public/models/campfire/campfire.glb
"""
import math
import os
import sys
import tempfile

import bpy
import bmesh
import numpy as np
from mathutils import Vector, noise

OUT = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "public/models/campfire/campfire.glb"
SEED = 20261004
rng = np.random.default_rng(SEED)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)


# ----------------------------------------------------------------------------- textures
def periodic_noise(n, aniso=(1.0, 1.0), power=2.0, seed=0):
    """Seamless noise: filtered white noise in the Fourier domain. aniso scales (u, v) frequency."""
    r = np.random.default_rng(seed)
    white = r.standard_normal((n, n))
    fu = np.fft.fftfreq(n)[None, :] * n
    fv = np.fft.fftfreq(n)[:, None] * n
    f2 = (fu * aniso[0]) ** 2 + (fv * aniso[1]) ** 2
    filt = 1.0 / (1.0 + f2) ** (power / 2)
    filt[0, 0] = 0
    out = np.fft.ifft2(np.fft.fft2(white) * filt).real
    out -= out.mean()
    return out / (np.abs(out).max() + 1e-9)


def ramp(t, stops):
    t = np.clip(t, 0, 1)
    xs = [s[0] for s in stops]
    cols = np.array([s[1] for s in stops], float)
    return np.stack([np.interp(t, xs, cols[:, k]) for k in range(3)], -1)


def make_bark(n=512):
    # Furrows run along v (the log axis): high frequency across u, low along v.
    coarse = periodic_noise(n, (1.0, 0.18), 1.6, 1)
    fine = periodic_noise(n, (2.4, 0.5), 1.1, 2)
    ridge = 1.0 - np.abs(periodic_noise(n, (1.2, 0.12), 1.8, 3)) * 2.6
    t = 0.5 + 0.34 * coarse + 0.16 * fine
    t = np.clip(t - 0.30 * np.clip(ridge, 0, 1), 0, 1)
    rgb = ramp(t, [(0, (0.030, 0.022, 0.017)), (0.35, (0.085, 0.062, 0.045)), (0.7, (0.17, 0.125, 0.092)), (1, (0.27, 0.205, 0.15))])
    return np.clip(rgb, 0, 1), t


def make_stone(n=512):
    big = periodic_noise(n, (1.0, 1.0), 2.2, 11)
    mid = periodic_noise(n, (3.0, 3.0), 1.6, 12)
    fine = periodic_noise(n, (9.0, 9.0), 1.0, 13)
    speck = (periodic_noise(n, (22.0, 22.0), 0.6, 14) > 0.55).astype(float)
    t = 0.5 + 0.30 * big + 0.18 * mid + 0.10 * fine
    rgb = ramp(t, [(0, (0.085, 0.080, 0.075)), (0.5, (0.17, 0.155, 0.135)), (1, (0.30, 0.27, 0.225))])
    rgb *= (1.0 - 0.35 * speck)[..., None]
    return np.clip(rgb, 0, 1), t - 0.25 * speck


def make_coal(n=256):
    """Dark crust with glowing cracks: returns (base colour, emissive colour)."""
    crust = 0.5 + 0.35 * periodic_noise(n, (3.0, 3.0), 1.4, 21) + 0.2 * periodic_noise(n, (9.0, 9.0), 1.0, 22)
    ridge = 1.0 - np.abs(periodic_noise(n, (2.2, 2.2), 1.7, 23)) * 3.2
    crack = np.clip(ridge, 0, 1) ** 1.6
    base = ramp(crust, [(0, (0.010, 0.008, 0.007)), (0.6, (0.040, 0.034, 0.030)), (1, (0.085, 0.072, 0.062))])
    glow = ramp(0.25 + 0.75 * crack * (0.6 + 0.4 * (1.0 - crust)), [(0, (0.0, 0.0, 0.0)), (0.35, (0.55, 0.06, 0.005)), (0.7, (1.0, 0.30, 0.03)), (1, (1.0, 0.62, 0.16))])
    glow *= (crack > 0.05)[..., None]
    return np.clip(base, 0, 1), np.clip(glow, 0, 1)


def normal_from_height(h, strength=4.0):
    """Tangent-space (OpenGL, +Y up) normal map from a seamless height field; row 0 is the top."""
    du = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dv = -(np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    n = np.stack([-du * strength * h.shape[0] / 64, -dv * strength * h.shape[0] / 64, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


TEXDIR = tempfile.mkdtemp(prefix="campfire_tex_")


def load_image(name, data, srgb=True):
    path = os.path.join(TEXDIR, name + ".png")
    n = data.shape[0]
    values = np.clip(data, 0, 1) ** (1 / 2.2) if srgb else np.clip(data, 0, 1)
    rgba = np.concatenate([values, np.ones((n, n, 1))], -1)
    img = bpy.data.images.new(name, n, n, alpha=False)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def make_mat(name, rgb=None, base=(0.5, 0.5, 0.5), rough=0.9, emissive=None, vcol=True, height=None, normal_strength=1.0,
             emissive_tex=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.25
    bsdf.inputs["Base Color"].default_value = (*base, 1)
    if rgb is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = load_image(name.lower() + "_albedo", rgb)
        tex.interpolation = "Smart"
        if vcol:
            vc = nt.nodes.new("ShaderNodeVertexColor")
            vc.layer_name = "Col"
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs[0].default_value = 1.0
            nt.links.new(tex.outputs["Color"], mix.inputs[6])
            nt.links.new(vc.outputs["Color"], mix.inputs[7])
            nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        else:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    elif vcol:
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    if height is not None:
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.image = load_image(name.lower() + "_normal", normal_from_height(height), srgb=False)
        ntex.interpolation = "Smart"
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal_strength
        nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    if emissive_tex is not None:
        etex = nt.nodes.new("ShaderNodeTexImage")
        etex.image = load_image(name.lower() + "_emissive", emissive_tex)
        nt.links.new(etex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
    elif emissive is not None:
        bsdf.inputs["Emission Color"].default_value = (*emissive, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    m.use_backface_culling = True  # solid, outward-facing surfaces: skip the hidden insides
    return m


_bark_rgb, _bark_h = make_bark()
_stone_rgb, _stone_h = make_stone()
_coal_rgb, _coal_glow = make_coal()
MAT_STONE = make_mat("Stone", _stone_rgb, rough=0.86, height=_stone_h, normal_strength=0.9)
MAT_BARK = make_mat("Bark", _bark_rgb, rough=0.92, height=_bark_h, normal_strength=1.0)
MAT_CHAR = make_mat("Char", None, base=(0.05, 0.05, 0.05), rough=0.96)
MAT_EMBER = make_mat("Ember", _coal_rgb, rough=0.8, vcol=False, emissive_tex=_coal_glow)


# ----------------------------------------------------------------------------- mesh accumulation
class Acc:
    def __init__(self):
        self.V, self.F, self.UV, self.C = [], [], [], []

    def add(self, verts, faces, uvs, cols):
        """faces: tuples of vertex indices (local); uvs: per face-corner (list of lists)."""
        base = sum(len(v) for v in self.V)
        self.V.append(np.asarray(verts, float))
        self.C.append(np.asarray(cols, float))
        for f in faces:
            self.F.append(tuple(base + i for i in f))
        self.UV.extend(uvs)

    def tris(self):
        return sum(len(f) - 2 for f in self.F)


def build(name, acc, mat, smooth=True, flip=False):
    """flip=True reverses every face (and its UV corners) so the normals point outward."""
    V = np.concatenate(acc.V)
    C = np.concatenate(acc.C)
    me = bpy.data.meshes.new(name)
    faces = [tuple(reversed(f)) for f in acc.F] if flip else acc.F
    uv_corners = [list(reversed(list(u))) for u in acc.UV] if flip else acc.UV
    me.from_pydata(V.tolist(), [], faces)
    uv = me.uv_layers.new(name="UVMap")
    flat = np.concatenate([np.asarray(u, float).reshape(-1, 2) for u in uv_corners])
    assert len(flat) == len(me.loops), (name, len(flat), len(me.loops))
    uv.data.foreach_set("uv", flat.ravel())
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    rgba = np.concatenate([np.clip(C, 0, 1), np.ones((len(C), 1))], 1)
    ca.data.foreach_set("color", rgba.ravel())
    me.materials.append(mat)
    if smooth:
        me.shade_smooth()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------------------- stones
stones = Acc()
N_STONES = 12
RING_R = 0.44
SKIRT = 0.13  # ring stones reach this far below the ground line, so the ring seats on uneven ground


def add_rock(centre_xy, size, subdiv, skirt, ring_angle=None, ring_radius=0.0):
    sx, sy, sz = size
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    seed_off = Vector(rng.uniform(-50, 50, 3).tolist())
    yaw = rng.uniform(0, math.tau)
    tilt = rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2)
    cuts = []  # a few flat cuts, like split stone
    for _ in range(int(rng.integers(3, 6))):
        d = Vector(rng.normal(size=3).tolist())
        d.normalize()
        cuts.append((d, rng.uniform(0.62, 0.82)))
    k_skirt = max(1.0, (0.6 * sz - 0.035 + skirt) / (0.8 * sz))
    centre = Vector((centre_xy[0], centre_xy[1], sz * 0.80 - 0.035))
    for v in bm.verts:
        p = v.co.copy()
        for d, depth in cuts:
            over = p.dot(d) - depth
            if over > 0:
                p -= d * over * 0.95
        p *= 1.0 + 0.22 * noise.noise(p * 1.4 + seed_off) + 0.07 * noise.noise(p * 3.7 + seed_off) + 0.025 * noise.noise(p * 9.0 + seed_off)
        p.x *= sx
        p.y *= sy
        p.z *= sz
        if p.z < -sz * 0.2:  # underside: stretch down into the ground
            p.z = -sz * 0.2 + (p.z + sz * 0.2) * k_skirt
        c, s_ = math.cos(yaw), math.sin(yaw)
        x, y, z = p.x * c - p.y * s_, p.x * s_ + p.y * c, p.z
        y, z = y * math.cos(tilt[0]) - z * math.sin(tilt[0]), y * math.sin(tilt[0]) + z * math.cos(tilt[0])
        x, z = x * math.cos(tilt[1]) + z * math.sin(tilt[1]), -x * math.sin(tilt[1]) + z * math.cos(tilt[1])
        v.co = Vector((x, y, z)) + centre
    bm.normal_update()
    verts, cols, faces, uvs = [], [], [], []
    shade = rng.uniform(0.72, 1.08)
    warm = rng.uniform(-0.04, 0.05)
    for v in bm.verts:
        verts.append(tuple(v.co))
        k = shade
        if ring_angle is not None:  # fire-facing side a little sooty
            inward = max(0.0, -(v.co.x * math.cos(ring_angle) + v.co.y * math.sin(ring_angle)) + ring_radius) / max(ring_radius, 1e-3)
            k *= 1.0 - 0.35 * smoothstep(0.0, 0.25, inward * 0.4)
        cols.append((k * (1 + warm), k, k * (1 - warm)))
    scale = 1.0 / 0.55  # metres -> texture tiles
    for f in bm.faces:
        faces.append(tuple(v.index for v in f.verts))
        n = f.normal
        axis = np.argmax(np.abs([n.x, n.y, n.z]))
        face_uv = []
        for v in f.verts:
            q = v.co
            face_uv.append((q.y * scale, q.z * scale) if axis == 0 else (q.x * scale, q.z * scale) if axis == 1 else (q.x * scale, q.y * scale))
        uvs.append(face_uv)
    stones.add(verts, faces, uvs, cols)
    bm.free()


phase = rng.uniform(0, math.tau)
for i in range(N_STONES):
    a_ = phase + i * math.tau / N_STONES + rng.uniform(-0.10, 0.10)
    r_ = RING_R + rng.uniform(-0.035, 0.035)
    add_rock((math.cos(a_) * r_, math.sin(a_) * r_),
             (rng.uniform(0.085, 0.15), rng.uniform(0.08, 0.13), rng.uniform(0.06, 0.095)), 3, SKIRT, a_, r_)
for i in range(7):  # loose pebbles just outside the ring
    a_ = rng.uniform(0, math.tau)
    r_ = rng.uniform(0.56, 0.78)
    add_rock((math.cos(a_) * r_, math.sin(a_) * r_), (rng.uniform(0.025, 0.05), rng.uniform(0.025, 0.045), rng.uniform(0.018, 0.03)), 2, 0.04)


# ----------------------------------------------------------------------------- logs
logs = Acc()
CHAR_CENTRE = Vector((0.0, 0.0, 0.12))


def add_log(p0, p1, r0, r1, seg=14, rings=14, bend=0.012, stub=True, kind="log"):
    p0, p1 = Vector(p0), Vector(p1)
    axis = (p1 - p0)
    length = axis.length
    axis.normalize()
    side = axis.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(axis).normalized()
    bend_dir = Vector(rng.normal(size=3).tolist())
    bend_dir -= axis * bend_dir.dot(axis)
    bend_dir = bend_dir.normalized() if bend_dir.length > 1e-4 else side
    seed_off = Vector(rng.uniform(-50, 50, 3).tolist())
    verts, cols, faces, uvs = [], [], [], []
    ring_idx = []
    wob_phase = rng.uniform(0, math.tau)
    for j in range(rings + 1):
        t = j / rings
        centre = p0 + axis * (length * t) + bend_dir * (bend * math.sin(math.pi * t))
        rad = r0 + (r1 - r0) * t
        row = []
        for k in range(seg):
            ang = math.tau * k / seg
            d = 1.0 + 0.10 * noise.noise(Vector((math.cos(ang) * 1.2, math.sin(ang) * 1.2, t * 4.0)) + seed_off)
            d *= 1.0 + 0.05 * math.sin(wob_phase + t * 9.0 + ang * 2.0)
            off = (side * math.cos(ang) + up * math.sin(ang)) * rad * d
            p = centre + off
            verts.append(tuple(p))
            # Soot: the lower ends that sit in the fire are charred black, fading up the log.
            char = 1.0 - 0.82 * (1.0 - smoothstep(0.06, 0.30, p.z))
            if kind == "stick":
                char = 1.0 - 0.6 * (1.0 - smoothstep(0.05, 0.22, p.z))
            # a bit of per-vertex variation so the char breaks up
            char *= 1.0 + 0.25 * noise.noise(Vector(tuple(p * 9.0)) + seed_off)
            char = max(char, 0.12)
            tone = rng.uniform(0.9, 1.08)
            cols.append((char * tone,) * 3)
            row.append(len(verts) - 1)
        ring_idx.append(row)
    vscale = length / 0.62
    for j in range(rings):
        for k in range(seg):
            k2 = (k + 1) % seg
            a, b, c, d = ring_idx[j][k], ring_idx[j][k2], ring_idx[j + 1][k2], ring_idx[j + 1][k]
            faces.append((a, b, c, d))
            u0, u1 = k / seg * 1.5, (k + 1) / seg * 1.5
            v0, v1 = j / rings * vscale, (j + 1) / rings * vscale
            uvs.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    # end caps (flat, fan around a centre vertex), lighter inside for a cut-wood look
    for end, flip in ((0, True), (rings, False)):
        centre = p0 + axis * (length * (end / rings)) + bend_dir * (bend * math.sin(math.pi * end / rings))
        verts.append(tuple(centre))
        char = 1.0 - 0.82 * (1.0 - smoothstep(0.06, 0.30, centre.z))
        cols.append((max(char, 0.12) * 0.7,) * 3)  # cut ends: no lighter than the bark, so firelight does not blow them out
        ci = len(verts) - 1
        for k in range(seg):
            k2 = (k + 1) % seg
            a, b = ring_idx[end][k], ring_idx[end][k2]
            faces.append((ci, b, a) if flip else (ci, a, b))
            cx, cy = 0.25 + 0.2, 0.1
            ang0, ang1 = math.tau * k / seg, math.tau * (k + 1) / seg
            uvs.append([(cx, cy), (cx + 0.18 * math.cos(ang1), cy + 0.18 * math.sin(ang1)),
                        (cx + 0.18 * math.cos(ang0), cy + 0.18 * math.sin(ang0))] if flip else
                       [(cx, cy), (cx + 0.18 * math.cos(ang0), cy + 0.18 * math.sin(ang0)),
                        (cx + 0.18 * math.cos(ang1), cy + 0.18 * math.sin(ang1))])
    logs.add(verts, faces, uvs, cols)


# Teepee: five logs resting on the ground inside the stones and crossing over the centre.
N_LEAN = 5
lean_phase = rng.uniform(0, math.tau)
for i in range(N_LEAN):
    a = lean_phase + i * math.tau / N_LEAN + rng.uniform(-0.18, 0.18)
    base_r = rng.uniform(0.30, 0.36)
    base = Vector((math.cos(a) * base_r, math.sin(a) * base_r, 0.075 + rng.uniform(0, 0.015)))
    apex = Vector((math.cos(a + math.pi) * 0.05, math.sin(a + math.pi) * 0.05, rng.uniform(0.32, 0.39)))
    direction = (apex - base).normalized()
    start = base - direction * 0.05
    end = apex + direction * rng.uniform(0.07, 0.15)
    thick = rng.uniform(0.038, 0.050)
    add_log(start, end, thick * 1.05, thick * 0.85, bend=rng.uniform(0.006, 0.02))

# Two logs laid across the ash.
add_log((-0.27, -0.05, 0.058), (0.26, 0.10, 0.060), 0.052, 0.046, bend=0.01)
add_log((-0.12, 0.25, 0.050), (0.14, -0.25, 0.062), 0.045, 0.040, bend=0.012)

# Kindling leaning in against the pile.
for i in range(5):
    a = rng.uniform(0, math.tau)
    base_r = rng.uniform(0.22, 0.30)
    base = Vector((math.cos(a) * base_r, math.sin(a) * base_r, 0.045))
    apex = Vector((math.cos(a) * 0.05, math.sin(a) * 0.05, rng.uniform(0.28, 0.36)))
    add_log(base, apex, 0.014, 0.010, seg=8, rings=5, bend=0.008, kind="stick")


# ----------------------------------------------------------------------------- ash bed
ash = Acc()
SEG = 28
verts, cols, faces, uvs = [(0.0, 0.0, 0.036)], [(0.045, 0.043, 0.042)], [], []
inner, rim = [], []
phase = rng.uniform(0, math.tau)
for k in range(SEG):
    ang = math.tau * k / SEG
    rad = (0.33 + 0.04 * math.sin(ang * 3 + phase) + 0.025 * math.sin(ang * 5 + phase * 2) + rng.uniform(-0.03, 0.03))
    t = rng.uniform(0.6, 1.5)
    verts.append((math.cos(ang) * rad * 0.82, math.sin(ang) * rad * 0.82, 0.014 + rng.uniform(-0.004, 0.006)))
    cols.append((0.07 * t, 0.068 * t, 0.066 * t))
    inner.append(len(verts) - 1)
for k in range(SEG):
    ang = math.tau * k / SEG
    rad = (0.33 + 0.04 * math.sin(ang * 3 + phase) + 0.025 * math.sin(ang * 5 + phase * 2) + rng.uniform(-0.03, 0.03)) * 1.12
    verts.append((math.cos(ang) * rad, math.sin(ang) * rad, -0.07))  # buried rim, so no gap on a slope
    cols.append((0.10, 0.095, 0.09))
    rim.append(len(verts) - 1)
for k in range(SEG):
    k2 = (k + 1) % SEG
    faces.append((0, inner[k], inner[k2]))
    ang0, ang1 = math.tau * k / SEG, math.tau * k2 / SEG
    uvs.append([(0.5, 0.5), (0.5 + 0.4 * math.cos(ang0), 0.5 + 0.4 * math.sin(ang0)), (0.5 + 0.4 * math.cos(ang1), 0.5 + 0.4 * math.sin(ang1))])
    faces.append((inner[k], rim[k], rim[k2], inner[k2]))
    uvs.append([(0.5 + 0.4 * math.cos(ang0), 0.5 + 0.4 * math.sin(ang0)), (0.5 + 0.5 * math.cos(ang0), 0.5 + 0.5 * math.sin(ang0)),
                (0.5 + 0.5 * math.cos(ang1), 0.5 + 0.5 * math.sin(ang1)), (0.5 + 0.4 * math.cos(ang1), 0.5 + 0.4 * math.sin(ang1))])
ash.add(verts, faces, uvs, cols)
build("Ash", ash, MAT_CHAR)


# ----------------------------------------------------------------------------- coals
# A heap of dark charred lumps with glowing cracks, sitting under the logs. The glow is the emissive
# texture on the Ember material: the game turns it up when lit and off when cold.
embers = Acc()
N_COALS = 16
for i in range(N_COALS):
    ang = rng.uniform(0, math.tau)
    rad = 0.26 * math.sqrt(rng.uniform(0.0, 1.0))
    size = rng.uniform(0.028, 0.055)
    cx, cy = math.cos(ang) * rad, math.sin(ang) * rad
    cz = 0.012 + size * 0.45 + 0.03 * (1.0 - rad / 0.26)  # heaped a little toward the middle
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    seed_off = Vector(rng.uniform(-50, 50, 3).tolist())
    squash = rng.uniform(0.55, 0.85)
    yaw = rng.uniform(0, math.tau)
    for v in bm.verts:
        q = v.co.copy()
        q *= 1.0 + 0.28 * noise.noise(q * 1.6 + seed_off)
        q.z *= squash
        x, y = q.x * math.cos(yaw) - q.y * math.sin(yaw), q.x * math.sin(yaw) + q.y * math.cos(yaw)
        v.co = Vector((cx + x * size * 1.15, cy + y * size, cz + q.z * size))
    bm.normal_update()
    verts, cols, faces, uvs = [], [], [], []
    for v in bm.verts:
        verts.append(tuple(v.co))
        cols.append((1, 1, 1))
    for f in bm.faces:
        faces.append(tuple(v.index for v in f.verts))
        n = f.normal
        axis = np.argmax(np.abs([n.x, n.y, n.z]))
        uvs.append([((q.y, q.z) if axis == 0 else (q.x, q.z) if axis == 1 else (q.x, q.y)) for q in (v.co for v in f.verts)])
        uvs[-1] = [(u * 7.0, w * 7.0) for u, w in uvs[-1]]
    embers.add(verts, faces, uvs, cols)
    bm.free()

build("Stones", stones, MAT_STONE)
build("Logs", logs, MAT_BARK, flip=True)  # add_log winds its quads inward; flip so normals face out
build("Embers", embers, MAT_EMBER)

anchor = bpy.data.objects.new("FlameAnchor", None)
anchor.empty_display_type = "PLAIN_AXES"
anchor.location = (0, 0, 0.14)
bpy.context.scene.collection.objects.link(anchor)

print("TRIS Stones %d Logs %d Ash %d Embers %d total %d" % (
    stones.tris(), logs.tris(), ash.tris(), embers.tris(), stones.tris() + logs.tris() + ash.tris() + embers.tris()))

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", export_yup=True, export_apply=False,
    export_lights=False, export_cameras=False, export_vertex_color="MATERIAL",
    export_normals=True, export_tangents=False, export_texcoords=True,
    export_image_format="AUTO", export_materials="EXPORT", export_extras=False)
print("EXPORTED", OUT)
