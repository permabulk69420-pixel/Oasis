# Oasis archery assets

Built from custom geometry and procedural materials entirely in headless Blender 4.5.3 LTS using Python. No stock models, external textures, GUI, image generation or armatures were used.

| Asset | Triangles | Limit | GLB size | Dimensions / construction |
|---|---:|---:|---:|---|
| bow.glb | 5,370 | 8,000 | 2.81 MB | Attachment centres 1.250 m apart; complete mesh 1.252 m tall including edge laminations. Grip at origin. |
| arrow.glb | 320 | 600 | 0.66 MB | Exactly 0.750 m from nock to tip; 8 mm shaft; three solid thin vanes. |
| quiver.glb | 2,696 | 3,000 | 2.77 MB | Hollow 0.550 m container, 0.120 m body diameter; includes strap and five complete arrows. |

Each asset has one mesh, one material and four embedded 1024 × 1024 PNG atlas maps: Base Color, tangent-space Normal, ORM (R occlusion / G roughness / B metallic), and Emission. All maps were baked with Cycles from Blender procedural materials, with smart-projected UVs and padded islands. Organic materials use zero metallic. Emissive cyan accents are opaque crystals. Texture PNGs are also supplied separately. No external files are required to load a GLB.

The bow has tapered 16-segment limbs, bone edge laminations, chitin plates, individual cord wraps, a left-hand arrow shelf and cyan riser inlays. There is no string geometry. The `Draw` morph moves both attachment centres 0.120 m backward and 0.050 m inward, with a smooth bend and stationary handle. No modifiers or topology operations follow creation of the shape keys.

Exact bow markers: `grip`, `arrow_rest`, `string_top`, `string_bottom`, `string_top_drawn`, `string_bottom_drawn`, `nock_rest`. Arrow markers: `tip`, `nock`. Quiver marker: `opening`. All are EMPTY objects parented to their corresponding root, exported as named nodes.

Delivered GLBs use +Y up and −Z forward. There is an axis inconsistency in the original brief: Blender's standard Y-up export maps Blender −Y to glTF +Z. Each build script therefore applies a documented post-export Z reflection to geometry, normals, morph deltas and marker positions, with triangle winding corrected. This preserves the requested left side (−X) and delivers −Z forward without a rotated/scaled root. Mesh transforms are applied.

Set `bow_mesh.morphTargetInfluences[bow_mesh.morphTargetDictionary.Draw]` between 0 and 1. Interpolate each rest string marker toward its matching drawn marker by the same value; EMPTY nodes do not move automatically with mesh morphs. The game supplies the string and its centre pull, approximately 0.650 m behind the grip at full draw. This displacement is recorded in root extras; no string animation is exported. Arrow origin and `nock` are both at zero; `tip` is (0, 0, −0.750) in glTF coordinates.

The quiver origin is at its upper back mounting point. Its five decorative arrows are merged into the quiver mesh to keep one material/draw primitive; they are not separately removable nodes. Use `arrow.glb` for playable arrows.

`check_assets.py` re-imported each final GLB into a fresh scene and passed triangle budgets, dimensions, applied transforms, named markers, embedded PBR texture channels, bow morph export and endpoint movement, stationary grip, and arrow length/origin/direction checks. `verification.json` contains measured bounds, every node name, material/texture names and marker coordinates. The ten 1024 × 768 Cycles PNGs were rendered from the re-imported GLBs and visually inspected: front, side and three-quarter per asset, plus full draw for the bow.

Rebuild with Blender 4.5.3 (each build script is self-contained):

```sh
blender -b -t 8 --python-exit-code 1 -P build_bow.py
blender -b -t 8 --python-exit-code 1 -P build_arrow.py
blender -b -t 8 --python-exit-code 1 -P build_quiver.py
blender -b -t 8 --python-exit-code 1 -P check_assets.py -- --render
```

Alternatively run these scripts with a compatible installed `bpy` Python module. Output files are written beside the scripts. No Quest hardware or browser frame-time test was performed; runtime string, interaction and bloom remain game-side responsibilities.
