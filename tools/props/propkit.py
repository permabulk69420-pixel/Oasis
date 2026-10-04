"""Shared helpers for the hand-built Blender props (pickaxe, bones, ...). The spear's script (tools/spear/build_spear.py) has the
original copy of these; new props import this one:

    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "props"))
    from propkit import *

Everything is plain numpy plus a few bpy calls at the end (make_object, smooth_by_angle, export_glb), so a shape can be built and
measured without opening Blender's UI. Frame: the props are built directly in glTF axes (exported with "Y up" off, so nothing is
converted): +Y up, +Z toward the viewer, metres. Colours live in the vertices (a "Col" colour attribute, linear RGB) and a material
named "Glow" is the one emissive material, so the game can keep it bright at night (src/glow.js).
"""
import math
import os
import sys

import numpy as np

A = sys.argv


def opt(name, default):
    return A[A.index(name) + 1] if name in A else default


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


class Shape:
    """Every closed shell of a prop with a colour on each vertex. Faces carry a material index (M) and a part index (P)."""

    def __init__(self):
        self.V, self.C, self.F, self.M, self.P = [], [], [], [], []
        self.flat = set()   # indices of faces to shade flat (faceted stone)
        self.shells = 0

    def tris(self, part=None, mat=None):
        return sum(len(f) - 2 for f, m, p in zip(self.F, self.M, self.P)
                   if (part is None or p == part) and (mat is None or m == mat))

    def shell(self, rings, colours, mat=0, part=0, flat=False):
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
                # the two caps face opposite ways: the far end looks along the way the rings run, the near end looks back
                faces.append((ci, base + end * K + k, base + end * K + k2) if end else (ci, base + end * K + k2, base + end * K + k))
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


def tube(S, path, radii, K, hint, colour, p=2.0, phase=0.0, mat=0, part=0, jitter=None, flat=False):
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


def sphere(S, c, r, mat, colour, K=8, rings=7, axis=UP, part=0):
    """A closed bead: a stack of rings whose radius follows a half circle."""
    a = norm(np.cross(axis, np.array([1.0, 0.0, 0.0])))
    path, radii = [], []
    for i in range(rings):
        t = (i + 0.5) / rings
        path.append(c + axis * r * math.cos(math.pi * t))
        s = math.sin(math.pi * t) * r
        radii.append((s, s))
    tube(S, path, radii, K, a, colour, 2.0, mat=mat, part=part)


def lumpy(amount, seed):
    """A jitter that nudges every vertex of a ring in or out a little, so a tube is not a perfect lathe turning."""
    def apply(ring, c, i):
        out = []
        for k, q in enumerate(ring):
            out.append(c + (q - c) * (1.0 + amount * noise3((k, i, 0.5), seed)))
        return np.array(out)
    return apply


# ----------------------------------------------------------------------------- Blender side (import bpy only when called)
def make_materials(name="Prop", base_roughness=0.90, glow_colour=(0.25, 0.95, 1.0)):
    """Two materials: a vertex-coloured base (called `name`) and an emissive 'Glow'."""
    import bpy
    prop = bpy.data.materials.new(name)
    prop.use_nodes = True
    nt = prop.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = base_roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.25
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    prop.use_backface_culling = True

    glow = bpy.data.materials.new("Glow")
    glow.use_nodes = True
    gb = glow.node_tree.nodes["Principled BSDF"]
    gb.inputs["Roughness"].default_value = 0.5
    gb.inputs["Base Color"].default_value = (0.02, 0.08, 0.10, 1)
    gb.inputs["Emission Color"].default_value = (*glow_colour, 1)
    gb.inputs["Emission Strength"].default_value = 1.0
    glow.use_backface_culling = True
    return prop, glow


def make_object(S, part, name, mats):
    """The faces of one part as a Blender object with a 'Col' colour attribute. Returns (object, indices of flat faces)."""
    import bpy
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
    import bpy
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(degrees))
    except Exception:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(degrees))


def export_glb(path):
    import bpy
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_yup=False, export_apply=False,
        export_lights=False, export_cameras=False, export_animations=False, export_skins=False,
        export_vertex_color="MATERIAL", export_normals=True, export_tangents=False, export_texcoords=False,
        export_materials="EXPORT", export_extras=False)
    print("EXPORTED", path, f"{os.path.getsize(path)} bytes")
