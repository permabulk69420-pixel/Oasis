# Oasis modular building kit

27 GLBs: nine main pieces, nine LOD1s and nine separate collider files. Created with custom procedural geometry in headless Blender 4.5.3 LTS. No stock models, templates, GUI, baked maps or embedded images.

| Piece | LOD0 triangles | LOD1 triangles | LOD1 proportion | Collider triangles |
|---|---:|---:|---:|---:|
| foundation | 1,264 | 336 | 26.6% | 12 |
| floor | 568 | 156 | 27.5% | 12 |
| wall | 540 | 144 | 26.7% | 12 |
| wall_door | 916 | 264 | 28.8% | 36 |
| door | 346 | 102 | 29.5% | 12 |
| wall_window | 1,038 | 294 | 28.3% | 48 |
| stairs | 888 | 264 | 29.7% | 100 |
| roof | 912 | 252 | 27.6% | 12 |
| pillar | 404 | 120 | 29.7% | 12 |

All LOD0 meshes are below 1,500 triangles. LOD1s retain the original bounds, origins and snap nodes. Each visual file contains one mesh with named material slots; different materials remain separate glTF draw primitives.

Dimensions and origins follow the brief: 3 m grid; foundation 3 × 3 × 1 m with its top at the origin; floor 3 × 3 × 0.2 m with its top at the origin; walls 3 m wide × 3 m high × 0.2 m thick; door 1.2 × 2.2 m with a chosen 0.1 m thickness and the lower hinge at the origin; pillar 0.3 × 0.3 × 3 m. Doorway clear opening is 1.2 × 2.2 m. Window opening is 1 × 1 m, from height 1 to 2 m, with decorative bone bars.

Stairs occupy a 3 × 3 m cell, with twelve 0.25 m rises and 0.25 m runs. Their collider is a single closed stepped prism rather than a ramp, matching every tread height. Roof plan is exactly 3 × 3 m, rising 1.732051 m at 30° northward, with a chosen 0.16 m vertical thickness. Roof origin and snap_low lie on the low top edge; the underside is 0.16 m below it.

All colliders use the same local origin as their visual piece and the exact `<piece>_collider` mesh name. Door/window collision openings remain clear; decorative window bars are deliberately excluded from collision. The door collider moves with the door hinge.

Material names: Oasis_Wood_Dark, Oasis_Wood_Light, Oasis_Stone, Oasis_Cord, Oasis_Fibre, Oasis_Bone and Oasis_Crystal_Glow. Only the door and window wall use the cyan glow material. Colours and roughness are flat previews, as requested; the game supplies shared tiling textures by material name. Weathering here comes from geometry, bevels and the irregular stone footing, not texture maps.

UVMap uses an orthonormal metre basis per face: 1 UV unit = 1 metre, with timber grain along V on longitudinal faces. UV coordinates intentionally extend outside 0–1. UV_AO is separately packed into 0–1. glTF stores UV sets by index, so UV_AO exports as TEXCOORD_1; both source names are retained in mesh extras (`uv_names`). Importers may assign their own names. The verification script restores the source names after import for inspection.

Snap names and locations follow the brief. In the delivered GLBs each snap node's local +Y points outward. To account for Blender's coordinate conversion, source EMPTY local +Z is aligned with that normal before Y-up export. World directions are glTF +Y up, north −Z and east +X. Door has no snap node requirement; its origin is the hinge.

Re-import verification passed on every GLB: bounds within 1 mm, triangle budgets, applied transforms, exact node/material names, both UV channels, metric UV edge lengths, no embedded images, snap positions and directions, open collision apertures and all twelve stair heights. AO packing passed a 512-pixel positive-area overlap check. Measured foundation edge-to-edge, wall-to-foundation, stair-to-floor and mirrored roof ridge gaps are zero. Full results are in verification.json.

The ten Cycles renders show all nine individual pieces and an assembled 2 × 2 foundation hut with a door, window walls, upper floor, stair bay, pillars and paired roof slopes. Corner pillars sleeve the intersections of centred wall edges. Small inset wall-top bevels prevent exposed coplanar faces where upper floor modules meet them. The assembly intentionally leaves the stair bay and upper terrace open.

Rebuild everything, then verify and render:

```sh
blender -b -t 8 --python-exit-code 1 -P build_all.py
blender -b -t 8 --python-exit-code 1 -P check_and_render.py -- --render
```

For one piece use its build_<piece>.py script; it writes the main, LOD1 and collider GLBs together. Keep build_helpers.py alongside the scripts. Compatible bpy installations can run the scripts directly with Python. Runtime snapping, material sharing, collider registration and LOD selection remain game-side; no Quest hardware performance measurement was made.
