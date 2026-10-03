"""Mesh sanity check for the exported campfire GLB (headless Blender).

    python3 tools/campfire/check_mesh.py [public/models/campfire/campfire.glb]

Welds the vertices the glTF importer splits at UV seams, then reports per mesh: loose vertices, open
(boundary) edges, non-manifold edges, zero-area faces and islands whose faces point inward. Solid
objects (Stones, Logs, Embers) must have 0 of everything; Ash is an open disc, so only its rim is open and
every face must point up. Exits non-zero if anything is wrong.
"""
import json
import struct
import sys

import bpy
import bmesh  # must come after bpy

GLB = next((a for a in sys.argv[1:] if a.endswith(".glb")), "public/models/campfire/campfire.glb")
SOLID = {"Stones", "Logs", "Embers"}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
problems = []

for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.faces.ensure_lookup_table()
    loose = sum(1 for v in bm.verts if not v.link_edges)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
    zero_area = sum(1 for f in bm.faces if f.calc_area() < 1e-8)

    seen, islands, inside_out = set(), 0, 0
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
        islands += 1
        volume = 0.0
        for g in faces:
            vs = [v.co for v in g.verts]
            for i in range(1, len(vs) - 1):
                volume += vs[0].dot(vs[i].cross(vs[i + 1])) / 6
        if volume < 0:
            inside_out += 1
    down = sum(1 for f in bm.faces if f.normal.z < -1e-6) if ob.name == "Ash" else 0  # Blender is Z-up
    print(f"{ob.name:7s} loose {loose} open_edges {boundary} non_manifold {non_manifold} zero_area {zero_area} "
          f"islands {islands} inside_out {inside_out}" + (f" faces_down {down}" if ob.name == "Ash" else ""))
    if loose or non_manifold or zero_area:
        problems.append(f"{ob.name}: loose/non-manifold/zero-area geometry")
    if ob.name in SOLID and (boundary or inside_out):
        problems.append(f"{ob.name}: open edges or inside-out faces")
    if ob.name == "Ash" and down:
        problems.append("Ash: faces point down")
    bm.free()

# Materials must be single-sided for the solid parts (the game culls the hidden insides).
with open(GLB, "rb") as fh:
    data = fh.read()
length = struct.unpack("<I", data[12:16])[0]
doc = json.loads(data[20:20 + length])
for material in doc["materials"]:
    two_sided = bool(material.get("doubleSided"))
    print(f"material {material['name']:6s} doubleSided {two_sided}")
    if two_sided:
        problems.append(f"material {material['name']} is double sided")

if problems:
    print("PROBLEMS:", *problems, sep="\n  ")
    sys.exit(1)
print("MESH CHECK OK")
