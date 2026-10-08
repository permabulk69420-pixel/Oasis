"""Open Oasis foundation LOD1 in background Blender and save an editable work file.

Run: blender -b --python-exit-code 1 -P tools/building/headless_foundation_lod1.py
The checked-in GLB remains untouched; output is written to tools/building/working/.
"""
import bpy
import hashlib
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "public/models/building/foundation_lod1.glb"
OUT = ROOT / "tools/building/working"


def add_area(rig, name, location, power, size, target):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.shape = 'DISK'
    data.size = size
    ob = bpy.data.objects.new(name, data)
    rig.objects.link(ob)
    ob.location = location
    ob.rotation_euler = (target - ob.location).to_track_quat('-Z', 'Y').to_euler()
    return ob


def main():
    if not SOURCE.is_file() or SOURCE.read_bytes()[:4] != b'glTF':
        raise RuntimeError(f"GLB source missing or invalid: {SOURCE}")
    OUT.mkdir(parents=True, exist_ok=True)
    source_sha256 = hashlib.sha256(SOURCE.read_bytes()).hexdigest()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        raise RuntimeError("Foundation LOD1 import contains no mesh.")

    # Compute geometry statistics and true scene-space bounds without modifying the model.
    verts = []
    tris = 0
    materials = []
    mesh_details = []
    for ob in meshes:
        ob.data.calc_loop_triangles()
        count = len(ob.data.loop_triangles)
        tris += count
        verts.extend(ob.matrix_world @ v.co for v in ob.data.vertices)
        names = [slot.material.name if slot.material else None for slot in ob.material_slots]
        materials.extend(names)
        mesh_details.append({
            "object": ob.name,
            "vertices": len(ob.data.vertices),
            "triangles": count,
            "uv_layers": [layer.name for layer in ob.data.uv_layers],
            "materials": names,
        })
    low = Vector([min(v[i] for v in verts) for i in range(3)])
    high = Vector([max(v[i] for v in verts) for i in range(3)])
    center = (low + high) / 2
    size = high - low

    # Establish invariants from tools/building/report.md (Blender is Z-up).
    if tris != 336:
        raise RuntimeError(f"Expected 336 foundation LOD1 triangles; imported {tris}")
    if not all(abs(actual - expected) < .005 for actual, expected in zip(size, (3., 3., 1.))):
        raise RuntimeError(f"Expected 3 x 3 x 1 metre bounds; observed {list(size)}")
    if not all(len(o.data.uv_layers) >= 2 for o in meshes):
        raise RuntimeError("Expected both UV channels on all foundation meshes.")

    # Keep the source meshes, materials, UVs, local origins, and snap empties unaltered.
    rig = bpy.data.collections.new("Preview rig (not part of asset)")
    bpy.context.scene.collection.children.link(rig)
    ground_mat = bpy.data.materials.new("Preview ground - not export")
    ground_mat.diffuse_color = (.095, .11, .13, 1.)
    ground_mat.use_nodes = True
    shader = ground_mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (.095, .11, .13, 1.)
    shader.inputs['Roughness'].default_value = .92

    bpy.ops.mesh.primitive_plane_add(size=2, location=(center.x, center.y, low.z - .025))
    ground = bpy.context.object
    ground.name = "PREVIEW_ONLY_ground"
    for c in list(ground.users_collection):
        c.objects.unlink(ground)
    rig.objects.link(ground)
    ground.scale = (3., 3., 1.)
    ground.data.materials.append(ground_mat)

    maxdim = max(size.x, size.y, size.z, 1.)
    target = center + Vector((0., 0., .12))
    add_area(rig, "Preview key", center + Vector((maxdim*1.7, -maxdim*1.7, maxdim*2.5)), 850, 5.0, target)
    add_area(rig, "Preview fill", center + Vector((-maxdim*1.8, -maxdim*.45, maxdim*1.5)), 500, 4.0, target)

    cam_data = bpy.data.cameras.new("Preview camera")
    camera = bpy.data.objects.new("PREVIEW_ONLY_camera", cam_data)
    rig.objects.link(camera)
    camera.location = center + Vector((maxdim*1.6, -maxdim*1.9, maxdim*1.45))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = maxdim * 1.72
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(OUT / "foundation_lod1_preview.png")
    scene.world.color = (.15, .15, .15)

    # Reopenable Blender workspace, with the asset kept distinct from the render rig.
    bpy.ops.object.select_all(action='DESELECT')
    meshes[0].select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "foundation_lod1_work.blend"))
    bpy.ops.render.render(write_still=True)

    report = {
        "source": str(SOURCE.relative_to(ROOT)),
        "sha256": source_sha256,
        "source_bytes": SOURCE.stat().st_size,
        "blender_version": bpy.app.version_string,
        "mesh_count": len(meshes),
        "triangle_count": tris,
        "bounds_min_blender_xyz": [round(float(c), 6) for c in low],
        "bounds_max_blender_xyz": [round(float(c), 6) for c in high],
        "dimensions_metres_blender_xyz": [round(float(c), 6) for c in size],
        "materials": sorted(set(m for m in materials if m)),
        "nodes": [o.name for o in bpy.context.scene.objects if o not in list(rig.objects)],
        "meshes": mesh_details,
        "checks": {
            "triangles_match_expected_336": True,
            "bounds_match_expected_3x3x1": True,
            "two_uv_sets_present": True,
            "source_glb_unchanged": hashlib.sha256(SOURCE.read_bytes()).hexdigest() == source_sha256
        },
    }
    if not report["checks"]["source_glb_unchanged"]:
        raise RuntimeError("Source GLB changed during inspection.")
    (OUT / "foundation_lod1_report.json").write_text(json.dumps(report, indent=2) + "\n")
    print("FOUNDATION_LOD1_REPORT " + json.dumps(report))


if __name__ == "__main__":
    main()
