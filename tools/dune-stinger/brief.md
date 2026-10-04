# Brief: design and build the "Dune Stinger", a rigged low-poly creature, headless in Blender

You are the Blender expert here, and the design is yours. This brief gives you the limits the game needs and a loose idea of what we want. Inside
those limits make every design and modelling decision yourself: the shapes, proportions, how the plates and legs are formed, how you build and
rig it, how you get the best look out of the triangle budget. We would rather see your best idea than a literal copy of ours. If you think one of
our limits is hurting the result, say so in your report and propose a change; do not silently break it.

You cannot see the game and have no access to its code, so everything the game needs from the file is below. Work headless (no GUI) with the
`bpy` module. If it is missing: `pip install bpy` (add `--break-system-packages` if pip refuses). Always `import bpy` before `import bmesh`.
Please make it one re-runnable Python script, so we can tweak it later.

## The game, in a paragraph

A three.js (WebXR) desert survival game for a Meta Quest 3 headset, a phone-class chip, so triangles and draw calls are scarce. The world is a
glowing alien oasis: sand dunes, banded blue-teal palms, glowing cyan fruit. The player holds a spear and a torch. This creature comes up out of
the sand near the player's campfire at night, circles just outside the firelight and lunges. The player sees it from standing height, usually 1
to 5 metres away, in VR, so it has to look good up close and read as a strong silhouette in the dark. The game animates the bones in code (no
baked animation: do NOT export animation clips), so the rest pose should be a clean, neutral stance.

## The idea (a starting point, not a spec)

A **dune stinger**: part scorpion, part centipede, but alien. A low, long, segmented armoured body that walks on many legs, with a raised tail
ending in a stinger and some kind of mouthparts or pincers at the front. Menacing and slightly beautiful, not a cartoon and not a realistic bug.
It lives in sand, so by day it should blend into the dunes (warm sandy, bronze or rust tones work), with a few small **cyan glowing accents** that
match the rest of the oasis (eyes, the stinger tip, markings, whatever you think looks best). The glow is what you see at night, so it should read,
but keep it to small accents rather than a lit-up creature. Beyond that, surprise us.

**Size** (real-world metres, the player stands next to it): roughly 1.2 to 1.5 m long with the tail raised, low to the ground (the body well under
0.3 m tall, the raised tail up to about 0.6 m), leg span roughly 0.5 to 0.7 m. Leg tips (or the lowest part of the body) at y = 0.

## Hard requirements (what the game code relies on)

**Axes and units.** The exported glTF uses glTF axes: **+Y is up, the creature faces +Z, and its left side is +X.** Units are metres. The origin
is on the ground (y = 0) directly under the middle of the body. (In Blender's own Z-up world the creature then faces -Y, up is +Z, left is +X, and
you export with the usual +Y Up conversion on.) This is the easiest thing to get wrong, so re-open the exported .glb with a different tool and
confirm which end is +Z, that the lowest vertex is at y ~ 0, and which side the "_L" bones are on.

**Three files that share one skeleton**, with these triangle ceilings (counted after export, as triangles):
- `dune_stinger_lod0.glb`: at most 6,000 (close up, within about 8 m).
- `dune_stinger_lod1.glb`: at most 2,000 (8 to 25 m).
- `dune_stinger_lod2.glb`: at most 600 (further than 25 m; it still has to read as the same long, segmented, raised-tail creature).
Same bone names, same joint positions and same hierarchy in all three, so one piece of game code poses whichever is showing. Keep the silhouette
consistent between the levels. How you reduce is up to you (hand-built simpler versions look better than an automatic decimate).

**Materials: exactly two, both single sided (backface culling on), no textures.**
1. `Stinger`: the body. Colour comes from vertex colours: a Vertex Color node (layer named `Col`) into Base Color, which exports as `COLOR_0`. Roughness
   and metallic are your choice (a satin, slightly hard-shelled look is what we imagine).
2. `Glow`: constant cyan emission for the accents. Base colour about (0.02, 0.08, 0.10), Emission colour about (0.25, 0.95, 1.0), **Emission Strength
   exactly 1.0** (the game scales the brightness itself, and a higher value makes the exporter add an extension we do not want). No vertex
   colours on this material.
Every triangle uses one of the two. That is two draw calls per creature, the budget. One mesh object, one armature, nothing else in the file (no
cameras, lights or empties). No Draco or meshopt compression. Keep lod0 under about 300 KB.

**Skeleton: the naming contract.** The game finds bones by name, so please use these patterns; the counts are yours to choose within the ranges.
Every bone has an IDENTITY rest rotation (it points along +Y of the exported world with no roll), so that rotating a bone in the game is a
rotation about the world axes of the standing creature. The joint position is what matters.
```
Root                                 (at the origin, on the ground)
  Head                               (child of Root; any extra head parts such as Mandible_L / Mandible_R are children of Head, your choice)
  Seg01 > Seg02 > ... > SegNN        a chain from front to back, 6 to 10 segments; Seg01 is a child of Root, each next is the child of the one in front
  Tail1 > Tail2 > ... > TailM > Stinger   a chain, 3 to 6 tail bones then Stinger; Tail1 is a child of the last Seg
  Leg bones: for each body segment that has legs and each side S = L or R:   LegNN_S_Upper (child of SegNN) > LegNN_S_Lower
                                     (legs on every segment, or on some, your choice; one or two bones per leg; a leg with a single bone should
                                      be named LegNN_S_Upper)
```
Keep the whole skeleton at 64 bones or fewer. The segment joints should sit at the front edge of each plate so that bending a bone swings the
part behind it. If you want something that does not fit these patterns (extra bones for feelers, a jaw, whatever), add it as a child of Head or a
Seg bone with a clear name and tell us in the report; extra bones are welcome.

**Skinning.** Every vertex weighted, at most 4 bones per vertex, weights sum to 1, only bones that exist. Make it bend cleanly: we will curl the body
in S-curves, curl the tail over its back and swing the legs, and it must not tear, spike or show gaps.

**Mesh quality** (the game has been bitten by all of these before, so please check each yourself): no loose vertices, no open or non-manifold
edges, no zero-area faces, no faces pointing inward (check signed volume per closed shell), no duplicate or coplanar overlapping faces that
would z-fight. Triangle winding counter-clockwise from outside. Closed solid shells for the parts are the cleanest way to meet this. Apply all modifiers and transforms, so the object's
transform is identity.

**Export.** Blender's glTF exporter, GLB, with these ideas: Y up conversion on, no lights, no cameras, no animations, skins on, vertex colours
exported from the material, normals on, no tangents, no UVs, materials exported, no extras, apply modifiers. Argument names change between
Blender versions, so use the equivalents in yours.

## What to send back

1. The three .glb files and the build script (`python3 build_dune_stinger.py --out-dir <dir> [--lod 0|1|2]`).
2. A short report with numbers you measured from the exported files, not from your intentions: triangles per level, bone count, bounding box,
   file sizes, material settings, every mesh-quality check per level, the vertex-weight checks, and the axis check result. Plus a few lines on
   your design choices and anything you were unsure about or that does not meet a limit.
3. Renders (PNG, headless Blender, any clean light): at least a side view, a front view, a three-quarter view and a top view of lod0, and one image
   with all three levels side by side.
4. A pose test as renders: the body segments in a sideways S-curve, the tail curled over the back so the stinger points forward, and the legs on
   one side swung forward with the other side swung back. Look at the pictures yourself and fix any tearing or odd blends before you report.

Take your time, and have fun with it. A creature that meets every limit and has real character is what we are after.
