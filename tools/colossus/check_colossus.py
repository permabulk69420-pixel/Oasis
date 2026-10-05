#!/usr/bin/env python3
"""Check a Colossus .glb against tools/colossus/BRIEF.md (no Blender needed: numpy, scipy, trimesh not required, Pillow for UVs).

    python3 tools/colossus/check_colossus.py colossus_01_lod0.glb [more.glb ...] [--json out.json] [--skip pose,uv,crystals,mesh]

The level (lod0, lod1, lod2) is read from the file name. With several files it also checks that every level has the identical
skeleton (same bone names, same rest positions). Prints PASS / WARN / FAIL / INFO lines and exits 1 if any FAIL.

What it measures, in brief order: parts, bones and hierarchy, units and orientation, the size table in section 3, symmetry across X = 0,
materials, triangle budget, skinning (rigid plates and crystals, hide blend band, influences), a bend test (each joint turned 25
degrees, looking for torn seams, stretched or collapsed hide and flipped triangles), mesh quality (closed shells, open edges, zero-area
and duplicate faces, tiny edges), UVs (range, overlap, texel density, margin), vertex colour, and the crystal hand-holds (size, count,
spacing, first holds above the soles, and whether the holds join up into routes). Written for the first Colossus, so it can be re-run on
every new attempt.
"""
import sys, os, json, math, time, argparse
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'creature'))
from check_glb import load, acc  # noqa: E402

BONES = (['root', 'pelvis'] + [f'spine_0{i}' for i in range(1, 5)] + [f'neck_0{i}' for i in range(1, 7)] + ['head', 'jaw']
         + [f'tail_0{i}' for i in range(1, 9)] + [f'leg_{s}_{p}' for s in ('FL', 'FR', 'BL', 'BR') for p in ('upper', 'lower', 'foot', 'toe')])
PARTS = ['Head', 'Jaw', 'Neck', 'Torso', 'Tail', 'Leg_FL', 'Leg_FR', 'Leg_BL', 'Leg_BR']
MATS = ['Colossus hide', 'Colossus plate', 'Colossus crystal', 'Colossus glow']
BUDGET = {0: 500_000, 1: 150_000, 2: 30_000}
LEGS = ['FL', 'FR', 'BL', 'BR']
POSE_DEG = 25.0


class Report:
    def __init__(self):
        self.lines = []
        self.data = {}

    def add(self, level, text):
        self.lines.append((level, text))
        print(f'  [{level}] {text}', flush=True)

    @property
    def failed(self):
        return any(l == 'FAIL' for l, _ in self.lines)


def to_lin(srgb):
    s = np.asarray(srgb, dtype=float)
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)


def to_srgb(lin):
    l = np.clip(np.asarray(lin, dtype=float), 0, None)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055)


def hexs(lin_rgb):
    c = np.clip(to_srgb(lin_rgb), 0, 1)
    return '#%02x%02x%02x' % tuple(int(round(v * 255)) for v in c[:3])


# ---------------------------------------------------------------------------------------------- reading
class Prim:
    pass


class Mesh:
    pass


class Model:
    pass


def quat_mat(q):
    x, y, z, w = (float(v) for v in q)
    # dtype float on purpose: a node without a rotation passes the integer default [0, 0, 0, 1], and an integer matrix silently
    # truncated every translation assigned into it (an 8.0623 m spine offset became 8 m, which looked like a 6 cm bind-pose error)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
                     [0, 0, 0, 1]], dtype=float)


def local_mat(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=float).reshape(4, 4).T
    m = np.eye(4)
    s = n.get('scale', [1, 1, 1])
    m = quat_mat(n.get('rotation', [0, 0, 0, 1])) @ np.diag([s[0], s[1], s[2], 1])
    m[:3, 3] = n.get('translation', [0, 0, 0])
    return m


def norm_attr(js, bin_, idx):
    a = js['accessors'][idx]
    v = acc(js, bin_, idx)
    if a['componentType'] == 5126:
        return v.astype(np.float64)
    if a.get('normalized'):
        return v.astype(np.float64) / float(np.iinfo(v.dtype).max)
    return v.astype(np.float64)


def read_model(path):
    js, b = load(path)
    m = Model()
    m.path, m.js = path, js
    m.size = os.path.getsize(path)
    nodes = js['nodes']
    m.nodes = nodes
    parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    m.parent = parent
    wc = {}

    def world(i):
        if i in wc:
            return wc[i]
        w = local_mat(nodes[i])
        if i in parent:
            w = world(parent[i]) @ w
        wc[i] = w
        return w
    m.world = world
    skin = js['skins'][0]
    m.skin = skin
    m.joint_nodes = skin['joints']
    m.names = [nodes[j]['name'] for j in m.joint_nodes]
    m.jindex = {j: k for k, j in enumerate(m.joint_nodes)}
    m.jw = np.array([world(j) for j in m.joint_nodes])
    ibm = acc(js, b, skin['inverseBindMatrices']).astype(float)
    m.ibm = np.array([x.reshape(4, 4).T for x in ibm])
    m.pivot = {nm: m.jw[k][:3, 3].copy() for k, nm in enumerate(m.names)}
    m.skinrest = np.einsum('kij,kjl->kil', m.jw, m.ibm)
    # joint children and descendants (skin indices)
    ch = {k: [] for k in range(len(m.names))}
    for k, j in enumerate(m.joint_nodes):
        p = parent.get(j)
        if p in m.jindex:
            ch[m.jindex[p]].append(k)
    m.children = ch
    m.joint_parent = {k: m.jindex.get(parent.get(j)) for k, j in enumerate(m.joint_nodes)}

    def desc(k):
        out = [k]
        for c in ch[k]:
            out += desc(c)
        return out
    m.desc = {k: desc(k) for k in range(len(m.names))}
    m.meshes = {}
    for i, n in enumerate(nodes):
        if 'mesh' not in n:
            continue
        me = Mesh()
        me.node = i
        me.name = n['name']
        me.has_skin = 'skin' in n
        me.prims = []
        for p in js['meshes'][n['mesh']]['primitives']:
            pr = Prim()
            a = p['attributes']
            pr.mesh = me
            pr.attrs = sorted(a.keys())
            pr.mode = p.get('mode', 4)
            pr.mat = js['materials'][p['material']]['name'] if 'material' in p else None
            pr.pos = acc(js, b, a['POSITION']).astype(np.float64)
            pr.nrm = acc(js, b, a['NORMAL']).astype(np.float64) if 'NORMAL' in a else None
            pr.uv = norm_attr(js, b, a['TEXCOORD_0']) if 'TEXCOORD_0' in a else None
            pr.col = norm_attr(js, b, a['COLOR_0']) if 'COLOR_0' in a else None
            pr.jts = acc(js, b, a['JOINTS_0']).astype(np.int64) if 'JOINTS_0' in a else None
            pr.wts = norm_attr(js, b, a['WEIGHTS_0']) if 'WEIGHTS_0' in a else None
            pr.faces = acc(js, b, p['indices']).reshape(-1, 3).astype(np.int64)
            pr.targets = 'targets' in p
            me.prims.append(pr)
        m.meshes[n['name']] = me
    return m


def level_of(path):
    for k in (0, 1, 2):
        if f'lod{k}' in os.path.basename(path).lower():
            return k
    return 0


def part_of(name):
    s = name.replace('Colossus_', '')
    for sfx in ('_LOD0', '_LOD1', '_LOD2'):
        s = s.replace(sfx, '')
    return s


def merge_groups(pos, tol=1e-4):
    key = np.round(pos / tol).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return inv.ravel(), pos[first]


def tri_areas(p, f):
    a, b_, c = p[f[:, 0]], p[f[:, 1]], p[f[:, 2]]
    return 0.5 * np.linalg.norm(np.cross(b_ - a, c - a), axis=1)


