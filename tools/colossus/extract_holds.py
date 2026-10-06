"""The Colossus's climbing holds, read from its model (the owner, 7 Oct: climb it hand over hand by its crystals).

    python3 tools/colossus/extract_holds.py [lod0.glb] [out.json]

Reads public/models/colossus/colossus_01_lod0.glb (the only level with every crystal; all three share one skeleton) and writes
public/models/colossus/colossus_01_holds.json: every crystal (each is a separate closed solid weighted 100% to one bone, see BRIEF.md and the check
report) as a hold in its bone's own frame, so the game can find it on whichever level is on show, however the creature is posed:

    { "bones": [names], "holds": [[bone, x, y, z, ax, ay, az, length, radius], ...] }

x, y, z: the crystal's middle (its grab point); ax, ay, az: its axis from base to tip (unit); length (metres) and radius (the base's, metres).
All in the bone's frame (the skin's inverse bind matrix times the rest position), so world = bone.matrixWorld * point.
Pure Python + numpy: it reads the glTF binary directly (the mesh nodes have no transforms of their own).
"""
import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'public', 'models', 'colossus', 'colossus_01_lod0.glb')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'public', 'models', 'colossus', 'colossus_01_holds.json')

data = open(SRC, 'rb').read()
json_len = struct.unpack('<I', data[12:16])[0]
gltf = json.loads(data[20:20 + json_len])
bin_start = 20 + json_len + 8
binary = data[bin_start:]
COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
SIZE = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def accessor(i):
    a = gltf['accessors'][i]
    view = gltf['bufferViews'][a['bufferView']]
    dtype = np.dtype(COMP[a['componentType']])
    n, k = a['count'], SIZE[a['type']]
    offset = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = view.get('byteStride', dtype.itemsize * k)
    raw = np.frombuffer(binary, dtype=np.uint8, count=stride * (n - 1) + dtype.itemsize * k, offset=offset)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(n, dtype.itemsize * k), strides=(stride, 1))
    out = np.frombuffer(rows.copy().tobytes(), dtype=dtype).reshape(n, k).astype(np.float64)
    if a.get('normalized'):
        out /= np.iinfo(dtype).max
    return out


crystal = next(i for i, m in enumerate(gltf['materials']) if m['name'] == 'Colossus crystal')
skin = gltf['skins'][0]
joint_nodes = skin['joints']
bone_names = [gltf['nodes'][j]['name'] for j in joint_nodes]
ibm = accessor(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)       # column-major in the file

holds = []
for node in gltf['nodes']:
    if 'mesh' not in node:
        continue
    assert not any(k in node for k in ('translation', 'rotation', 'scale', 'matrix')), 'a mesh node with its own transform'
    for prim in gltf['meshes'][node['mesh']]['primitives']:
        if prim.get('material') != crystal:
            continue
        pos = accessor(prim['attributes']['POSITION'])
        joints = accessor(prim['attributes']['JOINTS_0']).astype(int)
        weights = accessor(prim['attributes']['WEIGHTS_0'])
        idx = accessor(prim['indices']).astype(int).reshape(-1, 3)
        # the separate crystals: vertices joined by faces (and welded where they share a position)
        parent = np.arange(len(pos))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a
        keys = {}
        for v, p in enumerate(np.round(pos * 1e5).astype(np.int64)):
            k = tuple(p)
            if k in keys:
                parent[find(v)] = find(keys[k])
            else:
                keys[k] = v
        for a, b, c in idx:
            ra, rb, rc = find(a), find(b), find(c)
            parent[rb] = ra
            parent[find(rc)] = ra
        roots = np.array([find(v) for v in range(len(pos))])
        for r in np.unique(roots):
            vs = np.where(roots == r)[0]
            if len(vs) < 4:
                continue
            p = pos[vs]
            bone = int(np.bincount(joints[vs, 0], weights=weights[vs, 0]).argmax()) if weights[vs, 0].max() > 0.5 else int(joints[vs[0], 0])
            centre = p.mean(0)
            # its axis: the long direction; the base is the wider end
            u, s, vt = np.linalg.svd(p - centre, full_matrices=False)
            axis = vt[0]
            t = (p - centre) @ axis
            radial = np.linalg.norm((p - centre) - np.outer(t, axis), axis=1)
            lo, hi = t.min(), t.max()
            near_lo = radial[t < lo + 0.25 * (hi - lo)].mean()
            near_hi = radial[t > hi - 0.25 * (hi - lo)].mean()
            if near_hi > near_lo:                     # the wide end is the base: the axis runs base to tip
                axis, t, (lo, hi), (near_lo, near_hi) = -axis, -t, (-hi, -lo), (near_hi, near_lo)
            length = hi - lo
            base_radius = float(np.percentile(radial[t < lo + 0.3 * length], 75))
            # the grab point: a little toward the base from the middle, where a hand closes round it
            grab = centre + axis * (lo + 0.45 * length)
            # into the bone's frame
            m = ibm[bone]
            g = m @ np.append(grab, 1.0)
            a = m[:3, :3] @ axis
            a /= np.linalg.norm(a)
            holds.append([bone, *np.round(g[:3], 4).tolist(), *np.round(a, 4).tolist(), round(float(length), 3), round(base_radius, 3)])

holds.sort(key=lambda h: (h[0], h[2]))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({'source': os.path.basename(SRC), 'bones': bone_names, 'holds': holds}, open(OUT, 'w'), separators=(',', ':'))
by_bone = {}
for h in holds:
    by_bone[bone_names[h[0]]] = by_bone.get(bone_names[h[0]], 0) + 1
print(f'{len(holds)} holds -> {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KB)')
print('length median', np.median([h[7] for h in holds]), 'radius median', np.median([h[8] for h in holds]))
print(sorted(by_bone.items(), key=lambda kv: -kv[1])[:12])
