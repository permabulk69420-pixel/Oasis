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
    rgb = ramp(t, [(0, (0.060, 0.045, 0.036)), (0.35, (0.17, 0.13, 0.10)), (0.7, (0.33, 0.27, 0.21)), (1, (0.46, 0.39, 0.31))])
    return np.clip(rgb, 0, 1)


def make_stone(n=512):
    big = periodic_noise(n, (1.0, 1.0), 2.2, 11)
    mid = periodic_noise(n, (3.0, 3.0), 1.6, 12)
    fine = periodic_noise(n, (9.0, 9.0), 1.0, 13)
    speck = (periodic_noise(n, (22.0, 22.0), 0.6, 14) > 0.55).astype(float)
    t = 0.5 + 0.30 * big + 0.18 * mid + 0.10 * fine
    rgb = ramp(t, [(0, (0.20, 0.19, 0.18)), (0.5, (0.38, 0.36, 0.32)), (1, (0.60, 0.56, 0.49))])
    rgb *= (1.0 - 0.35 * speck)[..., None]
    return np.clip(rgb, 0, 1)


TEXDIR = tempfile.mkdtemp(prefix="campfire_tex_")


def load_image(name, rgb):
    path = os.path.join(TEXDIR, name + ".png")
    n = rgb.shape[0]
    rgba = np.concatenate([np.clip(rgb, 0, 1) ** (1 / 2.2), np.ones((n, n, 1))], -1)  # store sRGB
    img = bpy.data.images.new(name, n, n, alpha=False)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def make_mat(name, rgb=None, base=(0.5, 0.5, 0.5), rough=0.9, emissive=None, vcol=True):
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
    if emissive is not None:
        bsdf.inputs["Emission Color"].default_value = (*emissive, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return m


MAT_STONE = make_mat("Stone", make_stone(), rough=0.86)
MAT_BARK = make_mat("Bark", make_bark(), rough=0.92)
MAT_CHAR = make_mat("Char", None, base=(0.05, 0.05, 0.05), rough=0.96)
MAT_EMBER = make_mat("Ember", None, base=(0.03, 0.012, 0.006), rough=0.7, emissive=(1.0, 0.28, 0.04), vcol=False)


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


def build(name, acc, mat, smooth=True):
    V = np.concatenate(acc.V)
    C = np.concatenate(acc.C)
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], acc.F)
    uv = me.uv_layers.new(name="UVMap")
    flat = np.concatenate([np.asarray(u, float).reshape(-1, 2) for u in acc.UV])
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
N_STONES = 10
RING_R = 0.43
phase = rng.uniform(0, math.tau)
for i in range(N_STONES):
    a = phase + i * math.tau / N_STONES + rng.uniform(-0.12, 0.12)
    r = RING_R + rng.uniform(-0.035, 0.035)
    sx, sy, sz = rng.uniform(0.10, 0.16), rng.uniform(0.09, 0.14), rng.uniform(0.065, 0.10)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    seed_off = Vector(rng.uniform(-50, 50, 3).tolist())
    yaw = rng.uniform(0, math.tau)
    tilt = rng.uniform(-0.18, 0.18), rng.uniform(-0.18, 0.18)
    center = Vector((math.cos(a) * r, math.sin(a) * r, sz * 0.80 - 0.035))
    for v in bm.verts:
        p = v.co.copy()
        d = 1.0 + 0.30 * noise.noise(p * 1.3 + seed_off) + 0.10 * noise.noise(p * 3.1 + seed_off)
        p *= d
        p.x *= sx
        p.y *= sy
        p.z *= sz
        if p.z < -sz * 0.25:  # flatten the underside so it sits
            p.z = -sz * 0.25 + (p.z + sz * 0.25) * 0.25
        # rotate: yaw then slight tilt
        c, s = math.cos(yaw), math.sin(yaw)
        x, y = p.x * c - p.y * s, p.x * s + p.y * c
        z = p.z
        y, z = y * math.cos(tilt[0]) - z * math.sin(tilt[0]), y * math.sin(tilt[0]) + z * math.cos(tilt[0])
        x, z = x * math.cos(tilt[1]) + z * math.sin(tilt[1]), -x * math.sin(tilt[1]) + z * math.cos(tilt[1])
        v.co = Vector((x, y, z)) + center
    bm.normal_update()
    verts, cols, faces, uvs = [], [], [], []
    shade = rng.uniform(0.72, 1.08)
    warm = rng.uniform(-0.04, 0.05)
    for v in bm.verts:
        verts.append(tuple(v.co))
        # darker near the fire-facing inside and slightly soot-stained near the ground
        inward = max(0.0, -(v.co.x * math.cos(a) + v.co.y * math.sin(a)) + r) / max(r, 1e-3)
        soot = 1.0 - 0.45 * smoothstep(0.0, 0.14, 0.14 - v.co.z) * 0.0
        k = shade * (1.0 - 0.35 * smoothstep(0.0, 0.25, inward * 0.4))
        cols.append((k * (1 + warm), k, k * (1 - warm)))
    scale = 1.0 / 0.55  # metres -> texture tiles
    for f in bm.faces:
        idx = [v.index for v in f.verts]
        faces.append(tuple(idx))
        n = f.normal
        axis = np.argmax(np.abs([n.x, n.y, n.z]))
        face_uv = []
        for v in f.verts:
            p = v.co
            if axis == 0:
                face_uv.append((p.y * scale, p.z * scale))
            elif axis == 1:
                face_uv.append((p.x * scale, p.z * scale))
            else:
                face_uv.append((p.x * scale, p.y * scale))
        uvs.append(face_uv)
    stones.add(verts, faces, uvs, cols)
    bm.free()


