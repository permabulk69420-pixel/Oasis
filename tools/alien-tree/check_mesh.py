"""Mesh sanity check for the three exported alien tree GLBs (headless Blender).

    python3 tools/alien-tree/check_mesh.py [directory holding alien_tree_lod0.glb, _lod1.glb, _lod2.glb]

For each level of detail, welds the vertices the glTF importer splits and checks the two kinds of surface apart:
  bark ("Banded teal bark", the trunk and the roots) must be closed solids facing outward: no loose vertices, no open or
    non-manifold edges, no zero-area faces, no shell whose faces point inward. It is single sided, so the game can cull
    the insides.
  leaves ("Waxy blue leaf tissue", the fronds and veils) are thin double-sided sheets, so open edges are right, but there
    must be no loose vertices, no zero-area faces and no edge shared by three faces.
It also checks what the game relies on: one object called AlienTree with those two materials, the levels shrinking in
triangles inside their budgets, the height (the wind sway profile in src/wind.js is cut for 4.4 m), a straight trunk on
the origin up to the axe's chop height, a trunk the axe can hit, and fronds high enough to walk under. Exits non-zero if
anything is wrong.
"""
import json
import math
import os
import struct
import sys

import bpy
import bmesh  # must come after bpy

DIR = next((a for a in sys.argv[1:] if not a.startswith("-") and not a.endswith(".py")), "public/models/vegetation/alien-tree")
BARK, LEAF = "Banded teal bark", "Waxy blue leaf tissue"
BUDGET = {0: (3500, 6000), 1: (1000, 2000), 2: (250, 700)}   # (at least, at most) triangles
TREE_HEIGHT = (4.3, 4.7)
CHOP_TOP = 1.9               # src/axe.js TREE_CHOP_TOP: the trunk must be straight and on the origin up to here
TRUNK_RADIUS = (0.08, 0.16)  # around src/axe.js TREE_TRUNK_RADIUS 0.12, measured at 1 m
CROWN_CENTRE = (0.364, 0.138)  # where the fronds leave the leaning trunk, in Blender axes
LOWEST_FROND = 2.4           # leaves further than 0.45 m from the trunk stay above this (a head is 1.7 m up)

problems = []


