"""Mesh sanity check for the glow plant GLBs (headless Blender).

    python3 tools/glow-plants/check_mesh.py [directory holding glow_reed_lod0..2.glb and lantern_bloom_lod0..2.glb]

For each plant and level of detail, welds the vertices the glTF importer splits and checks the two kinds of surface apart:
  stems and bulbs (the reed has "Glow violet" too, the lantern has only stem and "Glow") must be closed solids facing outward: no loose vertices, no open
    or non-manifold edges, no zero-area faces, no shell whose faces point inward. They are single sided.
  leaves ("Glow plant leaf") are thin double-sided sheets, so open edges are right, but there must be no loose vertices, no
    zero-area faces and no edge shared by three faces.
It also checks what the game relies on: one object with exactly those four materials (the game picks the glow materials by
name), every primitive has positions, normals, vertex colours and UVs (u and v in 0..1 for leaves and bulbs), the levels
shrink inside their triangle budgets, the height fits the wind sway profile in src/glow-garden.js, and the foot is on the
ground. Exits non-zero if anything is wrong.
"""
import json
import os
import struct
import sys

import bpy
import bmesh  # must come after bpy

DIR = next((a for a in sys.argv[1:] if not a.startswith("-") and not a.endswith(".py")), "public/models/vegetation/glow-plants")
LEAF = "Glow plant leaf"
PLANTS = {
    "glow_reed": dict(node="GlowReed", solids=["Glow plant stem", "Glow", "Glow violet"], height=(1.2, 1.6), budget={0: (3500, 7000), 1: (1000, 2200), 2: (250, 700)}),
    "lantern_bloom": dict(node="LanternBloom", solids=["Glow plant stem", "Glow"], height=(1.5, 2.0), budget={0: (4500, 9500), 1: (1200, 2800), 2: (300, 800)}),
}
problems = []


def shells_inside_out(bm):
    seen, inside_out, shells = set(), 0, 0
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
    return shells, inside_out


def check(plant, spec, level, totals):
    path = os.path.join(DIR, f"{plant}_lod{level}.glb")
    tag = f"{plant} LOD{level}"
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if [o.name for o in meshes] != [spec["node"]]:
        problems.append(f"{tag}: objects are {[o.name for o in meshes]}, expected [{spec['node']!r}]")
        return
    ob = meshes[0]
    slots = [s.material.name for s in ob.material_slots]
    SOLIDS = spec["solids"]
    if sorted(slots) != sorted(SOLIDS + [LEAF]):
        problems.append(f"{tag}: materials are {slots}")
        return
    total = 0
    for name in SOLIDS + [LEAF]:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if slots[f.material_index] != name], context="FACES")
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        tris = sum(len(f.verts) - 2 for f in bm.faces)
        total += tris
        loose = sum(1 for v in bm.verts if not v.link_edges)
        boundary = sum(1 for e in bm.edges if e.is_boundary)
        non_manifold = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
        zero_area = sum(1 for f in bm.faces if f.calc_area() < 1e-10)
        shells, inside_out = shells_inside_out(bm)
        print(f"{tag} {name:16s} tris {tris:5d} loose {loose} open_edges {boundary} non_manifold {non_manifold} zero_area {zero_area} shells {shells} "
              + (f"inside_out {inside_out}" if name != LEAF else "(open sheets)"))
        if name == LEAF:
            if loose or non_manifold or zero_area:
                problems.append(f"{tag}: the leaves have loose vertices, an edge shared by three faces or zero-area faces")
        elif tris and (loose or boundary or non_manifold or zero_area or inside_out):
            problems.append(f"{tag}: {name} is not closed solids facing outward")
        bm.free()
    lo, hi = spec["budget"][level]
    print(f"{tag} triangles {total} (budget {lo} to {hi})")
    if not lo <= total <= hi:
        problems.append(f"{tag}: {total} triangles is outside {lo} to {hi}")
    totals[level] = total
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    top, bottom = max(p.z for p in pts), min(p.z for p in pts)   # Blender is Z up: glTF +Y arrives as +Z
    print(f"{tag} runs from {bottom:.2f} to {top:.2f} m")
    if not spec["height"][0] <= top <= spec["height"][1]:
        problems.append(f"{tag}: {top:.2f} m tall, expected {spec['height'][0]} to {spec['height'][1]}")
    if bottom < -0.05 or bottom > 0.02:
        problems.append(f"{tag}: the lowest point is {bottom:.2f} m, the foot should sit on the ground")
    uv = ob.data.uv_layers.active
    if uv is None:
        problems.append(f"{tag}: no UV map")
    else:
        flat = [d.uv for d in uv.data]
        lo_u, hi_u = min(c[0] for c in flat), max(c[0] for c in flat)
        if lo_u < -1e-4 or hi_u > 1 + 1e-4:
            problems.append(f"{tag}: u runs {lo_u:.2f} to {hi_u:.2f}, expected 0 to 1")
    with open(path, "rb") as fh:
        data = fh.read()
    doc = json.loads(data[20:20 + struct.unpack("<I", data[12:16])[0]])
    for material in doc["materials"]:
        two_sided = bool(material.get("doubleSided"))
        if two_sided != (material["name"] == LEAF):
            problems.append(f"{tag}: material {material['name']} double-sided is {two_sided}")
    for mesh in doc["meshes"]:
        for primitive in mesh["primitives"]:
            for attribute in ("POSITION", "NORMAL", "COLOR_0", "TEXCOORD_0"):
                if attribute not in primitive["attributes"]:
                    problems.append(f"{tag}: a primitive has no {attribute}")


for plant, spec in PLANTS.items():
    totals = {}
    for lod in range(3):
        check(plant, spec, lod, totals)
    if len(totals) == 3 and not totals[0] > totals[1] > totals[2]:
        problems.append(f"{plant}: the levels do not shrink: {totals}")

if problems:
    print("PROBLEMS:", *problems, sep="\n  ")
    sys.exit(1)
print("MESH CHECK OK")
