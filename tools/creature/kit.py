#!/usr/bin/env python3
"""Shared Blender kit for hand-built, procedural, skinned creatures (the dune stinger v3 uses it; the next creature can too).

Everything is authored in game space: metres, +X is the creature's left, +Y is up, +Z is forward, feet on y = 0. The kit converts to
Blender's frame when it builds the scene and the glTF exporter converts back, so the exported file has the same axes as the authoring code.

What it gives you
  Geo                  a bag of closed, outward-wound shells with per-vertex bone weights, colours and a material index
  sweep / spike / ball closed lofts along a path (elliptical or custom sections), tapering spikes and spheres
  build_scene          Blender mesh + armature (every bone has an identity rest rotation) + vertex colours + two materials
  export_glb           skinned GLB, no animation, no UVs; the Glow primitive carries no colour attribute
  audit                independent inspection of the exported file (topology, weights, joint frames, axes, budgets) + a trimesh re-open
  render_setup/view    Cycles studio render for a look (render-only floor, lights and camera are never exported)

Needs bpy (4.5), numpy, Pillow (renders), trimesh (audit). `import bpy` must come before `import bmesh`.
"""
import bpy  # Must precede bmesh.
import bmesh  # noqa: F401
import collections, json, math, os, struct
from pathlib import Path
import numpy as np
from mathutils import Vector

PI = math.pi
TAU = 2 * PI


def lerp(a, b, t): return a * (1 - t) + b * t


def tint(c, f): return tuple(min(1, max(0, v * f)) for v in c)


def mix(a, b, t): return tuple(lerp(x, y, t) for x, y in zip(a, b))


def sstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def sgnpow(v, p): return math.copysign(abs(v) ** p, v)


def gauss(x, w): return math.exp(-(x / w) ** 2)


def bumps(th, count, off, width, amp):
    """1 + amp at `count` evenly spaced angles round a section (0 elsewhere): ridges, keels."""
    s = 0.0
    for c in range(count):
        d = (th - off - TAU * c / count + PI) % TAU - PI
        s += math.exp(-(d / width) ** 2)
    return 1 + amp * s


def to_blender(p): return (p[0], -p[2], p[1])


class Geo:
    """Closed shells. `weights` are dicts {bone: weight} (one per vertex, or one for the whole shell)."""

    def __init__(self):
        self.v = []; self.f = []; self.col = []; self.w = []; self.mat = []; self.parts = []

    def shell(self, name, vertices, faces, weights, colors, material=0):
        vertices = [tuple(v) for v in vertices]
        tri = []
        for f in faces:
            for j in range(1, len(f) - 1): tri.append((f[0], f[j], f[j + 1]))
        vv = np.array(vertices)
        vol = sum(np.dot(vv[a], np.cross(vv[b], vv[c])) for a, b, c in tri) / 6
        if vol < 0: tri = [tuple(reversed(f)) for f in tri]
        off = len(self.v)
        self.v.extend(vertices); self.f.extend(tuple(i + off for i in f) for f in tri)
        self.w.extend(weights if isinstance(weights, list) else [weights] * len(vertices))
        self.col.extend(colors if isinstance(colors, list) else [colors] * len(vertices))
        self.mat.extend([material] * len(tri))
        self.parts.append({'name': name, 'vertices': [off, len(self.v)], 'triangles': len(tri)})

    def rings(self, name, rings, weights, colors, material=0):
        """A closed shell from rings of equal size. The two end caps are fanned from a point in their middle (one extra vertex each),
        so a cap whose outline is not convex (a ridge across a section) still triangulates without overlapping."""
        n = len(rings[0]); nr = len(rings)
        verts = [v for r in rings for v in r]
        ws = weights if isinstance(weights, list) else [weights] * len(verts)
        cs = colors if isinstance(colors, list) else [colors] * len(verts)
        faces = []
        for k in range(nr - 1):
            for j in range(n):
                a = k * n + j; b = k * n + (j + 1) % n
                faces.append((a, b, b + n, a + n))
        for ring_index, base in ((0, 0), (1, (nr - 1) * n)):
            ring = verts[base:base + n]
            centre = tuple(sum(p[i] for p in ring) / n for i in range(3))
            merged = collections.defaultdict(float)
            for w in ws[base:base + n]:
                for key, value in w.items(): merged[key] += value / n
            c = len(verts); verts.append(centre); ws = list(ws); ws.append(dict(merged))
            cs = list(cs); cs.append(tuple(sum(col[i] for col in cs[base:base + n]) / n for i in range(3)))
            for j in range(n):
                if ring_index == 0: faces.append((c, base + (j + 1) % n, base + j))
                else: faces.append((c, base + j, base + (j + 1) % n))
        self.shell(name, verts, faces, ws, cs, material)

    def triangles(self):
        return len(self.f)


