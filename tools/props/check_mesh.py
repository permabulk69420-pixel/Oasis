"""Mesh sanity check for an exported prop GLB (headless Blender).

    python3 tools/props/check_mesh.py file.glb --nodes Pickaxe,Shaft --materials Pickaxe,Glow --budget 3000 [--yrange -0.35,0.55]

Welds the vertices the glTF importer splits, then reports per mesh: loose vertices, open (boundary) edges, non-manifold edges,
zero-area faces, shells whose faces point inward and the triangle count. Every part of a prop built with tools/props/propkit.py is
a closed solid, so all of those must be 0. Also checks that the materials are single sided, that the objects the game looks up
by name exist (exactly --nodes), that the materials are exactly --materials, that the model's height runs inside --yrange (glTF Y,
the importer's Blender Z) and that the triangle count is inside --budget. Exits non-zero if anything is wrong.
"""
import json
import struct
import sys

import bpy
import bmesh  # must come after bpy

A = sys.argv


def opt(name, default):
    return A[A.index(name) + 1] if name in A else default


GLB = next((a for a in A[1:] if a.endswith(".glb")), None)
if not GLB:
    sys.exit("usage: check_mesh.py file.glb --nodes A,B --materials X,Y --budget N [--yrange lo,hi]")
NODES = set(opt("--nodes", "").split(",")) - {""}
MATERIALS = set(opt("--materials", "").split(",")) - {""}
TRIANGLE_BUDGET = int(opt("--budget", "5000"))
YRANGE = [float(x) for x in opt("--yrange", "").split(",")] if "--yrange" in A else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
problems = []
total = 0
names = set()

for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    names.add(ob.name)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.faces.ensure_lookup_table()
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    total += tris
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
    print(f"{ob.name:14s} tris {tris:5d} loose {loose} open_edges {boundary} non_manifold {non_manifold} "
          f"zero_area {zero_area} shells {shells} inside_out {inside_out}")
    if loose or boundary or non_manifold or zero_area or inside_out:
        problems.append(f"{ob.name}: loose vertices, open or non-manifold edges, zero-area faces or inside-out shells")
    bm.free()

low, high = 1e9, -1e9
for ob in bpy.data.objects:
    if ob.type == "MESH":
        for v in ob.data.vertices:
            z = (ob.matrix_world @ v.co).z   # the importer turns glTF +Y into Blender +Z
            low, high = min(low, z), max(high, z)
print(f"runs from {low:.3f} to {high:.3f} m about the origin")
if YRANGE and not (YRANGE[0] - 0.03 <= low <= YRANGE[0] + 0.03 and YRANGE[1] - 0.05 <= high <= YRANGE[1] + 0.05):
    problems.append(f"it runs from {low:.3f} to {high:.3f}, expected about {YRANGE[0]} to {YRANGE[1]}")

print(f"triangles {total} (budget {TRIANGLE_BUDGET})")
if total > TRIANGLE_BUDGET:
    problems.append(f"{total} triangles is over the budget of {TRIANGLE_BUDGET}")
if NODES and names != NODES:
    problems.append(f"objects are {sorted(names)}, expected {sorted(NODES)}")

with open(GLB, "rb") as fh:
    data = fh.read()
length = struct.unpack("<I", data[12:16])[0]
doc = json.loads(data[20:20 + length])
found = set()
for material in doc["materials"]:
    two_sided = bool(material.get("doubleSided"))
    found.add(material["name"])
    print(f"material {material['name']:10s} doubleSided {two_sided}")
    if two_sided:
        problems.append(f"material {material['name']} is double sided")
if MATERIALS and found != MATERIALS:
    problems.append(f"materials are {sorted(found)}, expected {sorted(MATERIALS)}")

if problems:
    print("PROBLEMS:", *problems, sep="\n  ")
    sys.exit(1)
print("MESH CHECK OK")
