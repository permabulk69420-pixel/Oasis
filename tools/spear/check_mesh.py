"""Mesh sanity check for the exported spear GLB (headless Blender).

    python3 tools/spear/check_mesh.py [public/models/spear/spear.glb]

Welds the vertices the glTF importer splits, then reports per mesh: loose vertices, open (boundary) edges,
non-manifold edges, zero-area faces, shells whose faces point inward and the triangle count. Every part of the spear
(shaft, grip wrap and bands, stone point, lashing, knot, cord, beads, feathers) is a closed solid, so all of those must
be 0. Also checks that the materials are single sided, that the two objects the game looks up by name exist (Spear, which
carries the Spear and Glow materials, and Shaft, the grip), that the model is as long as it should be and that it stays
inside the Quest triangle budget. The spear is a small held tool, so it has one level of detail. Exits non-zero if anything
is wrong.
"""
import json
import struct
import sys

import bpy
import bmesh  # must come after bpy

GLB = next((a for a in sys.argv[1:] if a.endswith(".glb")), "public/models/spear/spear.glb")
NODES = {"Spear", "Shaft"}
MATERIALS = {"Spear", "Glow"}
TRIANGLE_BUDGET = 3000

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
    print(f"{ob.name:12s} tris {tris:5d} loose {loose} open_edges {boundary} non_manifold {non_manifold} "
          f"zero_area {zero_area} shells {shells} inside_out {inside_out}")
    if loose or boundary or non_manifold or zero_area or inside_out:
        problems.append(f"{ob.name}: loose vertices, open or non-manifold edges, zero-area faces or inside-out shells")
    bm.free()

# The game stands it upright in the sand and holds it by the middle of the grip, which is the origin: the butt must be
# about half a metre below that, the tip about 0.9 m above it. (Blender is Z up; the importer turns glTF +Y into +Z.)
low, high = 1e9, -1e9
for ob in bpy.data.objects:
    if ob.type == "MESH":
        for v in ob.data.vertices:
            z = (ob.matrix_world @ v.co).z
            low, high = min(low, z), max(high, z)
print(f"spear runs from {low:.3f} to {high:.3f} m about the grip")
if not (-0.56 <= low <= -0.48 and 0.88 <= high <= 0.99):
    problems.append(f"the spear runs from {low:.3f} to {high:.3f}, expected about -0.52 to 0.935")

print(f"triangles {total} (budget {TRIANGLE_BUDGET})")
if total > TRIANGLE_BUDGET:
    problems.append(f"{total} triangles is over the budget of {TRIANGLE_BUDGET}")
if names != NODES:
    problems.append(f"objects are {sorted(names)}, expected {sorted(NODES)}")

# The materials must be single sided: every part is closed, so the game can cull the hidden insides.
with open(GLB, "rb") as fh:
    data = fh.read()
length = struct.unpack("<I", data[12:16])[0]
doc = json.loads(data[20:20 + length])
found = set()
for material in doc["materials"]:
    two_sided = bool(material.get("doubleSided"))
    found.add(material["name"])
    print(f"material {material['name']:6s} doubleSided {two_sided}")
    if two_sided:
        problems.append(f"material {material['name']} is double sided")
if found != MATERIALS:
    problems.append(f"materials are {sorted(found)}, expected {sorted(MATERIALS)}")

if problems:
    print("PROBLEMS:", *problems, sep="\n  ")
    sys.exit(1)
print("MESH CHECK OK")