def _frames(pp, up, transport):
    out = []; u_prev = None
    for k in range(len(pp)):
        t = (pp[min(k + 1, len(pp) - 1)] - pp[max(k - 1, 0)]).normalized()
        if u_prev is None:
            ref = up if abs(t.dot(up)) < 0.92 else (Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 0, 1)))
        else:
            ref = u_prev if transport else up
            if abs(t.dot(ref)) > 0.97: ref = u_prev if u_prev is not None else Vector((1, 0, 0))
        u = (ref - t * ref.dot(t)).normalized(); v = t.cross(u).normalized()
        out.append((t, u, v)); u_prev = u
    return out


def sweep(g, name, points, radii, n, weights, color, material=0, phase=0, shape=None, up=(0, 1, 0), transport=False):
    """A closed loft: one elliptical section per path point, radii (a along u, b along v), optional radial multiplier
    shape(k, j, theta), optional colour function color(k, j, n). `weights` may be a list (one dict per ring) or one dict."""
    pp = [Vector(p) for p in points]
    fr = _frames(pp, Vector(up), transport)
    rings = []; cc = []; ww = []
    for k, p in enumerate(pp):
        t, u, v = fr[k]
        a, b = radii[k] if isinstance(radii[k], tuple) else (radii[k], radii[k])
        ring = []
        for j in range(n):
            th = TAU * j / n + phase
            m = shape(k, j, th) if shape else 1.0
            ring.append(p + u * (a * m * math.cos(th)) + v * (b * m * math.sin(th)))
            cc.append(color(k, j, n) if callable(color) else color)
        rings.append(ring)
        wk = weights[k] if isinstance(weights, list) else weights
        ww.extend([wk] * n)
    g.rings(name, rings, ww, cc, material)


def spike(g, name, base, tip, width, thick, wt, color, n=4, lift=None, material=0, up=(0, 1, 0)):
    """A closed spike: wide at the base, sharp at the tip, optionally bent by a lifted midpoint."""
    a = Vector(base); b = Vector(tip); m = a.lerp(b, .5) + (Vector(lift) if lift else Vector((0, 0, 0)))
    sweep(g, name, [a, m, b], [(width, thick), (width * .55, thick * .55), (width * .04, thick * .04)], n, wt, color, material, up=up)


def ball(g, name, centre, radius, wt, color, n=10, rings=7, material=0, squash=(1, 1, 1)):
    """A closed sphere (lat/long rings along Y)."""
    c = Vector(centre); ks = [-0.82, -0.5, -0.15, 0.15, 0.5, 0.82] if rings == 6 else [(-1 + 2 * (i + .5) / rings) * 0.9 for i in range(rings)]
    pts = [c + Vector((0, radius * squash[1] * k, 0)) for k in ks]
    rr = [(radius * squash[0] * math.sqrt(1 - k * k), radius * squash[2] * math.sqrt(1 - k * k)) for k in ks]
    sweep(g, name, pts, rr, n, wt, color, material, up=(0, 0, 1))


# ----------------------------------------------------------------------------------------------------------------- the Blender scene