def dominant_joint(pr):
    k = np.argmax(pr.wts, axis=1)
    return pr.jts[np.arange(len(k)), k], pr.wts[np.arange(len(k)), k]


# ---------------------------------------------------------------------------------------------- checks
def check_structure(m, R, level):
    names = list(m.meshes.keys())
    want = {f'Colossus_{p}_LOD{level}' for p in PARTS}
    missing, extra = want - set(names), set(names) - want
    R.add('PASS' if not missing and not extra else 'FAIL', f'parts: {len(names)} mesh objects' + (f', missing {sorted(missing)}' if missing else '') + (f', unexpected {sorted(extra)}' if extra else ''))
    if any(not me.has_skin for me in m.meshes.values()):
        R.add('FAIL', 'a mesh object is not skinned: ' + ', '.join(me.name for me in m.meshes.values() if not me.has_skin))
    else:
        R.add('PASS', 'every part is skinned to one armature (%d skin)' % len(m.js['skins']))
    if len(m.js['skins']) != 1:
        R.add('FAIL', 'expected exactly one skin')
    nprim = sum(len(me.prims) for me in m.meshes.values())
    R.add('PASS' if nprim <= 40 else 'FAIL', f'{nprim} primitives (limit 40)')
    nb = len(m.names)
    R.add('PASS' if nb <= 100 else 'FAIL', f'{nb} bones (limit 100)')
    miss = [b for b in BONES if b not in m.names]
    extra_b = [b for b in m.names if b not in BONES]
    R.add('PASS' if not miss and not extra_b else 'FAIL', 'bone names ' + ('match the brief exactly' if not miss and not extra_b else f'missing {miss} extra {extra_b}'))
    # hierarchy
    exp = {'pelvis': 'root'}
    for i in range(1, 5):
        exp[f'spine_0{i}'] = 'pelvis' if i == 1 else f'spine_0{i - 1}'
    for i in range(1, 7):
        exp[f'neck_0{i}'] = 'spine_04' if i == 1 else f'neck_0{i - 1}'
    exp['head'] = 'neck_06'
    exp['jaw'] = 'head'
    for i in range(1, 9):
        exp[f'tail_0{i}'] = 'pelvis' if i == 1 else f'tail_0{i - 1}'
    for s in LEGS:
        exp[f'leg_{s}_upper'] = 'spine_04' if s[0] == 'F' else 'pelvis'
        exp[f'leg_{s}_lower'] = f'leg_{s}_upper'
        exp[f'leg_{s}_foot'] = f'leg_{s}_lower'
        exp[f'leg_{s}_toe'] = f'leg_{s}_foot'
    bad = []
    for k, nm in enumerate(m.names):
        pk = m.joint_parent[k]
        pn = m.names[pk] if pk is not None else None
        if nm == 'root':
            continue
        if exp.get(nm) != pn:
            bad.append(f'{nm}<-{pn} (expected {exp.get(nm)})')
    R.add('PASS' if not bad else 'FAIL', 'hierarchy ' + ('matches the brief' if not bad else '; '.join(bad[:6])))
    # extras in the file
    js = m.js
    extras = []
    if js.get('animations'):
        extras.append('animations')
    if js.get('textures') or js.get('images'):
        extras.append('textures')
    if js.get('cameras'):
        extras.append('cameras')
    if any(pr.targets for me in m.meshes.values() for pr in me.prims):
        extras.append('shape keys')
    if any(pr.mode != 4 for me in m.meshes.values() for pr in me.prims):
        extras.append('non-triangle primitives')
    R.add('PASS' if not extras else 'FAIL', 'no animations, textures, shape keys or cameras' if not extras else 'file has ' + ', '.join(extras))
    # armature and mesh node transforms
    notid = []
    for n in m.nodes:
        if 'mesh' in n:
            L = local_mat(n)
            if not np.allclose(L, np.eye(4), atol=1e-6):
                notid.append(n['name'])
    R.add('PASS' if not notid else 'WARN', 'mesh nodes have identity transforms' if not notid else f'mesh node transforms not identity: {notid}')
    # armature object (parent of root)
    rk = m.names.index('root') if 'root' in m.names else None
    if rk is not None:
        pj = m.parent.get(m.joint_nodes[rk])
        if pj is not None:
            Lm = local_mat(m.nodes[pj])
            R.add('PASS' if np.allclose(Lm, np.eye(4), atol=1e-6) else 'WARN', f'armature object "{m.nodes[pj].get("name")}" ' + ('has an identity transform' if np.allclose(Lm, np.eye(4), atol=1e-6) else f'has a transform {np.round(Lm[:3], 3).tolist()}'))
    # bone rest rotations
    rots = [m.names[k] for k, j in enumerate(m.joint_nodes) if any(abs(x) > 1e-4 for x in m.nodes[j].get('rotation', [0, 0, 0, 1])[:3])]
    R.add('INFO', f'{len(rots)} of {len(m.names)} bones have a non-identity rest rotation (fine, the game reads pivots, not axes)')


