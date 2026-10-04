# Dune Stinger — measured export report

Original authored procedural geometry: eight shingled keel plates, sixteen swept blade legs, paired sickle mandibles and a raised venom lancet. Warm sand/bronze shell, charcoal flexible tissue, small cyan eye banks and a cyan lancet seam. No downloaded or stock creature meshes.

| LOD | Triangles | Bytes | Bones | Closed shells | Dimensions X / Y / Z (m) |
|---|---:|---:|---:|---:|---|
| 0 | 4,482 | 238,692 | 49 | 67 | 0.6892 / 0.5992 / 1.4412 |
| 1 | 1,560 | 115,244 | 49 | 41 | 0.6892 / 0.5972 / 1.4412 |
| 2 | 582 | 65,964 | 49 | 33 | 0.6888 / 0.6004 / 1.4462 |

All numbers above are read from the final GLBs. `measured_checks.json` contains full per-level bounds, materials, skeleton and check results. Geometry is also re-opened with trimesh, independently of Blender.

Identical names, hierarchy and joint positions across supplied levels: **True**. Each file contains one mesh, two material primitives and one 49-joint skin. Blender’s armature wrapper is removed on export; the Root joint and skinned mesh are the two scene roots. No other scene objects, animation clips, textures, UVs, tangents or extensions.

## Geometry and skin checks

| LOD | Open edges | Non-manifold edges | Winding errors | Loose vertices | Zero-area faces | Duplicate faces | Coplanar overlap pairs | Inward shells | Max influences | Weight sum error |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |

Topology checks weld glTF seam duplicates by position to 1e-7 m. Winding is verified by opposed directed edges and positive signed volume per connected closed shell. Coplanar tests group planes to 1e-5 and test positive triangle-intersection area. Intentional non-coplanar penetration of closed armour and tissue shells is used at articulations; this is not a unioned printable solid. All weights refer to existing joints; every vertex is weighted. No modelling modifiers are used. The Blender armature modifier is retained solely to export the skin.

## Axes and materials

+Y is up, the head and mandibles lie toward +Z, and `_L` joints have positive X. The lowest exported vertices are at Y = 0. The ground origin lies under the central body. Mesh transform is identity. All joint world rest orientations are identity to floating-point precision; local bone rotations are also identity. Joint frames and inverse bind matrices are checked numerically.

`Stinger`: vertex layer Col → COLOR_0, metallic 0.22, roughness 0.46. `Glow`: base (0.02, 0.08, 0.10), emission (0.25, 0.95, 1), strength 1.0, metallic 0, roughness 0.38. Both are opaque and single sided (glTF doubleSided omitted, which means false). No emissive-strength extension. Blender 4.5 adds a dummy white colour attribute to Glow; the script removes only that attribute from the exported primitive. No geometry or skin data is changed by this cleanup.

## Rig and use

49 joints: Root, Head, eight Seg bones, four Tail bones, Stinger, 32 leg bones, Mandible_L and Mandible_R. Mandibles are children of Head. Each segment pivot sits at the front of its plate. All edit bones point along Blender +Z, yielding glTF +Y joint frames after export. Rigid plates cover a continuous two-weight dermal sleeve. Legs are continuous meshes with blended knees. Tail cuffs cover a continuous flexible core.

The supplied renders show rest side/front/top/three-quarter, all LODs at the same scale, separate S-curve/tail-curl/stride tests and a combined pose. The tests are temporary poses only; the exported GLBs are neutral and contain no animation.

Run with Python 3.11 and bpy 4.5.3: `python3 build_dune_stinger.py --out-dir <dir> [--lod 0|1|2]`. Install dependencies with `pip install bpy==4.5.3 numpy pillow trimesh`. Use `--no-render` to rebuild and audit only. This script resets its Blender scene, so run it in a dedicated process.

## Limits and caveats

No requested budget was intentionally relaxed. Closed shells can intersect as armour articulates; extreme rotations beyond the illustrated poses can cause collisions. This is an asset-level check, not a Quest performance or game-integration test. Glow strength is deliberately 1.0; a brighter night appearance belongs to the game.

LOD 0 automated failures: none.

LOD 1 automated failures: none.

LOD 2 automated failures: none.
