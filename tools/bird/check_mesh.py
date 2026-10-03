"""Mesh sanity check for the exported bird GLBs (headless Blender).

    python3 tools/bird/check_mesh.py [dir containing alien_bird_lod0.glb ...]

For every level of detail: welds the vertices the glTF importer splits, then reports loose vertices, open (boundary)
edges, non-manifold edges, zero-area faces and shells whose faces point inward (every part of the bird is a closed
solid, so all of those must be 0). Also checks the skinning (every vertex weighted, weights add up to 1, at most four
bones, only bones that exist), that the materials are single sided, and that all levels share one skeleton.
Exits non-zero if anything is wrong.
"""
import json
import os
import struct
import sys

import bpy
import bmesh  # must come after bpy

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
DIR = next((a for a in ARGS if os.path.isdir(a)), "public/models/creatures")
LEVELS = ["lod0", "lod1", "lod2"]
problems = []
skeletons = {}


def read_gltf(path):
    with open(path, "rb") as fh:
        data = fh.read()
    length = struct.unpack("<I", data[12:16])[0]
    return json.loads(data[20:20 + length])


for level in LEVELS:
    path = os.path.join(DIR, f"alien_bird_{level}.glb")
    if not os.path.exists(path):
        problems.append(f"{level}: {path} is missing")
        continue
    doc = read_gltf(path)
    nodes = doc["nodes"]
    skin = doc["skins"][0]
    skeletons[level] = [nodes[j]["name"] for j in skin["joints"]]
    for material in doc["materials"]:
        if material.get("doubleSided"):
            problems.append(f"{level}: material {material['name']} is double sided")
    print(f"== {level}: {len(doc['meshes'][0]['primitives'])} primitives, {len(skin['joints'])} bones, materials {[m['name'] for m in doc['materials']]}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    bone_names = {b.name for ob in bpy.data.objects if ob.type == "ARMATURE" for b in ob.data.bones}
    tris = 0
    for ob in bpy.data.objects:
        if ob.type != "MESH" or not any(m.type == "ARMATURE" for m in ob.modifiers):
            continue  # the importer's little bone-display shapes are not part of the bird
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.faces.ensure_lookup_table()
        tris += sum(len(f.verts) - 2 for f in bm.faces)
        loose = sum(1 for v in bm.verts if not v.link_edges)
        boundary = sum(1 for e in bm.edges if e.is_boundary)
        non_manifold = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
        zero_area = sum(1 for f in bm.faces if f.calc_area() < 1e-9)

        seen, shells, inside_out = set(), 0, 0
        for f in bm.faces:
            if f.index in seen:
                continue
            stack, faces = [f], []
            seen.add(f.index)
            while stack:
                g = stack.pop()
                faces.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen:
                            seen.add(h.index)
                            stack.append(h)
            shells += 1
            volume = 0.0
            for g in faces:
                vs = [v.co for v in g.verts]
                for i in range(1, len(vs) - 1):
                    volume += vs[0].dot(vs[i].cross(vs[i + 1])) / 6
            if volume <= 0:
                inside_out += 1

        # skinning
        group_names = {g.index: g.name for g in ob.vertex_groups}
        unweighted = overweight = bad_sum = unknown = 0
        for v in ob.data.vertices:
            ws = [(group_names[g.group], g.weight) for g in v.groups if g.weight > 1e-6]
            if not ws:
                unweighted += 1
                continue
            if len(ws) > 4:
                overweight += 1
            if abs(sum(w for _, w in ws) - 1.0) > 0.01:
                bad_sum += 1
            if any(n not in bone_names for n, _ in ws):
                unknown += 1
        print(f"   {ob.name}: loose {loose} open_edges {boundary} non_manifold {non_manifold} zero_area {zero_area} shells {shells} "
              f"inside_out {inside_out} | unweighted {unweighted} over_4_bones {overweight} weights_not_1 {bad_sum} unknown_bone {unknown}")
        if loose or boundary or non_manifold or zero_area or inside_out:
            problems.append(f"{level}/{ob.name}: loose vertices, open or non-manifold edges, zero-area faces or inside-out shells")
        if unweighted or overweight or bad_sum or unknown:
            problems.append(f"{level}/{ob.name}: bad skin weights")
        bm.free()
    print(f"   triangles {tris}")

reference = skeletons.get("lod0")
for level, names in skeletons.items():
    if names != reference:
        problems.append(f"{level} has a different skeleton from lod0")

if problems:
    print("PROBLEMS:", *problems, sep="\n  ")
    sys.exit(1)
print("MESH CHECK OK")