def check_orientation_and_size(m, R, level):
    P = m.pivot
    allp = np.concatenate([pr.pos for me in m.meshes.values() for pr in me.prims])
    lo, hi = allp.min(0), allp.max(0)
    ext = hi - lo
    R.add('INFO', f'bounding box x [{lo[0]:.1f}, {hi[0]:.1f}] y [{lo[1]:.2f}, {hi[1]:.1f}] z [{lo[2]:.1f}, {hi[2]:.1f}]  -> height {ext[1]:.1f} m, length {ext[2]:.1f} m, width {ext[0]:.1f} m')
    R.data['bbox'] = {'min': lo.round(3).tolist(), 'max': hi.round(3).tolist()}
    # facing +Z: head ahead of the pelvis
    R.add('PASS' if P['head'][2] > P['pelvis'][2] else 'FAIL', f'faces +Z (head z {P["head"][2]:.1f}, pelvis z {P["pelvis"][2]:.1f}, tail_08 z {P["tail_08"][2]:.1f})')
    left_ok = all(P[f'leg_{s}_upper'][0] > 0 for s in ('FL', 'BL')) and all(P[f'leg_{s}_upper'][0] < 0 for s in ('FR', 'BR'))
    R.add('PASS' if left_ok else 'FAIL', 'left legs at +X, right legs at -X' if left_ok else 'left/right legs on the wrong sides')
    # origin under the middle of the body
    feet = np.array([P[f'leg_{s}_foot'] for s in LEGS])
    cx, cz = feet[:, 0].mean(), feet[:, 2].mean()
    R.add('PASS' if abs(cx) < 0.3 and abs(cz) < 2.5 else 'WARN', f'origin vs the middle of the four feet: x offset {cx:.2f} m, z offset {cz:.2f} m (origin is 0,0,0)')
    # soles on y=0
    sole = {}
    for s in LEGS:
        me = m.meshes.get(f'Colossus_Leg_{s}_LOD{level}')
        if me:
            sole[s] = min(pr.pos[:, 1].min() for pr in me.prims)
    ok = all(abs(v) < 0.02 for v in sole.values())
    R.add('PASS' if ok else 'FAIL', 'soles lie on y = 0: ' + ', '.join(f'{k} {v:+.3f}' for k, v in sole.items()))
    R.add('PASS' if abs(lo[1]) < 0.02 else 'FAIL', f'lowest point of the whole model y = {lo[1]:+.3f}')
    # symmetric bones
    sym = 0.0
    for a_, b_ in (('FL', 'FR'), ('BL', 'BR')):
        la = np.array([P[f'leg_{a_}_{p}'] for p in ('upper', 'lower', 'foot', 'toe')]) * [-1, 1, 1]
        lb = np.array([P[f'leg_{b_}_{p}'] for p in ('upper', 'lower', 'foot', 'toe')])
        sym = max(sym, float(np.abs(la - lb).max()))
    R.add('PASS' if sym < 0.02 else 'FAIL', f'leg bones mirror across X = 0 (worst {sym * 100:.1f} cm)')
    mid = max(abs(P[n][0]) for n in BONES if not n.startswith('leg_'))
    R.add('PASS' if mid < 0.02 else 'FAIL', f'spine, neck, head, jaw and tail bones sit on X = 0 (worst {mid * 100:.1f} cm)')
    # size table
    def vtx(part, mats=None):
        me = m.meshes.get(f'Colossus_{part}_LOD{level}')
        if not me:
            return np.zeros((0, 3))
        return np.concatenate([pr.pos for pr in me.prims if mats is None or pr.mat in mats])
    torso = vtx('Torso')
    zmid = 0.5 * (P['pelvis'][2] + P['spine_04'][2])
    front = torso[torso[:, 2] > zmid]
    back = torso[torso[:, 2] <= zmid]
    rows = []

    def row(name, val, lo_, hi_, unit='m', hard=False, note=''):
        ok_ = lo_ <= val <= hi_
        rows.append((name, val, lo_, hi_, ok_))
        R.add('PASS' if ok_ else ('FAIL' if hard else 'WARN'), f'{name}: {val:.1f} {unit} (brief {lo_:g} to {hi_:g}){note}')
    row('shoulder top', vtx('Torso')[:, 1].max() if len(front) == 0 else front[:, 1].max(), 52, 58, hard=True)
    row('hip top', back[:, 1].max(), 45, 51)
    belly = torso[np.abs(torso[:, 0]) < 6]
    row('belly underside', np.percentile(belly[:, 1], 0.5), 24, 28)
    row('chest to rump (torso z length)', torso[:, 2].max() - torso[:, 2].min(), 50, 60)
    neck_len = float(np.linalg.norm(P['head'] - P['neck_01']))
    row('neck (neck_01 to head pivot)', neck_len, 24, 32)
    hv = vtx('Head')
    row('head length (head z extent)', hv[:, 2].max() - hv[:, 2].min(), 22, 30)
    tv = vtx('Tail')
    row('tail length (tail z extent)', tv[:, 2].max() - tv[:, 2].min(), 28, 36)
    row('nose to tail tip', ext[2], 110, 130, hard=True)
    for s in ('FL', 'BL'):
        me = m.meshes.get(f'Colossus_Leg_{s}_LOD{level}')
        pts = np.concatenate([pr.pos for pr in me.prims])
        up = P[f'leg_{s}_upper']
        # width of the pillar near the top and near the ankle (x extent in a thin z slab, measured at the leg's own height)
        for label, y0, lo_, hi_ in (('top', up[1] - 4.0, 8.0, 11.0), ('ankle', P[f'leg_{s}_foot'][1] + 3.0, 5.5, 8.0)):
            sl = pts[np.abs(pts[:, 1] - y0) < 0.6]
            if len(sl):
                # width across the leg: use the larger of x and z extent of the cross-section (the pillar is roughly round)
                wx, wz = sl[:, 0].max() - sl[:, 0].min(), sl[:, 2].max() - sl[:, 2].min()
                row(f'leg {s} pillar width at the {label} (slab y={y0:.1f}, x {wx:.1f} z {wz:.1f})', wx, lo_, hi_)
    # feet
    for s in ('FL', 'BL'):
        me = m.meshes.get(f'Colossus_Leg_{s}_LOD{level}')
        pts = np.concatenate([pr.pos for pr in me.prims])
        ft = pts[pts[:, 1] < 3.6]
        if len(ft):
            row(f'foot {s} width (x, y<3.6)', ft[:, 0].max() - ft[:, 0].min(), 8, 12)
            row(f'foot {s} length (z, y<3.6)', ft[:, 2].max() - ft[:, 2].min(), 10, 14)
    row('left to right stance (foot pivots)', abs(P['leg_FL_foot'][0] - P['leg_FR_foot'][0]), 16, 20)
    row('front to rear stance (foot pivots)', abs(P['leg_FL_foot'][2] - P['leg_BL_foot'][2]), 34, 42)
    R.data['size_rows'] = [(n, round(float(v), 2), a, b_, bool(ok_)) for n, v, a, b_, ok_ in rows]


def check_symmetry(m, R, level):
    out = []

    def rep(label, A, B):
        if len(A) == 0 or len(B) == 0:
            return
        mir = A * np.array([-1, 1, 1])
        d, _ = cKDTree(B).query(mir)
        d2, _ = cKDTree(A).query(B * np.array([-1, 1, 1]))
        dd = np.concatenate([d, d2])
        f2 = float((dd < 0.02).mean())
        f20 = float((dd < 0.20).mean())
        out.append((label, f2, f20, float(np.percentile(dd, 99))))
    for s1, s2 in (('FL', 'FR'), ('BL', 'BR')):
        a = m.meshes.get(f'Colossus_Leg_{s1}_LOD{level}')
        b = m.meshes.get(f'Colossus_Leg_{s2}_LOD{level}')
        if a and b:
            rep(f'Leg_{s1} vs Leg_{s2}', np.concatenate([p.pos for p in a.prims]), np.concatenate([p.pos for p in b.prims]))
    for part in ('Head', 'Jaw', 'Neck', 'Torso', 'Tail'):
        me = m.meshes.get(f'Colossus_{part}_LOD{level}')
        if me:
            pts = np.concatenate([p.pos for p in me.prims])
            rep(part + ' halves', pts, pts)
    for label, f2, f20, p99 in out:
        lvl = 'PASS' if f2 > 0.97 else ('WARN' if f20 > 0.9 else 'FAIL')
        R.add(lvl, f'symmetry {label}: {f2 * 100:.1f}% of vertices mirror within 2 cm, {f20 * 100:.1f}% within 20 cm (99th percentile {p99:.2f} m)')
    R.data['symmetry'] = out


def check_materials_and_budget(m, R, level):
    mats = m.js['materials']
    names = [x['name'] for x in mats]
    R.add('PASS' if names == MATS or set(names) == set(MATS) else 'FAIL', f'materials {names}')
    bad = [x['name'] for x in mats if x.get('doubleSided') or x.get('alphaMode', 'OPAQUE') != 'OPAQUE']
    R.add('PASS' if not bad else 'FAIL', 'all opaque and single-sided' if not bad else f'transparent or double-sided: {bad}')
    for x in mats:
        pbr = x.get('pbrMetallicRoughness', {})
        if 'baseColorTexture' in pbr or 'emissiveTexture' in x:
            R.add('FAIL', f'{x["name"]} uses a texture')
    lin = {x['name']: pbr_base(x) for x in mats}
    want = {'Colossus hide': ('#26343b', '#33434a'), 'Colossus plate': ('#cfc3a8', '#cfc3a8')}
    for k, (a, b_) in want.items():
        if k in lin:
            R.add('INFO', f'{k} base colour {hexs(lin[k])} (brief {a}{" to " + b_ if a != b_ else ""})')
    for k in ('Colossus crystal', 'Colossus glow'):
        x = next((q for q in mats if q['name'] == k), None)
        if x:
            em = x.get('emissiveFactor')
            st = x.get('extensions', {}).get('KHR_materials_emissive_strength', {}).get('emissiveStrength', 1.0)
            R.add('PASS' if em and max(em) > 0.3 else 'FAIL', f'{k} emissive {hexs(em) if em else None} x{st:g}, base {hexs(pbr_base(x))}')
    # triangles
    tri = {}
    verts = {}
    for me in m.meshes.values():
        tri[part_of(me.name)] = sum(len(p.faces) for p in me.prims)
        verts[part_of(me.name)] = sum(len(p.pos) for p in me.prims)
    total = sum(tri.values())
    lim = BUDGET.get(level, 500_000)
    lines = ', '.join(f'{k} {v:,}' for k, v in tri.items())
    over = total / lim
    lvl = 'PASS' if total <= lim * 1.0 else ('WARN' if total <= lim * 1.15 else 'FAIL')
    R.add(lvl, f'triangles {total:,} against the lod{level} budget of {lim:,} ({over * 100:.0f}% of it, {sum(verts.values()):,} vertices)')
    R.add('INFO', 'by part: ' + lines)
    byprim = {}
    for me in m.meshes.values():
        for p in me.prims:
            byprim[p.mat] = byprim.get(p.mat, 0) + len(p.faces)
    R.add('INFO', 'by material: ' + ', '.join(f'{k} {v:,} ({v / total * 100:.0f}%)' for k, v in byprim.items()))
    R.data['tris'] = {'total': total, 'parts': tri, 'by_material': byprim}


