"""Independent check of a rigged creature GLB (no Blender needed): python3 tools/creature/check_glb.py file.glb [more.glb]

Reads the glTF JSON and binary directly (numpy + trimesh for the mesh topology) and prints: triangles, size, materials, bones, the
bounding box, which end is +Z (the head bone), whether lowest vertex is at y=0, weights (<=4 influences, sum 1, existing joints),
loose vertices, open and non-manifold edges, zero-area faces and inward shells per closed shell. Exits 1 if anything fails.
"""
import json, struct, sys, os
import numpy as np
import trimesh

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def load(path):
    b = open(path, 'rb').read()
    _, _, _ = struct.unpack('<4sII', b[:12])
    off, js, bin_ = 12, None, None
    while off < len(b):
        n, t = struct.unpack('<II', b[off:off + 8]); chunk = b[off + 8:off + 8 + n]; off += 8 + n
        if t == 0x4E4F534A: js = json.loads(chunk)
        elif t == 0x004E4942: bin_ = chunk
    return js, bin_

def acc(js, bin_, i):
    a = js['accessors'][i]; v = js['bufferViews'][a['bufferView']]
    dt = np.dtype(COMP[a['componentType']]); n = NUM[a['type']]
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride') or dt.itemsize * n
    raw = np.frombuffer(bin_, dtype=np.uint8, count=a['count'] * stride, offset=start) if stride != dt.itemsize * n else None
    if raw is not None:
        out = np.stack([np.frombuffer(bin_, dtype=dt, count=n, offset=start + k * stride) for k in range(a['count'])])
    else:
        out = np.frombuffer(bin_, dtype=dt, count=a['count'] * n, offset=start).reshape(a['count'], n)
    return out

def check(path):
    js, bin_ = load(path)
    fails = []
    print(f"== {os.path.basename(path)}  {os.path.getsize(path)/1024:.0f} KB")
    print(' extensions used:', js.get('extensionsUsed', 'none'), '| animations:', len(js.get('animations', [])), '| textures:', len(js.get('textures', [])))
    mats = js['materials']
    print(' materials:', [(m['name'], m.get('doubleSided', False)) for m in mats])
    if len(mats) != 2: fails.append('not exactly two materials')
    if any(m.get('doubleSided') for m in mats): fails.append('double sided material')
    for m in mats:
        if m['name'] == 'Glow':
            print('  Glow emissive:', m.get('emissiveFactor'), 'base:', m['pbrMetallicRoughness'].get('baseColorFactor'))
    nodes = js['nodes']; skin = js['skins'][0]
    joints = skin['joints']; names = [nodes[j]['name'] for j in joints]
    print(' bones:', len(joints))
    if len(joints) > 64: fails.append('more than 64 bones')
    nonid = [nodes[j]['name'] for j in joints if any(abs(x) > 1e-5 for x in nodes[j].get('rotation', [0, 0, 0, 1])[:3])]
    print(' bones with non-identity rest rotation:', nonid or 'none')
    if nonid: fails.append('non-identity bone rotation')
    # world joint positions
    parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    def wpos(i):
        p = np.zeros(3)
        while i is not None:
            p = p + np.array(nodes[i].get('translation', [0, 0, 0])); i = parent.get(i)
        return p
    pos = {nodes[j]['name']: wpos(j) for j in joints}
    for k in ('Root', 'Head', 'Seg01', 'Stinger', 'Leg01_L_Upper', 'Leg01_R_Upper'):
        if k in pos: print(f'  {k}: {np.round(pos[k], 3)}')
    for need in ('Root', 'Head', 'Stinger', 'Tail1', 'Seg01'):
        if need not in pos: fails.append('missing bone ' + need)
    if 'Head' in pos and 'Seg01' in pos and not pos['Head'][2] > pos['Seg01'][2]: fails.append('Head not at +Z of Seg01')
    if 'Leg01_L_Upper' in pos and not pos['Leg01_L_Upper'][0] > 0: fails.append('_L not at +X')
    mesh_node = next(n for n in nodes if 'mesh' in n)
    prim = js['meshes'][mesh_node['mesh']]['primitives']
    P, F, J, W, C = [], [], [], [], []
    base = 0
    tri_total = 0
    for p in prim:
        a = p['attributes']
        pts = acc(js, bin_, a['POSITION']).astype(float); idx = acc(js, bin_, p['indices']).reshape(-1, 3).astype(int)
        j = acc(js, bin_, a['JOINTS_0']).astype(int); w = acc(js, bin_, a['WEIGHTS_0']).astype(float)
        if w.dtype != float or w.max() > 1.0001: w = w / (65535 if w.max() > 1.5 else 1)
        print(f'  primitive material={mats[p["material"]]["name"]} tris={len(idx)} has COLOR_0={"COLOR_0" in a} has UV={"TEXCOORD_0" in a}')
        tri_total += len(idx)
        P.append(pts); F.append(idx + base); J.append(j); W.append(w); base += len(pts)
        if mats[p['material']]['name'] == 'Glow' and 'COLOR_0' in a: fails.append('Glow has vertex colours')
    pts = np.vstack(P); faces = np.vstack(F); J = np.vstack(J); W = np.vstack(W)
    print(' triangles:', tri_total)
    print(' bbox min', np.round(pts.min(0), 3), 'max', np.round(pts.max(0), 3), 'size', np.round(pts.max(0) - pts.min(0), 3))
    if abs(pts[:, 1].min()) > 0.01: fails.append('lowest vertex not at y=0')
    ws = W.sum(1); infl = (W > 1e-6).sum(1)
    print(' weights: sum min/max', ws.min().round(5), ws.max().round(5), '| max influences', infl.max(), '| unweighted verts', int((ws < 0.5).sum()))
    if abs(ws - 1).max() > 1e-3 or infl.max() > 4 or (ws < 0.5).any(): fails.append('bad weights')
    used = set(J[W > 1e-6].tolist()); print(' joints used by skin:', len(used), 'of', len(joints))
    m = trimesh.Trimesh(vertices=pts, faces=faces, process=False)
    m.merge_vertices(digits_vertex=6) if False else None
    mm = trimesh.Trimesh(vertices=pts, faces=faces, process=True)
    mm.merge_vertices()
    e = mm.edges_sorted; _, cnt = np.unique(e, axis=0, return_counts=True)
    open_e = int((cnt == 1).sum()); nm = int((cnt > 2).sum())
    zero = int((mm.area_faces < 1e-10).sum())
    loose = len(mm.vertices) - len(np.unique(mm.faces))
    comps = mm.split(only_watertight=False)
    inward = [c for c in comps if c.is_watertight and c.volume < 0]
    print(f' open edges {open_e}, non-manifold {nm}, zero-area {zero}, loose verts {loose}, shells {len(comps)}, inward shells {len(inward)}, watertight shells {sum(c.is_watertight for c in comps)}')
    if open_e or nm or zero or loose or inward: fails.append('mesh quality')
    print(' RESULT:', 'FAIL ' + '; '.join(fails) if fails else 'ok')
    return not fails

if __name__ == '__main__':
    ok = all([check(p) for p in sys.argv[1:] if p.endswith('.glb')])
    sys.exit(0 if ok else 1)