# ----------------------------------------------------------------------------- logs
logs = Acc()
CHAR_CENTRE = Vector((0.0, 0.0, 0.12))


def add_log(p0, p1, r0, r1, seg=10, rings=9, bend=0.012, stub=True, kind="log"):
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
            dist = (p - CHAR_CENTRE).length
            char = 1.0 - 0.80 * (1.0 - smoothstep(0.10, 0.34, dist)) if kind != "stick" else 1.0 - 0.6 * (1.0 - smoothstep(0.05, 0.25, dist))
            # a bit of per-vertex variation so the char breaks up
            char *= 1.0 + 0.18 * noise.noise(Vector(tuple(p * 9.0)) + seed_off)
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
        dist = (centre - CHAR_CENTRE).length
        char = 1.0 - 0.8 * (1.0 - smoothstep(0.10, 0.34, dist))
        cols.append((char * 1.25,) * 3)
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
    apex = Vector((math.cos(a + math.pi) * 0.04, math.sin(a + math.pi) * 0.04, rng.uniform(0.40, 0.47)))
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
    add_log(base, apex, 0.014, 0.010, seg=6, rings=4, bend=0.008, kind="stick")


# ----------------------------------------------------------------------------- ash bed
ash = Acc()
verts, cols, faces, uvs = [(0.0, 0.0, 0.034)], [(0.18,) * 3], [], []
SEG = 20
rim = []
phase = rng.uniform(0, math.tau)
for k in range(SEG):
    ang = math.tau * k / SEG
    rad = 0.34 + 0.03 * math.sin(ang * 3 + phase) + rng.uniform(-0.015, 0.015)
    verts.append((math.cos(ang) * rad, math.sin(ang) * rad, 0.004))
    t = rng.uniform(0.35, 0.8)
    cols.append((0.22 * t * 2,) * 3)
    rim.append(len(verts) - 1)
for k in range(SEG):
    k2 = (k + 1) % SEG
    faces.append((0, rim[k], rim[k2]))
    ang0, ang1 = math.tau * k / SEG, math.tau * k2 / SEG
    uvs.append([(0.5, 0.5), (0.5 + 0.5 * math.cos(ang0), 0.5 + 0.5 * math.sin(ang0)), (0.5 + 0.5 * math.cos(ang1), 0.5 + 0.5 * math.sin(ang1))])
ash.add(verts, faces, uvs, cols)
build("Ash", ash, MAT_CHAR)


# ----------------------------------------------------------------------------- embers
embers = Acc()
ember_spots = [(0.02, 0.01, 0.040, 0.075), (-0.12, 0.09, 0.034, 0.050), (0.13, -0.07, 0.034, 0.055),
               (-0.06, -0.14, 0.032, 0.045), (0.09, 0.14, 0.032, 0.042), (-0.18, -0.03, 0.030, 0.034),
               (0.19, 0.05, 0.030, 0.034), (0.0, -0.05, 0.080, 0.030)]
for (ex, ey, ez, er) in ember_spots:
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=7, v_segments=4, radius=1.0)
    seed_off = Vector(rng.uniform(-50, 50, 3).tolist())
    for v in bm.verts:
        p = v.co.copy()
        p *= 1.0 + 0.30 * noise.noise(p * 1.7 + seed_off)
        v.co = Vector((ex + p.x * er, ey + p.y * er * rng.uniform(0.8, 1.2), ez + p.z * er * 0.35))
    bm.normal_update()
    verts, cols, faces, uvs = [], [], [], []
    for v in bm.verts:
        verts.append(tuple(v.co))
        cols.append((1, 1, 1))
    for f in bm.faces:
        faces.append(tuple(v.index for v in f.verts))
        uvs.append([(0.5, 0.5)] * len(f.verts))
    embers.add(verts, faces, uvs, cols)
    bm.free()

build("Stones", stones, MAT_STONE)
build("Logs", logs, MAT_BARK)
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