def pbr_base(x):
    b = x.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])
    return np.array(b[:3], dtype=float)


def check_skinning(m, R, level):
    nj = len(m.names)
    maxinf, badsum, badjoint = 0, 0, 0
    rest_dev = 0.0
    for me in m.meshes.values():
        for p in me.prims:
            inf = (p.wts > 1e-6).sum(1)
            maxinf = max(maxinf, int(inf.max()))
            badsum += int((np.abs(p.wts.sum(1) - 1) > 1e-3).sum())
            badjoint += int(((p.jts >= nj) & (p.wts > 0)).sum())
            sk = skin_pos(p, m.skinrest)
            rest_dev = max(rest_dev, float(np.abs(sk - p.pos).max()))
    R.add('PASS' if maxinf <= 4 else 'FAIL', f'at most {maxinf} bone influences per vertex')
    R.add('PASS' if badsum == 0 and badjoint == 0 else 'FAIL', f'weights sum to 1 and reference real joints ({badsum} bad sums, {badjoint} bad joints)')
    R.add('PASS' if rest_dev < 0.01 else 'FAIL', f'rest pose equals the bind pose (largest vertex difference {rest_dev * 100:.2f} cm)')
    # rigid parts
    for mat, label in (('Colossus plate', 'plates'), ('Colossus crystal', 'crystals'), ('Colossus glow', 'glow seams')):
        tot, rigid, comps_bad, ncomp = 0, 0, 0, 0
        for me in m.meshes.values():
            for p in me.prims:
                if p.mat != mat:
                    continue
                dj, dw = dominant_joint(p)
                tot += len(dj)
                rigid += int((dw > 0.999).sum())
                grp, rp = merge_groups(p.pos)
                nvg = len(rp)
                f = grp[p.faces]
                A = coo_matrix((np.ones(len(f) * 3), (np.concatenate([f[:, 0], f[:, 1], f[:, 2]]), np.concatenate([f[:, 1], f[:, 2], f[:, 0]]))), shape=(nvg, nvg))
                nc, lab = connected_components(A, directed=False)
                vlab = lab[grp]
                # a piece is rigid if all its vertices share the same dominant joint
                key = vlab * 64 + dj
                uniq = np.unique(key)
                per_comp = np.bincount(uniq // 64, minlength=nc)
                comps_bad += int((per_comp > 1).sum())
                ncomp += int((per_comp >= 1).sum())
        if tot:
            f100 = rigid / tot
            if mat == 'Colossus glow':
                R.add('INFO', f'{label}: {f100 * 100:.1f}% of vertices weighted fully to one bone, {comps_bad} of {ncomp} pieces span more than one bone')
            else:
                R.add('PASS' if f100 > 0.999 and comps_bad == 0 else 'FAIL', f'{label}: {f100 * 100:.2f}% of vertices weighted 100% to one bone; {comps_bad} of {ncomp} pieces are split across bones')
    # hide blend band
    dist, blended, tot = [], 0, 0
    for me in m.meshes.values():
        for p in me.prims:
            if p.mat != 'Colossus hide':
                continue
            tot += len(p.pos)
            inf = (p.wts > 1e-3).sum(1)
            idx = np.where(inf > 1)[0]
            blended += len(idx)
            if len(idx) == 0:
                continue
            order = np.argsort(-p.wts[idx], axis=1)
            b1 = p.jts[idx, order[:, 0]]
            b2 = p.jts[idx, order[:, 1]]
            # the joint is the pivot of the child bone of the pair
            child = np.where([m.joint_parent.get(int(a)) == int(b) for a, b in zip(b1, b2)], b1, b2)
            piv = m.jw[child][:, :3, 3]
            dist.append(np.linalg.norm(p.pos[idx] - piv, axis=1))
    if tot:
        d = np.concatenate(dist) if dist else np.array([0.0])
        R.add('INFO', f'hide: {blended / tot * 100:.1f}% of vertices blend between bones; blended vertices lie a median {np.median(d):.1f} m (95th percentile {np.percentile(d, 95):.1f} m) from their joint pivot')
        R.add('PASS' if np.percentile(d, 95) < 12 else 'WARN', 'the hide blends only in a band around the joints' if np.percentile(d, 95) < 12 else 'hide blending reaches far from the joints (long blend bands may swim)')


def skin_pos(p, skin_mats):
    Ph = np.concatenate([p.pos, np.ones((len(p.pos), 1))], 1)
    out = np.zeros_like(p.pos)
    for k in range(4):
        w = p.wts[:, k]
        msk = w > 0
        if not msk.any():
            continue
        M = skin_mats[p.jts[msk, k]]
        out[msk] += w[msk, None] * np.einsum('mij,mj->mi', M[:, :3, :], Ph[msk])
    return out


def rot_about(pivot, axis, deg):
    a = math.radians(deg)
    x, y, z = axis / np.linalg.norm(axis)
    c, s = math.cos(a), math.sin(a)
    Rm = np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
                   [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
                   [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])
    M = np.eye(4)
    M[:3, :3] = Rm
    M[:3, 3] = pivot - Rm @ pivot
    return M


def check_bend(m, R, level):
    """Turn each joint POSE_DEG degrees about X (and about Y for the spine, neck, tail), then look for torn seams, stretched or collapsed
    hide and flipped triangles. Rest topology is merged by position first, so a seam whose two sides weigh differently shows as a tear."""
    cache = []
    for me in m.meshes.values():
        for p in me.prims:
            grp, rp = merge_groups(p.pos)
            f = grp[p.faces]
            ok = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
            f = f[ok]
            e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
            e.sort(1)
            ek = np.unique(e[:, 0] * len(rp) + e[:, 1])
            e = np.stack([ek // len(rp), ek % len(rp)], 1)
            rl = np.linalg.norm(rp[e[:, 0]] - rp[e[:, 1]], axis=1)
            keep = rl > 0.01
            e, rl = e[keep], rl[keep]
            n0 = np.cross(rp[f[:, 1]] - rp[f[:, 0]], rp[f[:, 2]] - rp[f[:, 0]])
            a0 = np.linalg.norm(n0, axis=1)
            cache.append(dict(p=p, grp=grp, rp=rp, f=f, e=e, rl=rl, n0=n0, a0=a0, cnt=np.bincount(grp, minlength=len(rp)),
                              dj=dominant_joint(p)[0]))
    results = []
    axes = {'x': np.array([1.0, 0, 0]), 'y': np.array([0, 1.0, 0])}
    t0 = time.time()
    for k, nm in enumerate(m.names):
        if nm == 'root':
            continue
        for an, ax in axes.items():
            if an == 'y' and not (nm.startswith(('spine', 'neck', 'tail', 'pelvis', 'head', 'jaw'))):
                continue
            Dm = rot_about(m.pivot[nm], ax, POSE_DEG)
            skin_mats = m.skinrest.copy()
            for d in m.desc[k]:
                skin_mats[d] = Dm @ skin_mats[d]
            worst_s, worst_c, tear, flips, collapse, nflip_tot, nstretch, ncollapse = 1.0, 1.0, 0.0, 0, 0, 0, 0, 0
            tearp = ''
            for c in cache:
                p = c['p']
                moved = np.isin(p.jts, m.desc[k]) & (p.wts > 0)
                if not moved.any():
                    continue
                sk = skin_pos(p, skin_mats)
                cnt = c['cnt']
                pp = np.zeros((len(c['rp']), 3))
                np.add.at(pp, c['grp'], sk)
                pp /= cnt[:, None]
                tdev = np.linalg.norm(sk - pp[c['grp']], axis=1).max()
                if tdev > tear:
                    tear, tearp = tdev, f'{p.mesh.name.replace("Colossus_", "")}/{p.mat.replace("Colossus ", "")}'
                e = c['e']
                nl = np.linalg.norm(pp[e[:, 0]] - pp[e[:, 1]], axis=1)
                ratio = nl / c['rl']
                worst_s = max(worst_s, float(ratio.max()))
                worst_c = min(worst_c, float(ratio.min()))
                nstretch += int((ratio > 2.0).sum())
                ncollapse += int((ratio < 0.4).sum())
                f = c['f']
                n1 = np.cross(pp[f[:, 1]] - pp[f[:, 0]], pp[f[:, 2]] - pp[f[:, 0]])
                big = c['a0'] > 1e-6
                dots = (n1 * c['n0']).sum(1)
                nflip_tot += int(((dots < 0) & big).sum())
            results.append((f'{nm}:{an}', worst_s, worst_c, tear, tearp, nstretch, ncollapse, nflip_tot))
    R.add('INFO', f'bend test: {len(results)} joint poses of {POSE_DEG:g} degrees in {time.time() - t0:.0f} s')
    worst = sorted(results, key=lambda r: -max(r[1], 1 / max(r[2], 1e-3)))[:6]
    R.add('INFO', 'most strained joints (stretch / squash of the worst edge): ' + '; '.join(f'{r[0]} x{r[1]:.1f} / x{r[2]:.2f}' for r in worst))
    torn = [r for r in results if r[3] > 0.05]
    R.add('PASS' if not torn else 'FAIL', 'no torn seams in any pose (largest gap %.1f cm)' % (max(r[3] for r in results) * 100) if not torn else f'{len(torn)} poses tear a seam, worst {max(r[3] for r in torn):.2f} m at {sorted(torn, key=lambda r: -r[3])[0][4]} ({sorted(torn, key=lambda r: -r[3])[0][0]})')
    stretched = [r for r in results if r[5] > 0]
    sevstr = [r for r in results if r[1] > 4.0]
    R.add('PASS' if not sevstr else 'WARN', f'hide stretch: {len(stretched)} poses have an edge longer than 2x its rest length; {len(sevstr)} poses have one over 4x' + (f' (worst x{max(r[1] for r in results):.1f} in {max(results, key=lambda r: r[1])[0]})' if stretched else ''))
    collapsed = [r for r in results if r[6] > 0]
    sevcol = [r for r in results if r[2] < 0.15]
    R.add('PASS' if not sevcol else 'WARN', f'hide squash: {len(collapsed)} poses have an edge under 0.4x its rest length; {len(sevcol)} under 0.15x' + (f' (worst x{min(r[2] for r in results):.2f} in {min(results, key=lambda r: r[2])[0]})' if collapsed else ''))
    fl = [r for r in results if r[7] > 0]
    tri_total = sum(len(c['f']) for c in cache)
    worstflip = max(results, key=lambda r: r[7])
    R.add('PASS' if worstflip[7] / tri_total < 0.002 else 'WARN', f'flipped triangles: {len(fl)} poses flip some ({worstflip[7]:,} at most, in {worstflip[0]}, {worstflip[7] / tri_total * 100:.2f}% of all triangles)')
    R.data['bend'] = [(r[0], round(r[1], 2), round(r[2], 3), round(r[3], 3), r[5], r[6], r[7]) for r in results]


def check_mesh_quality(m, R, level):
    tot = dict(faces=0, open=0, nonman=0, loose=0, zero=0, dup=0, tiny=0, edges=0)
    inward = []
    per = []
    gkeys = {}
    for me in m.meshes.values():
        for p in me.prims:
            grp, rp = merge_groups(p.pos)
            f = grp[p.faces]
            nv = len(rp)
            used = np.zeros(nv, bool)
            used[f.ravel()] = True
            loose = int((~used).sum())
            area = tri_areas(rp, f)
            zero = int((area < 1e-8).sum())
            e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
            ekey = np.minimum(e[:, 0], e[:, 1]) * nv + np.maximum(e[:, 0], e[:, 1])
            uk, cnt = np.unique(ekey, return_counts=True)
            op = int((cnt == 1).sum())
            nm = int((cnt > 2).sum())
            el = np.linalg.norm(rp[uk // nv] - rp[uk % nv], axis=1)
            tiny = int((el < 0.03).sum())
            sf = np.sort(f, axis=1)
            fk = sf[:, 0] * nv * nv + sf[:, 1] * nv + sf[:, 2]
            dup = int(len(fk) - len(np.unique(fk)))
            # directed duplicates inside a primitive (same winding, i.e. an edge used twice the same way)
            dkey = e[:, 0] * nv + e[:, 1]
            dd = int(len(dkey) - len(np.unique(dkey)))
            # inward shells: closed components by signed volume
            A = coo_matrix((np.ones(len(f) * 3), (np.concatenate([f[:, 0], f[:, 1], f[:, 2]]), np.concatenate([f[:, 1], f[:, 2], f[:, 0]]))), shape=(nv, nv))
            nc, lab = connected_components(A, directed=False)
            fl = lab[f[:, 0]]
            vol = 0.5 * np.einsum('ij,ij->i', rp[f[:, 0]], np.cross(rp[f[:, 1]], rp[f[:, 2]])) / 3.0
            cv = np.bincount(fl, weights=vol, minlength=nc)
            # edges per component to know which are closed
            ecomp = lab[uk // nv]
            open_per = np.bincount(ecomp[cnt != 2], minlength=nc)
            closed_neg = int(((open_per == 0) & (cv < -1e-6)).sum())
            closed_n = int((open_per == 0).sum())
            if closed_neg:
                inward.append((p.mesh.name, p.mat, closed_neg))
            per.append((part_of(p.mesh.name), p.mat.replace('Colossus ', ''), len(f), nc, closed_n, op, nm, loose, zero, tiny, dup, dd, closed_neg))
            tot['faces'] += len(f); tot['open'] += op; tot['nonman'] += nm; tot['loose'] += loose; tot['zero'] += zero; tot['dup'] += dup; tot['tiny'] += tiny; tot['edges'] += len(uk)
    R.add('INFO', f'{tot["faces"]:,} triangles, {tot["edges"]:,} edges after merging vertices at the same position')
    R.add('PASS' if tot['loose'] == 0 else 'FAIL', f'{tot["loose"]} loose vertices')
    R.add('PASS' if tot['zero'] == 0 else 'FAIL', f'{tot["zero"]} zero-area faces')
    R.add('PASS' if tot['dup'] == 0 else 'FAIL', f'{tot["dup"]} duplicate faces (they would z-fight)')
    R.add('PASS' if tot['nonman'] == 0 else 'FAIL', f'{tot["nonman"]} non-manifold edges (shared by 3 or more faces)')
    # open edges per material
    by = {}
    for r in per:
        by.setdefault(r[1], [0, 0, 0, 0])
        by[r[1]][0] += r[5]
        by[r[1]][1] += r[3]
        by[r[1]][2] += r[4]
        by[r[1]][3] += r[2]
    for mat, (op, nc, cl, nf) in by.items():
        lvl = 'PASS' if op == 0 else ('WARN' if mat == 'hide' else 'FAIL')
        R.add(lvl, f'{mat}: {nc:,} pieces, {cl:,} closed, {op:,} open edges' + (' (the hide skin may be open where it meets a plate, the brief allows that)' if mat == 'hide' and op else ''))
    R.add('PASS' if not inward else 'FAIL', 'no inside-out closed shells' if not inward else 'inside-out closed shells: ' + ', '.join(f'{a}/{b} {c}' for a, b, c in inward[:6]))
    R.add('PASS' if tot['tiny'] / max(tot['edges'], 1) < 0.02 else 'WARN', f'{tot["tiny"]:,} edges under 3 cm ({tot["tiny"] / max(tot["edges"], 1) * 100:.1f}% of all; the brief wants no detail under about 3 cm because it shimmers in VR)')
    R.data['mesh_quality'] = per


def check_uvs(m, R, level):
    # per mesh object: gather every primitive
    worst_over, sums = 0.0, []
    densities = {}
    margin_bad = {}
    nouv, out_of_range = [], []
    RES, MRES = 4096, 1024
    for me in m.meshes.values():
        parts = []
        for p in me.prims:
            if p.uv is None:
                nouv.append(me.name)
                continue
            parts.append(p)
        if not parts:
            continue
        uvmin = min(p.uv.min() for p in parts)
        uvmax = max(p.uv.max() for p in parts)
        if uvmin < -1e-4 or uvmax > 1 + 1e-4:
            out_of_range.append((part_of(me.name), round(float(uvmin), 3), round(float(uvmax), 3)))
        # triangles in uv and world
        tri_uv, tri_w, isl = [], [], []
        off = 0
        for p in parts:
            key = np.concatenate([np.round(p.pos / 1e-4), np.round(p.uv / 1e-5)], 1).astype(np.int64)
            _, inv = np.unique(key, axis=0, return_inverse=True)
            inv = inv.ravel()
            f = inv[p.faces]
            nv = inv.max() + 1
            A = coo_matrix((np.ones(len(f) * 3), (np.concatenate([f[:, 0], f[:, 1], f[:, 2]]), np.concatenate([f[:, 1], f[:, 2], f[:, 0]]))), shape=(nv, nv))
            nc, lab = connected_components(A, directed=False)
            isl.append(lab[f[:, 0]] + off)
            off += nc
            tri_uv.append(p.uv[p.faces])
            tri_w.append(p.pos[p.faces])
        tri_uv = np.concatenate(tri_uv)
        tri_w = np.concatenate(tri_w)
        isl = np.concatenate(isl)
        auv = 0.5 * np.abs((tri_uv[:, 1, 0] - tri_uv[:, 0, 0]) * (tri_uv[:, 2, 1] - tri_uv[:, 0, 1]) - (tri_uv[:, 2, 0] - tri_uv[:, 0, 0]) * (tri_uv[:, 1, 1] - tri_uv[:, 0, 1]))
        aw = 0.5 * np.linalg.norm(np.cross(tri_w[:, 1] - tri_w[:, 0], tri_w[:, 2] - tri_w[:, 0]), axis=1)
        good = aw > 1e-6
        dens = np.sqrt(auv[good] / aw[good]) * MRES  # texels per metre at 1k
        w = aw[good]
        # area-weighted percentiles
        o = np.argsort(dens)
        cw = np.cumsum(w[o]) / w.sum()
        pct = lambda q: float(dens[o][np.searchsorted(cw, q)])
        densities[part_of(me.name)] = (pct(0.05), pct(0.5), pct(0.95))
        # overlap: covered pixels vs summed area, at 4096
        img = Image.new('L', (RES, RES), 0)
        dr = ImageDraw.Draw(img)
        pts = (tri_uv * RES)
        for t in pts:
            dr.polygon([(float(t[0, 0]), float(RES - t[0, 1])), (float(t[1, 0]), float(RES - t[1, 1])), (float(t[2, 0]), float(RES - t[2, 1]))], fill=255)
        cov = float((np.asarray(img) > 0).sum())
        sumpx = float(auv.sum() * RES * RES)
        over = 1.0 - cov / max(sumpx, 1)
        worst_over = max(worst_over, over)
        sums.append((part_of(me.name), over, int(isl.max() + 1)))
        # margin at 1024: islands within 4 px of another island
        lab_img = Image.new('I', (MRES, MRES), 0)
        dl = ImageDraw.Draw(lab_img)
        for t, li in zip(tri_uv * MRES, isl):
            dl.polygon([(float(t[0, 0]), float(MRES - t[0, 1])), (float(t[1, 0]), float(MRES - t[1, 1])), (float(t[2, 0]), float(MRES - t[2, 1]))], fill=int(li) + 1)
        L = np.asarray(lab_img).astype(np.int64)
        mx = ndimage.maximum_filter(L, size=9)
        mn = ndimage.minimum_filter(np.where(L > 0, L, 1 << 30), size=9)
        conflict = ((mx > 0) & (mn < (1 << 30)) & (mx != mn))
        margin_bad[part_of(me.name)] = float(conflict.sum() / max((L > 0).sum(), 1))
    R.add('PASS' if not nouv else 'FAIL', 'every primitive has UV0' if not nouv else f'no UVs on {sorted(set(nouv))}')
    R.add('PASS' if not out_of_range else 'FAIL', 'UVs lie inside 0..1' if not out_of_range else f'UVs outside 0..1: {out_of_range}')
    for name, over, n in sums:
        R.add('PASS' if over < 0.03 else 'FAIL', f'UV overlap {name}: {over * 100:.1f}% of the island area is covered twice ({n:,} islands)')
    # density consistency
    meds = np.array([v[1] for v in densities.values()])
    lines = ', '.join(f'{k} {v[1]:.0f}' for k, v in densities.items())
    R.add('INFO', f'texel density at 1024 (px per metre, area-weighted median per mesh): {lines}')
    spread = meds.max() / max(meds.min(), 1e-6)
    R.add('PASS' if spread < 2.0 else 'WARN', f'texel density differs between meshes by x{spread:.1f} (median); a steady density helps the later texture paint')
    inner = [(k, v[0], v[2]) for k, v in densities.items()]
    wid = max(v[2] / max(v[0], 1e-6) for v in densities.values())
    R.add('PASS' if wid < 4.0 else 'WARN', f'inside one mesh the 5th to 95th percentile density ratio is up to x{wid:.1f}')
    badm = {k: v for k, v in margin_bad.items() if v > 0.02}
    R.add('PASS' if not badm else 'WARN', 'islands keep a 4 pixel margin at 1024' if not badm else 'islands closer than 4 px at 1024 (share of covered pixels): ' + ', '.join(f'{k} {v * 100:.0f}%' for k, v in badm.items()))
    R.data['uv'] = {'overlap': sums, 'density': {k: [round(x, 1) for x in v] for k, v in densities.items()}, 'margin': margin_bad}


def check_colour(m, R, level):
    mats = {x['name']: pbr_base(x) for x in m.js['materials']}
    for matname, lo_hex in (('Colossus hide', '#1f2a30'), ('Colossus plate', None)):
        cols, n = [], 0
        for me in m.meshes.values():
            for p in me.prims:
                if p.mat != matname:
                    continue
                if p.col is None:
                    R.add('FAIL', f'{p.mesh.name}/{matname} has no vertex colour (COLOR_0)')
                    continue
                cols.append(p.col[:, :3])
        if not cols:
            continue
        c = np.concatenate(cols)
        eff = c * mats[matname]
        lum = (to_srgb(eff) * [0.2126, 0.7152, 0.0722]).sum(1)
        pr = np.percentile(lum, [1, 50, 99])
        txt = f'{matname}: vertex colour x base colour gives sRGB luminance 1% {pr[0]:.3f}, median {pr[1]:.3f}, 99% {pr[2]:.3f}; darkest corner {hexs(eff[np.argmin(lum)])}, median {hexs(np.median(eff, axis=0))}'
        if lo_hex:
            floor = (to_srgb(to_lin(np.array([int(lo_hex[i:i + 2], 16) / 255 for i in (1, 3, 5)]))) * [0.2126, 0.7152, 0.0722]).sum()
            below = float((lum < floor - 0.003).mean())
            R.add('PASS' if below < 0.02 else 'WARN', txt + f'; {below * 100:.1f}% of vertices are darker than {lo_hex} (the brief says the game is dim and darker hide reads as black)')
        else:
            R.add('INFO', txt)
    # crystals: vertex colour hue
    cyan, vio, tot = 0, 0, 0
    for me in m.meshes.values():
        for p in me.prims:
            if p.mat == 'Colossus crystal' and p.col is not None:
                c = p.col[:, :3]
                v = c[:, 0] > c[:, 1] * 0.9
                vio += int(v.sum())
                tot += len(c)
    if tot:
        R.add('INFO', f'crystal vertex colour: {vio / tot * 100:.0f}% violet-ish vertices. Note: glTF vertex colour multiplies the BASE colour only, not the emissive, so a violet crystal still glows cyan unless the game tints the emissive (I do that in the game code).')


def check_glow_share(m, R, level):
    area = {}
    for me in m.meshes.values():
        for p in me.prims:
            area[p.mat] = area.get(p.mat, 0.0) + float(tri_areas(p.pos, p.faces).sum())
    tot = sum(area.values())
    glow = area.get('Colossus crystal', 0) + area.get('Colossus glow', 0)
    share = glow / tot
    R.add('PASS' if 0.015 <= share <= 0.045 else 'WARN', f'glowing surface (crystal + glow): {share * 100:.1f}% of the surface area (brief 2 to 4%): crystal {area.get("Colossus crystal", 0) / tot * 100:.2f}%, seams and eyes {area.get("Colossus glow", 0) / tot * 100:.2f}%')


def crystal_components(m, level):
    out = []
    jn = {k: n for k, n in enumerate(m.names)}
    for me in m.meshes.values():
        for p in me.prims:
            if p.mat != 'Colossus crystal':
                continue
            grp, rp = merge_groups(p.pos)
            nv = len(rp)
            f = grp[p.faces]
            A = coo_matrix((np.ones(len(f) * 3), (np.concatenate([f[:, 0], f[:, 1], f[:, 2]]), np.concatenate([f[:, 1], f[:, 2], f[:, 0]]))), shape=(nv, nv))
            nc, lab = connected_components(A, directed=False)
            dj, dw = dominant_joint(p)
            # representative joint per merged vertex
            vj = np.zeros(nv, np.int64)
            vw = np.zeros(nv)
            vj[grp] = dj
            vw[grp] = dw
            vcol = np.zeros((nv, 3))
            if p.col is not None:
                vcol[grp] = p.col[:, :3]
            order = np.argsort(lab, kind='stable')
            bounds = np.searchsorted(lab[order], np.arange(nc + 1))
            # per-component edge counts for closedness
            e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
            ekey = np.minimum(e[:, 0], e[:, 1]) * nv + np.maximum(e[:, 0], e[:, 1])
            uk, cnt = np.unique(ekey, return_counts=True)
            ecomp = lab[uk // nv]
            open_per = np.bincount(ecomp[cnt != 2], minlength=nc)
            vol = 0.5 * np.einsum('ij,ij->i', rp[f[:, 0]], np.cross(rp[f[:, 1]], rp[f[:, 2]])) / 3.0
            cvol = np.bincount(lab[f[:, 0]], weights=vol, minlength=nc)
            ftc = np.bincount(lab[f[:, 0]], minlength=nc)
            for c in range(nc):
                idx = order[bounds[c]:bounds[c + 1]]
                pts = rp[idx]
                if len(pts) < 4:
                    continue
                mean = pts.mean(0)
                u, s, vt = np.linalg.svd(pts - mean, full_matrices=False)
                ax = vt[0]
                t = (pts - mean) @ ax
                L = t.max() - t.min()
                span = L
                # thick end = base: widths of the two end slices
                rad = np.linalg.norm((pts - mean) - np.outer(t, ax), axis=1)
                lo_s = rad[t < t.min() + 0.25 * L]
                hi_s = rad[t > t.max() - 0.25 * L]
                wlo = 2 * lo_s.max() if len(lo_s) else 0
                whi = 2 * hi_s.max() if len(hi_s) else 0
                if wlo >= whi:
                    base_t, base_w, tip_w, d = t.min(), wlo, whi, ax
                else:
                    base_t, base_w, tip_w, d = t.max(), whi, wlo, -ax
                base_pt = mean + ax * base_t
                bones = np.unique(vj[idx])
                out.append(dict(centre=mean, base=base_pt, dir=d, length=float(L), base_w=float(base_w), tip_w=float(tip_w),
                                bone=int(bones[0]), nbones=len(bones), rigid=bool((vw[idx] > 0.999).all()), closed=bool(open_per[c] == 0),
                                vol=float(cvol[c]), tris=int(ftc[c]), col=vcol[idx].mean(0), mesh=part_of(me.name)))
    return out


def check_crystals(m, R, level):
    cs = crystal_components(m, level)
    n = len(cs)
    if n == 0:
        R.add('FAIL', 'no crystal hand-holds found')
        return
    L = np.array([c['length'] for c in cs])
    W = np.array([c['base_w'] for c in cs])
    R.add('PASS' if n >= 300 else 'FAIL', f'{n:,} separate crystal pieces (brief: at least 300)')
    inl = ((L >= 0.28) & (L <= 0.55)).mean()
    R.add('PASS' if inl > 0.8 else 'WARN', f'crystal length: median {np.median(L):.2f} m, 5th to 95th percentile {np.percentile(L, 5):.2f} to {np.percentile(L, 95):.2f} m; {inl * 100:.0f}% within 0.3 to 0.5 m')
    thick = (W >= 0.12).mean()
    R.add('PASS' if thick > 0.95 else ('WARN' if thick > 0.75 else 'FAIL'), f'crystal base thickness: median {np.median(W) * 100:.0f} cm, 5th percentile {np.percentile(W, 5) * 100:.0f} cm; {thick * 100:.0f}% are at least 12 cm (a hand is about 10 cm wide)')
    closed = np.mean([c['closed'] and c['vol'] > 0 for c in cs])
    R.add('PASS' if closed > 0.99 else 'FAIL', f'{closed * 100:.1f}% of crystals are closed, outward-facing solids (not flat cards)')
    rig = np.mean([c['rigid'] and c['nbones'] == 1 for c in cs])
    R.add('PASS' if rig > 0.999 else 'FAIL', f'{rig * 100:.1f}% of crystals are weighted 100% to a single bone')
    up = np.array([c['dir'][1] for c in cs])
    R.add('INFO', f'crystal direction: {np.mean(up > 0.2) * 100:.0f}% point upward (y > 0.2), {np.mean(up < -0.2) * 100:.0f}% point down; median tilt from vertical {np.degrees(np.arccos(np.clip(np.median(up), -1, 1))):.0f} degrees')
    # base heights above ground and spacing
    base = np.array([c['base'] for c in cs])
    tree = cKDTree(base)
    d, _ = tree.query(base, k=2)
    nn = d[:, 1]
    R.add('INFO', f'spacing to the nearest other crystal: median {np.median(nn):.2f} m, 10th percentile {np.percentile(nn, 10):.2f} m, 90th percentile {np.percentile(nn, 90):.2f} m (brief 0.6 to 1 m apart, in clusters and runs)')
    # first holds: low crystals on feet, ankles
    names = m.names
    boneof = np.array([names[c['bone']] for c in cs])
    low = (base[:, 1] >= 1.0) & (base[:, 1] <= 2.5)
    foot_bones = [f'leg_{s}_{p}' for s in LEGS for p in ('foot', 'toe', 'lower')]
    for s in LEGS:
        fb = [f'leg_{s}_foot', f'leg_{s}_toe']
        cnt = int(((low) & np.isin(boneof, fb)).sum())
        cnt_any = int((low & np.array([b.startswith(f'leg_{s}') for b in boneof])).sum())
        R.add('PASS' if cnt >= 3 else ('WARN' if cnt_any >= 3 else 'FAIL'), f'first holds on the {s} foot and ankle (base 1.0 to 2.5 m above the sole): {cnt} on foot/toe bones, {cnt_any} anywhere on that leg')
    # routes: BFS over the crystal graph
    for reach in (1.0, 1.3):
        pairs = tree.query_pairs(reach, output_type='ndarray')
        A = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
        nc, lab = connected_components(A, directed=False)
        start = np.where(low & np.array([b.startswith('leg_') for b in boneof]))[0]
        if len(start) == 0:
            R.add('FAIL', f'no starting holds low on the legs (reach {reach} m)')
            continue
        reach_comp = np.unique(lab[start])
        reached = np.isin(lab, reach_comp)
        groups = {'legs': lambda b: b.startswith('leg_'), 'pelvis/belly': lambda b: b in ('pelvis', 'root'), 'spine/flanks': lambda b: b.startswith('spine'),
                  'neck': lambda b: b.startswith('neck'), 'head/jaw': lambda b: b in ('head', 'jaw'), 'tail': lambda b: b.startswith('tail')}
        parts = []
        for g, fn in groups.items():
            sel = np.array([fn(b) for b in boneof])
            if sel.any():
                parts.append(f'{g} {int((reached & sel).sum())}/{int(sel.sum())}')
        top = base[reached][:, 1].max() if reached.any() else 0
        R.add('INFO', f'routes at {reach:g} m reach: {int(reached.sum())} of {n} holds connect to the ground holds (highest {top:.1f} m); by region {", ".join(parts)}')
        if reach == 1.3:
            R.reached = reached
            R.add('PASS' if reached.mean() > 0.8 and ('head/jaw' in ''.join(parts)) else 'WARN', f'{reached.mean() * 100:.0f}% of holds are on a route from the ground at 1.3 m reach' + (' ; ' if reached.mean() <= 0.8 else ''))
    # where the crystals are, by bone group
    by = {}
    for b in boneof:
        g = 'leg' if b.startswith('leg_') else b.split('_')[0]
        by[g] = by.get(g, 0) + 1
    R.add('INFO', 'crystals by region: ' + ', '.join(f'{k} {v}' for k, v in sorted(by.items(), key=lambda kv: -kv[1])))
    # colour
    col = np.array([c['col'] for c in cs])
    R.add('INFO', f'{int((col[:, 0] > col[:, 1] * 0.9).sum())} violet-ish and {int((col[:, 0] <= col[:, 1] * 0.9).sum())} cyan-ish crystals by vertex colour')
    R.data['crystals'] = dict(n=n, length_median=float(np.median(L)), base_w_median=float(np.median(W)), nn_median=float(np.median(nn)))
    R.crystals = cs


def draw_map(m, R, path):
    """Side and top view of every crystal hold: cyan = on a route from the ground (1.3 m reach), red = cut off, violet = violet crystal."""
    cs = getattr(R, 'crystals', None)
    reached = getattr(R, 'reached', None)
    if not cs or reached is None:
        return
    S = 11  # px per metre
    W, H = int(135 * S), int(60 * S)
    img = Image.new('RGB', (W + 40, H + H // 2 + 330), (14, 18, 22))
    dr = ImageDraw.Draw(img)

    def px_side(c):
        return int(20 + (c[2] + 58) * S), int(H - c[1] * S + 10)

    def px_top(c):
        return int(20 + (c[2] + 58) * S), int(H + 60 + (c[0] + 16) * S)
    dr.line([(20, H + 10), (W + 20, H + 10)], fill=(90, 80, 60))
    for k, c in enumerate(cs):
        violet = c['col'][0] > c['col'][1] * 0.9
        col = (155, 92, 255) if violet else ((37, 208, 255) if reached[k] else (255, 70, 60))
        for px in (px_side(c['base']), px_top(c['base'])):
            dr.ellipse([px[0] - 2, px[1] - 2, px[0] + 2, px[1] + 2], fill=col)
    for k in range(0, 135, 10):
        x = 20 + k * S
        dr.line([(x, H + 6), (x, H + 14)], fill=(120, 120, 120))
        dr.text((x + 2, H + 16), f'z {k - 58}', fill=(150, 150, 150))
    dr.text((24, 14), 'side view (head to the right): cyan = on a route from the ground, red = cut off, violet = violet crystal', fill=(220, 220, 220))
    dr.text((24, H + 40), 'top view', fill=(220, 220, 220))
    img.save(path)
    print('  [INFO] crystal map written to', path)


def compare_skeletons(models, R):
    a = models[0]
    for b in models[1:]:
        same_names = a.names == b.names
        dev = max(np.abs(a.pivot[n] - b.pivot[n]).max() for n in a.names if n in b.pivot) if same_names else 9e9
        R.add('PASS' if same_names and dev < 1e-3 else 'FAIL', f'{os.path.basename(b.path)} skeleton vs {os.path.basename(a.path)}: ' + ('identical names and rest pivots' if same_names and dev < 1e-3 else f'names equal {same_names}, worst pivot difference {dev:.3f} m'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--json')
    ap.add_argument('--skip', default='')
    ap.add_argument('--map', help='write a crystal route map PNG')
    a = ap.parse_args()
    skip = set(a.skip.split(',')) if a.skip else set()
    models = []
    allfail = False
    for path in a.files:
        level = level_of(path)
        print(f'== {os.path.basename(path)}  ({os.path.getsize(path) / 1e6:.1f} MB, level {level})', flush=True)
        t0 = time.time()
        m = read_model(path)
        R = Report()
        steps = [('structure', check_structure), ('size', check_orientation_and_size), ('symmetry', check_symmetry), ('materials', check_materials_and_budget),
                 ('skinning', check_skinning), ('colour', check_colour), ('glow', check_glow_share), ('mesh', check_mesh_quality), ('uv', check_uvs),
                 ('crystals', check_crystals), ('pose', check_bend)]
        for name, fn in steps:
            if name in skip:
                continue
            print(f' -- {name}', flush=True)
            try:
                fn(m, R, level)
            except Exception as ex:  # keep going, a crash in one check must not hide the others
                import traceback
                traceback.print_exc()
                R.add('FAIL', f'check "{name}" crashed: {ex}')
        if a.map and len(a.files) == 1:
            try:
                draw_map(m, R, a.map)
            except Exception as ex:
                print('  map failed:', ex)
        n = {k: sum(1 for l, _ in R.lines if l == k) for k in ('PASS', 'WARN', 'FAIL', 'INFO')}
        print(f'== {os.path.basename(path)}: {n["PASS"]} pass, {n["WARN"]} warn, {n["FAIL"]} fail ({time.time() - t0:.0f} s)', flush=True)
        if a.json:
            with open(a.json if len(a.files) == 1 else a.json.replace('.json', f'_lod{level}.json'), 'w') as fh:
                json.dump({'lines': R.lines, 'data': R.data}, fh, default=lambda o: o.tolist() if hasattr(o, 'tolist') else str(o), indent=1)
        allfail = allfail or R.failed
        models.append(m)
    if len(models) > 1:
        R = Report()
        print('== skeletons across levels')
        compare_skeletons(models, R)
        allfail = allfail or R.failed
    sys.exit(1 if allfail else 0)


if __name__ == '__main__':
    main()