def build_scene(bones, geo, materials_fn, skeleton_name='Skeleton', mesh_name='Creature'):
    """`bones` is [(name, (x, y, z), parent_or_None)] in game space. Every edit bone points up its own +Z, so each exported joint
    has an identity rest rotation and a bone rotation is a rotation about the creature's own axes."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arm = bpy.data.armatures.new(skeleton_name + 'Armature'); rig = bpy.data.objects.new(skeleton_name, arm)
    bpy.context.collection.objects.link(rig); bpy.context.view_layer.objects.active = rig; rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, p, parent in bones:
        b = arm.edit_bones.new(name); b.head = Vector(to_blender(p)); b.tail = b.head + Vector((0, 0, .04)); b.roll = 0
        if parent: b.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT'); rig.select_set(False)
    verts = [to_blender(v) for v in geo.v]
    mesh = bpy.data.meshes.new(mesh_name + 'Geometry'); mesh.from_pydata(verts, [], geo.f); mesh.update()
    obj = bpy.data.objects.new(mesh_name, mesh); bpy.context.collection.objects.link(obj)
    for m in materials_fn(): mesh.materials.append(m)
    attr = mesh.color_attributes.new(name='Col', type='BYTE_COLOR', domain='POINT')
    for i, c in enumerate(geo.col): attr.data[i].color = (*c, 1)
    for i, p in enumerate(mesh.polygons): p.material_index = geo.mat[i]; p.use_smooth = True
    mesh.set_sharp_from_angle(angle=1.10)
    for name, _, _ in bones: obj.vertex_groups.new(name=name)
    for i, wt in enumerate(geo.w):
        for name, w in wt.items(): obj.vertex_groups[name].add([i], w, 'REPLACE')
    mod = obj.modifiers.new('Skin', 'ARMATURE'); mod.object = rig; obj.parent = rig
    bpy.context.view_layer.objects.active = obj; obj.select_set(True); rig.select_set(True)
    return obj, rig


def default_materials(roughness=.46, metallic=.22, glow=(.25, .95, 1.)):
    st = bpy.data.materials.new('Stinger'); st.use_nodes = True; st.use_backface_culling = True
    bs = st.node_tree.nodes.get('Principled BSDF'); bs.inputs['Roughness'].default_value = roughness; bs.inputs['Metallic'].default_value = metallic
    vc = st.node_tree.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    st.node_tree.links.new(vc.outputs['Color'], bs.inputs['Base Color'])
    gl = bpy.data.materials.new('Glow'); gl.use_nodes = True; gl.use_backface_culling = True
    bs = gl.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value = (.02, .08, .10, 1)
    bs.inputs['Emission Color'].default_value = (*glow, 1.); bs.inputs['Emission Strength'].default_value = 1.
    bs.inputs['Roughness'].default_value = .38
    return st, gl


# ----------------------------------------------------------------------------------------------------------------- GLB reading / export

def read_glb(path):
    raw = Path(path).read_bytes(); assert raw[:4] == b'glTF'
    jlen, jtype = struct.unpack_from('<II', raw, 12); doc = json.loads(raw[20:20 + jlen])
    offset = 20 + jlen; blen, btype = struct.unpack_from('<II', raw, offset)
    return doc, bytearray(raw[offset + 8:offset + 8 + blen])


def export_glb(path):
    settings = dict(filepath=str(path), export_format='GLB', use_selection=True,
                    export_yup=True, export_animations=False, export_skins=True, export_normals=True,
                    export_tangents=False, export_texcoords=False, export_materials='EXPORT',
                    export_cameras=False, export_lights=False, export_extras=False, export_apply=True,
                    export_draco_mesh_compression_enable=False, export_def_bones=True,
                    export_armature_object_remove=True, export_leaf_bone=False,
                    export_all_vertex_colors=False, export_vertex_color='MATERIAL')
    supported = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    bpy.ops.export_scene.gltf(**{k: v for k, v in settings.items() if k in supported})
    # Blender 4.5 adds a dummy all-white COLOR_0 to a non-coloured primitive sharing a mesh with a coloured one; drop it from Glow.
    doc, blob = read_glb(path)
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            if doc['materials'][prim['material']]['name'] == 'Glow':
                prim['attributes'].pop('COLOR_0', None)
    jb = json.dumps(doc, separators=(',', ':')).encode(); jb += b' ' * ((-len(jb)) % 4)
    blob += b'\0' * ((-len(blob)) % 4)
    Path(path).write_bytes(struct.pack('<4sII', b'glTF', 2, 28 + len(jb) + len(blob)) + struct.pack('<II', len(jb), 0x4e4f534a) + jb + struct.pack('<II', len(blob), 0x004e4942) + blob)


def accessor(doc, blob, index):
    ac = doc['accessors'][index]; bv = doc['bufferViews'][ac['bufferView']]
    typ = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1', 5122: '<i2', 5120: 'i1'}[ac['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[ac['type']]
    offset = bv.get('byteOffset', 0) + ac.get('byteOffset', 0); dt = np.dtype(typ)
    a = np.ndarray((ac['count'], n), dtype=dt, buffer=blob, offset=offset, strides=(bv.get('byteStride', n * dt.itemsize), dt.itemsize)).copy()
    if ac.get('normalized'): a = a / np.iinfo(dt).max
    return a


def node_matrix(n):
    if 'matrix' in n: return np.array(n['matrix']).reshape(4, 4).T
    from mathutils import Quaternion
    q = n.get('rotation', [0, 0, 0, 1]); r = np.array(Quaternion((q[3], *q[:3])).to_matrix())
    m = np.eye(4); m[:3, :3] = r @ np.diag(n.get('scale', [1, 1, 1])); m[:3, 3] = n.get('translation', [0, 0, 0]); return m


def world_matrices(doc):
    parent = {c: i for i, n in enumerate(doc['nodes']) for c in n.get('children', [])}; cache = {}

    def world(i):
        if i not in cache: cache[i] = (world(parent[i]) if i in parent else np.eye(4)) @ node_matrix(doc['nodes'][i])
        return cache[i]
    return [world(i) for i in range(len(doc['nodes']))], parent


def overlap_area(a, b):
    """2D convex triangle intersection area, ignoring shared boundaries."""
    cross = lambda u, v: float(u[0] * v[1] - u[1] * v[0])
    if cross(b[1] - b[0], b[2] - b[0]) < 0: b = b[::-1]
    poly = list(a)
    for i in range(3):
        aa = b[i]; bb = b[(i + 1) % 3]; res = []
        if not poly: return 0.
        for k, p in enumerate(poly):
            q = poly[(k + 1) % len(poly)]; dp = cross(bb - aa, p - aa); dq = cross(bb - aa, q - aa)
            if dp >= -1e-10: res.append(p)
            if (dp > 0 and dq < 0) or (dp < 0 and dq > 0): res.append(p + (q - p) * dp / (dp - dq))
        poly = res
    return abs(sum(cross(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))) / 2) if len(poly) > 2 else 0.


def audit(path, lod, budget, file_budget=2_000_000, max_joints=64, head='Head', tail_base='Tail1'):
    """Independent GLB binary inspection, plus a re-open with trimesh. Returns a dict with a `failures` list (empty = pass)."""
    import trimesh
    path = Path(path)
    doc, blob = read_glb(path); world, parent = world_matrices(doc)
    skin = doc['skins'][0]; joints = skin['joints']
    allv = []; allf = []; weightmax = 0; sumerr = 0; invalid = 0; normerr = 0; primcounts = []
    for prim in doc['meshes'][0]['primitives']:
        at = prim['attributes']; v = accessor(doc, blob, at['POSITION']); f = accessor(doc, blob, prim['indices']).reshape(-1, 3)
        allf.extend(f + len(allv)); allv.extend(v); primcounts.append(len(f))
        w = accessor(doc, blob, at['WEIGHTS_0']); ji = accessor(doc, blob, at['JOINTS_0'])
        weightmax = max(weightmax, int((w > 1e-7).sum(axis=1).max())); sumerr = max(sumerr, float(abs(w.sum(axis=1) - 1).max()))
        invalid += int(np.sum((w < 0) | (~np.isfinite(w)) | ((w > 0) & (ji >= len(joints)))))
        invalid += int(np.sum(w.sum(axis=1) < 1e-7))
        no = accessor(doc, blob, at['NORMAL']); normerr = max(normerr, float(abs(np.linalg.norm(no, axis=1) - 1).max()))
    v = np.array(allv); f = np.array(allf, dtype=int)
    # glTF splits material/normal/colour seams. Weld positions to check physical topology.
    _, first, inv = np.unique(np.round(v, 7), axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    vv = v[first]; ff = inv[f]; edges = collections.defaultdict(list)
    for i, t in enumerate(ff):
        for a, b in zip(t, np.roll(t, -1)): edges[tuple(sorted((int(a), int(b))))].append((i, int(a), int(b)))
    boundary = sum(len(e) == 1 for e in edges.values()); nonman = sum(len(e) != 2 for e in edges.values())
    inconsistent = sum(len(e) == 2 and e[0][1:] == e[1][1:] for e in edges.values())
    loose = len(vv) - len(np.unique(ff)); area = np.linalg.norm(np.cross(vv[ff[:, 1]] - vv[ff[:, 0]], vv[ff[:, 2]] - vv[ff[:, 0]]), axis=1) * .5
    zero = int(np.sum(area < 1e-12)); dup = len(ff) - len({tuple(sorted(t)) for t in ff})
    adj = [set() for _ in ff]
    for ee in edges.values():
        for x in ee:
            for y in ee:
                if x[0] != y[0]: adj[x[0]].add(y[0])
    unseen = set(range(len(ff))); volumes = []
    while unseen:
        stack = [unseen.pop()]; component = []
        while stack:
            i = stack.pop(); component.append(i)
            for k in adj[i]:
                if k in unseen: unseen.remove(k); stack.append(k)
        tt = ff[component]; volumes.append(float(np.sum(np.einsum('ij,ij->i', vv[tt[:, 0]], np.cross(vv[tt[:, 1]], vv[tt[:, 2]]))) / 6))
    # Group nearly identical geometric planes and detect positive-area overlap.
    tri = vv[ff]; nn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); nn /= np.maximum(np.linalg.norm(nn, axis=1), 1e-30)[:, None]
    groups = collections.defaultdict(list)
    for i, n in enumerate(nn):
        axis = int(np.argmax(abs(n))); n = n if n[axis] > 0 else -n; d = float(n @ tri[i, 0])
        key = tuple(np.round(np.r_[n, d], 5)); groups[key].append((i, axis))
    coplanar = 0; overlap_details = []
    for gg in groups.values():
        for k, (a, ax) in enumerate(gg):
            aa = np.delete(tri[a], ax, axis=1)
            for b, _ in gg[k + 1:]:
                bb = np.delete(tri[b], ax, axis=1)
                if np.any(aa.max(axis=0) < bb.min(axis=0) - 1e-9) or np.any(bb.max(axis=0) < aa.min(axis=0) - 1e-9): continue
                if overlap_area(aa, bb) > 1e-10:
                    coplanar += 1; overlap_details.append([tri[a].mean(axis=0).tolist(), tri[b].mean(axis=0).tolist()])
    names = [doc['nodes'][i]['name'] for i in joints]
    rot_err = max(float(abs(world[i][:3, :3] - np.eye(3)).max()) for i in joints)
    ibm = accessor(doc, blob, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    binderr = max(float(abs(world[i] @ ibm[k] - np.eye(4)).max()) for k, i in enumerate(joints))
    meshnode = next(n for n in doc['nodes'] if 'mesh' in n)
    imported = trimesh.load(str(path), force='scene', process=False)
    headp = world[next(i for i in joints if doc['nodes'][i]['name'] == head)][:3, 3]
    rear = world[next(i for i in joints if doc['nodes'][i]['name'] == tail_base)][:3, 3]
    left = [float(world[i][0, 3]) for i in joints if '_L_' in doc['nodes'][i]['name'] or doc['nodes'][i]['name'].endswith('_L')]
    right = [float(world[i][0, 3]) for i in joints if '_R_' in doc['nodes'][i]['name'] or doc['nodes'][i]['name'].endswith('_R')]
    result = {'lod': lod, 'triangles': len(f), 'primitive_triangles': primcounts, 'file_bytes': path.stat().st_size,
              'bones': len(joints), 'bounds_min': v.min(axis=0).tolist(), 'bounds_max': v.max(axis=0).tolist(),
              'dimensions_xyz': np.ptp(v, axis=0).tolist(), 'trimesh_bounds': imported.bounds.tolist(),
              'closed_shells': len(volumes), 'min_signed_volume': min(volumes), 'nonpositive_shells': sum(x <= 0 for x in volumes),
              'boundary_edges': boundary, 'nonmanifold_edges': nonman, 'inconsistent_winding_edges': inconsistent,
              'loose_vertices': loose, 'zero_area_triangles': zero, 'duplicate_triangles': dup, 'coplanar_overlapping_pairs': coplanar,
              'max_weights_per_vertex': weightmax, 'max_weight_sum_error': sumerr, 'invalid_or_unweighted': invalid,
              'max_normal_length_error': normerr, 'max_joint_frame_error': rot_err, 'max_bind_matrix_error': binderr,
              'head_joint_xyz': headp.tolist(), 'tail_base_xyz': rear.tolist(), 'left_min_x': min(left), 'right_max_x': max(right),
              'mesh_transform_identity': bool(np.allclose(node_matrix(meshnode), np.eye(4), atol=1e-6)),
              'materials': doc['materials'], 'extensions': doc.get('extensionsUsed', []), 'animation_count': len(doc.get('animations', [])),
              'mesh_count': len(doc['meshes']), 'skin_count': len(doc['skins']), 'node_count': len(doc['nodes']),
              'primitive_attributes': [list(p['attributes']) for p in doc['meshes'][0]['primitives']],
              'overlap_centroids': overlap_details,
              'skeleton': [{'name': doc['nodes'][i]['name'], 'parent': doc['nodes'][parent[i]]['name'] if i in parent else None,
                            'world_position': world[i][:3, 3].tolist()} for i in joints]}
    failures = []
    for key in ['boundary_edges', 'nonmanifold_edges', 'inconsistent_winding_edges', 'loose_vertices', 'zero_area_triangles', 'duplicate_triangles', 'coplanar_overlapping_pairs', 'nonpositive_shells', 'invalid_or_unweighted']:
        if result[key]: failures.append(key)
    if len(f) > budget[lod]: failures.append('triangle_budget')
    if weightmax > 4 or sumerr > 1e-5: failures.append('weights')
    if rot_err > 1e-6 or binderr > 1e-6: failures.append('joint_frames')
    if not (headp[2] > 0 > rear[2] and min(left) > 0 and max(right) < 0 and abs(v[:, 1].min()) < 1e-6): failures.append('axes')
    if len(joints) > max_joints or len(doc['meshes']) != 1 or len(doc['skins']) != 1 or len(doc['materials']) != 2: failures.append('structure')
    if path.stat().st_size > file_budget: failures.append('file_budget')
    if doc.get('animations') or doc.get('textures') or doc.get('images') or doc.get('extensionsUsed'): failures.append('unwanted_data')
    if 'COLOR_0' not in doc['meshes'][0]['primitives'][0]['attributes'] or 'COLOR_0' in doc['meshes'][0]['primitives'][1]['attributes']: failures.append('colour_contract')
    result['failures'] = failures
    result['joint_names'] = names
    return result


# ----------------------------------------------------------------------------------------------------------------- renders

def render_setup(width=1200, samples=32, lens_scale=1.75):
    scene = bpy.context.scene; scene.render.engine = 'CYCLES'; scene.cycles.samples = int(os.environ.get('SAMPLES', samples))
    scene.cycles.use_denoising = True; scene.render.resolution_x = int(os.environ.get('RES_X', width)); scene.render.resolution_y = int(os.environ.get('RES_X', width)) * 3 // 4; scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'; scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new('StudioWorld'); scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.10, .13, .17, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .35
    scene.view_settings.view_transform = 'AgX'
    # Studio helpers are render-only and never exported.
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.008)); floor = bpy.context.object; floor.name = 'RenderOnlyFloor'
    mat = bpy.data.materials.new('RenderOnlyFloor'); mat.diffuse_color = (.037, .047, .055, 1); mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.037, .047, .055, 1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .8; floor.data.materials.append(mat)
    for name, loc, power, size, col in [('Key', (1.5, -2.1, 3.3), 260, 3., (1., .81, .60)), ('Fill', (-2, -.5, 1.5), 110, 2.5, (.48, .73, 1.)), ('Rim', (.5, 2.5, 2), 230, 2., (1., .68, .40))]:
        data = bpy.data.lights.new('RenderOnly' + name, 'AREA'); data.energy = power; data.shape = 'DISK'; data.size = size; data.color = col
        o = bpy.data.objects.new(data.name, data); bpy.context.collection.objects.link(o); o.location = loc
        o.rotation_euler = (Vector((0, 0, .2)) - o.location).to_track_quat('-Z', 'Y').to_euler()
    data = bpy.data.cameras.new('RenderOnlyCamera'); cam = bpy.data.objects.new(data.name, data); bpy.context.collection.objects.link(cam)
    scene.camera = cam; data.type = 'ORTHO'; data.ortho_scale = lens_scale
    return cam


def render_view(cam, path, loc, target, scale):
    """`loc` and `target` are in game space (x left, y up, z forward)."""
    cam.location = Vector(to_blender(loc)); tgt = Vector(to_blender(target))
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler(); cam.data.ortho_scale = scale
    bpy.context.scene.render.filepath = str(path); bpy.ops.render.render(write_still=True)