def check_level(level):
    path = os.path.join(DIR, f"alien_tree_lod{level}.glb")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if [o.name for o in meshes] != ["AlienTree"]:
        problems.append(f"LOD{level}: objects are {[o.name for o in meshes]}, expected ['AlienTree']")
        return
    ob = meshes[0]
    slots = [s.material.name for s in ob.material_slots]
    if sorted(slots) != sorted([BARK, LEAF]):
        problems.append(f"LOD{level}: materials are {slots}")
        return

    total = 0
    for name in (BARK, LEAF):
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.faces.ensure_lookup_table()
        drop = [f for f in bm.faces if slots[f.material_index] != name]
        bmesh.ops.delete(bm, geom=drop, context="FACES")
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        tris = sum(len(f.verts) - 2 for f in bm.faces)
        total += tris
        loose = sum(1 for v in bm.verts if not v.link_edges)
        boundary = sum(1 for e in bm.edges if e.is_boundary)
        non_manifold = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
        zero_area = sum(1 for f in bm.faces if f.calc_area() < 1e-9)

        inside_out = shells = 0
        seen = set()
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
        facing = f"inside_out {inside_out}" if name == BARK else "(open sheets: no inside)"
        print(f"LOD{level} {name:22s} tris {tris:5d} loose {loose} open_edges {boundary} non_manifold {non_manifold} "
              f"zero_area {zero_area} shells {shells} {facing}")
        if name == BARK:
            if loose or boundary or non_manifold or zero_area or inside_out:
                problems.append(f"LOD{level}: the bark is not closed solids facing outward")
        elif loose or non_manifold or zero_area:
            problems.append(f"LOD{level}: the leaves have loose vertices, an edge shared by three faces or zero-area faces")
        bm.free()

    lo, hi = BUDGET[level]
    print(f"LOD{level} triangles {total} (budget {lo} to {hi})")
    if not lo <= total <= hi:
        problems.append(f"LOD{level}: {total} triangles is outside {lo} to {hi}")
    totals[level] = total

    # Geometry the game relies on. (Blender is Z up; the importer turns glTF +Y into +Z.)
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    top = max(p.z for p in pts)
    bottom = min(p.z for p in pts)
    print(f"LOD{level} runs from {bottom:.2f} to {top:.2f} m")
    if not TREE_HEIGHT[0] <= top <= TREE_HEIGHT[1]:
        problems.append(f"LOD{level}: {top:.2f} m tall, expected {TREE_HEIGHT[0]} to {TREE_HEIGHT[1]}")
    if bottom < -0.35 or bottom > 0.0:   # the near level sinks its buttress feet 0.3 m (a tree on a slope shows no underside)
        problems.append(f"LOD{level}: the lowest point is {bottom:.2f} m; the base should sink a little (0 to -0.35 m) into the ground")
    # the trunk is the bark ring of vertices near each height: its centre must stay on the origin up to the chop height
    bark_pts = []
    for poly in ob.data.polygons:
        if slots[poly.material_index] == BARK:
            for i in poly.vertices:
                bark_pts.append(ob.matrix_world @ ob.data.vertices[i].co)
    lowest_bark = [p for p in bark_pts if 0.9 < p.z < 1.1]
    if lowest_bark:
        cx = sum(p.x for p in lowest_bark) / len(lowest_bark)
        cy = sum(p.y for p in lowest_bark) / len(lowest_bark)
        radius = max(math.hypot(p.x - cx, p.y - cy) for p in lowest_bark)
        print(f"LOD{level} trunk at 1 m: centre ({cx:.3f}, {cy:.3f}), radius {radius:.3f}")
        if not TRUNK_RADIUS[0] <= radius <= TRUNK_RADIUS[1]:
            problems.append(f"LOD{level}: trunk radius {radius:.3f} at 1 m, expected {TRUNK_RADIUS[0]} to {TRUNK_RADIUS[1]}")
    for z in (0.5, 1.0, 1.5, CHOP_TOP):
        ring = [p for p in bark_pts if abs(p.z - z) < 0.06]
        if ring:
            cx = sum(p.x for p in ring) / len(ring)
            cy = sum(p.y for p in ring) / len(ring)
            if math.hypot(cx, cy) > 0.03:
                problems.append(f"LOD{level}: the trunk centre is {math.hypot(cx, cy):.3f} m off the origin at {z} m, "
                                f"but the axe's chop zone is centred on it up to {CHOP_TOP} m")
    leaf_pts = []
    for poly in ob.data.polygons:
        if slots[poly.material_index] == LEAF:
            for i in poly.vertices:
                leaf_pts.append(ob.matrix_world @ ob.data.vertices[i].co)
    # The trunk leans toward the top, so "beside the trunk" is measured from the crown (trunk_center(CROWN_Y) in the builder; Blender
    # has glTF z as -y), not from the base.
    out = [p for p in leaf_pts if math.hypot(p.x - CROWN_CENTRE[0], p.y - CROWN_CENTRE[1]) > 0.45]
    lowest = min(p.z for p in out)
    reach = max(math.hypot(p.x, p.y) for p in out)
    print(f"LOD{level} fronds: lowest {lowest:.2f} m, reach {reach:.2f} m")
    if lowest < LOWEST_FROND:
        problems.append(f"LOD{level}: a frond hangs down to {lowest:.2f} m; people walk under them")

    with open(path, "rb") as fh:
        data = fh.read()
    doc = json.loads(data[20:20 + struct.unpack("<I", data[12:16])[0]])
    for material in doc["materials"]:
        two_sided = bool(material.get("doubleSided"))
        print(f"LOD{level} material {material['name']:22s} doubleSided {two_sided}")
        if two_sided != (material["name"] == LEAF):
            problems.append(f"LOD{level}: material {material['name']} double-sided is {two_sided}")
    for mesh in doc["meshes"]:
        for primitive in mesh["primitives"]:
            for attribute in ("POSITION", "NORMAL", "COLOR_0"):
                if attribute not in primitive["attributes"]:
                    problems.append(f"LOD{level}: a primitive has no {attribute}")


totals = {}
for lod in range(3):
    check_level(lod)
if len(totals) == 3 and not totals[0] > totals[1] > totals[2]:
    problems.append(f"the levels do not shrink: {totals}")

if problems:
    print("PROBLEMS:", *problems, sep="\n  ")
    sys.exit(1)
print("MESH CHECK OK")
