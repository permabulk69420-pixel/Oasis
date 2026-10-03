"""Cap the open ends of the veil tree's bark tubes (Trunk, Limbs, Strands) in the GLB itself."""
import json, struct, sys
import numpy as np

SRC, DST = sys.argv[1], sys.argv[2]
TARGETS = {'Trunk', 'Limbs', 'Strands'}
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

d = open(SRC, 'rb').read()
_, _, total = struct.unpack('<4sII', d[:12])
off, chunks = 12, {}
while off < total:
    l, t = struct.unpack('<I4s', d[off:off + 8]); chunks[t] = d[off + 8:off + 8 + l]; off += 8 + l
j = json.loads(chunks[b'JSON']); bin_ = chunks[b'BIN\x00']

def read(ai):
    a = j['accessors'][ai]; bv = j['bufferViews'][a['bufferView']]
    n = NC[a['type']]; dt = np.dtype(CT[a['componentType']])
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or n * dt.itemsize
    if stride == n * dt.itemsize:
        arr = np.frombuffer(bin_, dtype=dt, count=a['count'] * n, offset=start).reshape(a['count'], n).copy()
    else:
        arr = np.stack([np.frombuffer(bin_, dtype=dt, count=n, offset=start + i * stride) for i in range(a['count'])])
    return arr

new_data = {}   # accessor index -> (array, target)
stats = {}
for mesh in j['meshes']:
    if mesh['name'] not in TARGETS: continue
    prim = mesh['primitives'][0]; at = prim['attributes']
    pos = read(at['POSITION']).astype(np.float64)
    idx = read(prim['indices']).reshape(-1, 3).astype(np.int64)
    welded = {}
    wid = np.empty(len(pos), np.int64)
    for i, p in enumerate(np.round(pos * 1e4).astype(np.int64)):
        wid[i] = welded.setdefault(tuple(p), len(welded))
    edges = {}
    for t in idx:
        for k in range(3):
            a, b = t[k], t[(k + 1) % 3]
            wa, wb = wid[a], wid[b]
            if wa == wb: continue
            edges.setdefault((min(wa, wb), max(wa, wb)), []).append((a, b))
    boundary = [v[0] for v in edges.values() if len(v) == 1]
    # group boundary half-edges into loops by welded vertex connectivity
    nxt = {}
    for a, b in boundary: nxt.setdefault(wid[a], []).append((a, b))
    seen = set(); loops = []
    for a, b in boundary:
        if (a, b) in seen: continue
        loop = []; stack = [(a, b)]
        while stack:
            e = stack.pop()
            if e in seen: continue
            seen.add(e); loop.append(e)
            for e2 in nxt.get(wid[e[1]], []) + nxt.get(wid[e[0]], []):
                if e2 not in seen: stack.append(e2)
        loops.append(loop)
    attrs = {k: read(v) for k, v in at.items()}
    add = {k: [] for k in attrs}; add_idx = []; base = len(pos)
    for loop in loops:
        pts = np.array([pos[a] for a, b in loop] + [pos[b] for a, b in loop])
        c = pts.mean(axis=0)
        for a, b in loop:
            tri = np.array([pos[b], pos[a], c]); n = np.cross(tri[1] - tri[0], tri[2] - tri[0])
            ln = np.linalg.norm(n)
            if ln < 1e-12: continue
            n = n / ln
            for k, v in attrs.items():
                if k == 'POSITION': add[k].extend(tri)
                elif k == 'NORMAL': add[k].extend([n] * 3)
                else: add[k].extend([v[a]] * 3)   # UV and colour: sample the ring's own bark
            add_idx.extend([base, base + 1, base + 2]); base += 3
    for k, v in attrs.items():
        new_data[at[k]] = (np.concatenate([v, np.array(add[k], dtype=v.dtype).reshape(-1, v.shape[1])]) if add[k] else v, 34962)
    ia = np.concatenate([idx.reshape(-1), np.array(add_idx, dtype=np.int64)])
    new_data[prim['indices']] = (ia.astype(np.uint32 if base > 65535 else np.uint16), 34963)
    stats[mesh['name']] = (len(loops), len(boundary), len(add_idx) // 3)
print('loops, boundary edges, cap triangles:', stats)

# Rebuild the binary buffer compactly.
out = bytearray(); new_views = []; acc_view = {}
def push(data, target=None):
    while len(out) % 4: out.append(0)
    v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
    if target: v['target'] = target
    out.extend(data); new_views.append(v); return len(new_views) - 1
used_views = set()
for ai, a in enumerate(j['accessors']):
    bvi = a['bufferView']; used_views.add(bvi)
    if ai in new_data:
        arr, target = new_data[ai]
        a['count'] = len(arr)
        if a['type'] == 'VEC3' and a.get('componentType') == 5126 and 'min' in a:
            a['min'] = arr.min(axis=0).astype(float).tolist(); a['max'] = arr.max(axis=0).astype(float).tolist()
        if a['type'] == 'SCALAR': a['componentType'] = 5125 if arr.dtype == np.uint32 else 5123
        dtype = CT[a['componentType']]
        acc_view[ai] = push(np.ascontiguousarray(arr.astype(dtype)).tobytes(), target)
    else:
        arr = read(ai)
        bv = j['bufferViews'][bvi]
        acc_view[ai] = push(np.ascontiguousarray(arr).tobytes(), bv.get('target'))
    a['bufferView'] = acc_view[ai]; a.pop('byteOffset', None)
for img in j['images']:
    bv = j['bufferViews'][img['bufferView']]
    img['bufferView'] = push(bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])
j['bufferViews'] = new_views; j['buffers'] = [{'byteLength': len(out)}]
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(out) % 4: out.append(0)
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(out), b'BIN\x00') + bytes(out)
open(DST, 'wb').write(glb); print('wrote', DST, len(glb))
