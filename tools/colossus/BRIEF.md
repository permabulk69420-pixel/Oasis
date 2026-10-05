# Brief: Colossus 01 (a 55 m tall, slow, ancient creature for a VR game)

You are building a 3D model in Blender (Python is fine, headless is fine) and exporting it as glTF binary (.glb). Read all of this first: you know nothing about the game, so the context matters as much as the spec.

## 1. What this is for

A first-person VR game for Meta Quest 3 (a standalone headset, so a mobile GPU), running in a web browser with three.js. The setting is a **desert moon**: red-orange dunes, a huge ringed planet in the sky, a sun that never climbs high (it is always a long, low, golden-hour light), long dark nights, and a few glowing alien plants. Everything that glows is **bioluminescent cyan** (and some violet). The mood is quiet, ancient, a bit mournful and awe-struck. Think *Shadow of the Colossus*, not a monster game.

The player is a human, about 1.7 m tall, on foot, in first person. They can walk right up to this creature, walk underneath it, and **climb it with their hands** (grabbing onto it and pulling themselves up, in VR, one hand at a time). That is why the surface and the grip points matter so much. It is the most important model in the game: there will be five or six colossi eventually, and this is the first one. Get the feeling of enormous scale right.

The creature is **not aggressive**. It wanders the desert slowly and ignores the player unless attacked. It should read as huge, old and calm, not as a threat. There is no story; nothing needs explaining.

## 2. What it is

A colossal **four-legged walker**, a living relative of the giant skeletons that already lie in the game's dunes (those bones have a long, low, wedge-shaped skull, an open lower jaw and tall arched ribs). So the living animal should clearly share that skull shape and that ribcage. Heavy pillar legs like a sauropod or an elephant (not a lizard, not a spider). It is **not** a dragon: no wings, no horns everywhere, no fangs, no humanoid features, nothing cartoonish, no fur, no hair.

- **Head**: long, low, wedge-shaped skull with a heavy brow ridge, a separate hinged lower jaw, a row of broad blunt teeth along the jaw (grinders, not fangs), small deep eye sockets set low on the sides, each with a cyan glow inside. A crest of overlapping bone plates over the back of the skull.
- **Neck**: long, thick, flexible; it can lower the head to the ground and raise it. Six segments.
- **Body**: a deep barrel torso. The **ribs show as arched ivory plates** running down the flanks, like the ancestors' ribcage. A ridge of larger plates runs down the spine.
- **Tail**: long, tapering, eight segments, with plates along the top.
- **Legs**: four, each in three parts (upper, lower, foot) with a wide padded foot of three or four broad toes. Heavy, columnar, slightly bent. Knees/elbows and hocks wear big armour plates.
- **Surface**: dark, wrinkled, leathery hide (deep slate-teal) in deep folds between **overlapping pale bone-armour plates** (ivory, weathered and chipped, darker in the cracks). The plates cover the spine, shoulders, flanks (the ribs), the top of the head, and the joints. Hide shows between them.

## 3. Size (1 unit = 1 metre; this matters, the game uses real scale)

Rest pose, standing, on level ground:
- Height at the top of the shoulder plates: **55 m**. Top of the hip plates: **48 m**.
- Underside of the belly: **26 m** above the ground (a person can walk beneath it between the legs).
- Chest to rump: about **55 m**. Neck: about **28 m**, hanging forward and slightly down so the head sits around 30 m up. Head: about **26 m** long. Tail: about **32 m**. Nose to tail tip is roughly **110 to 130 m**.
- Legs: pillars about 9 to 10 m wide at the top, 6 to 7 m at the ankle. Feet about 10 m wide and 12 m long, about 3 m thick (the player will stand next to a foot and look up).
- Stance: left and right feet about 18 m apart (centre to centre); front and rear feet about 38 m apart.

## 4. Climbing: the grip points (very important)

The player grabs with their hands, so give them real, chunky, readable **hand-holds**. They are **glowing cyan crystals** growing out of the plates and hide (with a few violet ones), and **the plate edges and ridges** are the backup holds.

- Crystal holds: **0.3 to 0.5 m long, at least 0.12 m thick at the base** (a hand is about 0.1 m wide; thin spikes are impossible to grab and shimmer in VR). Chunky, faceted, pointing up and outward, with a lip or a leaning angle a hand can curl round.
- Spacing: roughly **0.6 to 1 m apart** (arm's reach), arranged in **clusters and runs that form obvious routes**, not an even scatter. Aim for **at least 300 in total**.
- **The first holds must be reachable from the ground**: clusters on the feet and ankles at about **1.2 to 2.2 m above the soles**. Then routes continue up the front and back of each leg, along the belly sides, up the flanks over the rib plates, up the spine ridge, along the neck and over the head crest. Fewer on the head and neck, denser on the legs.
- Plate edges: where plates overlap, make the upper edge stand at least **0.25 m proud** with a lip you could hook your fingers behind.
- Do **not** add weak points, targets, eyes-that-glow-as-targets or any other gameplay marker. How the creature is beaten is not decided.
- The crystals must be **real closed geometry**, not flat cards.

## 5. Glow

Glow is a small share of the surface (aim for 2 to 4 percent), because the world is dark and the glow has to carry the night. Cyan is the main colour, violet the accent.
- The crystal holds (above).
- Thin glowing seams: down the spine centre line, along the jaw line, round the joints and between some plates, plus the eye sockets.
Use **separate materials** for the crystals and the seams (see 7) so the game can set their brightness separately. Glow detail should be real geometry or colour regions, not a texture trick.

## 6. Technical spec

**Format**: three glTF binary files, `colossus_01_lod0.glb`, `colossus_01_lod1.glb`, `colossus_01_lod2.glb`, **all with the identical skeleton, bone names and rest pose**, just less detail.

**Triangle budgets** (triangulated, the whole model, all parts):
| File | Triangles | Used |
|---|---|---|
| lod0 | **up to 500,000** (aim for 350k to 500k) | close up, and while climbing |
| lod1 | about 150,000 | medium distance |
| lod2 | about 30,000 | far away |
Put the triangles where they are seen up close: feet and lower legs (within arm's reach of the ground), the front of the legs, plate edges, crystals, the head and teeth, and the joints. Do not waste them on hidden surfaces (the top of the back and the far side of the body can be cheaper). **Keep the silhouette identical across levels.**

**Orientation and origin** (in the exported glTF): **+Y is up, the creature faces +Z, the creature's left side is +X** (its right is -X). In Blender (Z up) that means it faces -Y and you export with the default "+Y Up". The model must be **symmetrical across the X = 0 plane**. **The origin is on the ground, directly under the middle of the body between the four feet, and all four soles lie flat on y = 0.** Apply all transforms (scale 1, rotation 0, no parent offsets).

**Parts**: separate mesh objects, so the game can skip whatever is behind the player: `Colossus_Head`, `Colossus_Jaw`, `Colossus_Neck`, `Colossus_Torso`, `Colossus_Tail`, `Colossus_Leg_FL`, `Colossus_Leg_FR`, `Colossus_Leg_BL`, `Colossus_Leg_BR` (FL = front left, and so on; the feet belong to the legs). All skinned to the **one** armature. No more than **40 primitives** (mesh part times material) per file. Use these names with the suffix `_LOD0`, `_LOD1` or `_LOD2` inside the matching file.

**Skeleton** (one armature, at most 100 bones, at most 4 bone influences per vertex, and **the bone positions must be the true anatomical pivots**, because the game drives the walk from code): 
`root` > `pelvis` > `spine_01`, `spine_02`, `spine_03`, `spine_04` (chest) > `neck_01` to `neck_06` > `head` > `jaw`. `tail_01` to `tail_08` from the pelvis. Each leg: `leg_FL_upper` (at the shoulder or hip joint), `leg_FL_lower` (at the elbow or knee), `leg_FL_foot` (at the ankle), `leg_FL_toe` (at the toe joint); the same for `FR`, `BL` and `BR`. The front legs hang from the chest (`spine_04`), the back legs from `pelvis`. **Do not make animations, shape keys, constraints or IK in the file.** The game will pose and walk it procedurally, so what it needs is a clean rest pose and clean skinning.

**Skinning**: the bone-plates and crystals must each be weighted **100% to a single bone** (rigid, so a hand holding one does not slide as the creature moves). The hide blends between bones only in a short band at the joints. **Put 3 or 4 edge loops across every joint** (shoulders, elbows, knees, ankles, each neck and tail segment, the jaw hinge) so it bends cleanly instead of pinching. Test it: rotate the legs, neck and tail about 25 degrees each and check nothing tears, collapses or stretches.

**Materials**: exactly these names (the game finds them by name), all opaque, Principled BSDF with a plain Base Color (no procedural node trees that will not export, no alpha, no transparency, no double-sided):
- `Colossus hide`: dark slate-teal, sRGB about #26343b to #33434a.
- `Colossus plate`: warm ivory bone, about #cfc3a8, weathered and chipped, darker (about #8d826b) in the cracks.
- `Colossus crystal`: cyan about #25d0ff (some violet about #9b5cff through a vertex colour), emissive.
- `Colossus glow`: the thin seams and the eyes, cyan, emissive.
Do not make the hide darker than #1f2a30: the game's lighting is dim and it would read as black. Also bake variation into a **vertex colour attribute** (called `Col`): lighter on top surfaces, darker in the folds, plates weathered at their edges.

**UVs (required)**: a proper UV0 on every mesh, **unwrapped, with no overlapping islands** (mirrored halves must not share UV space), a **consistent texel density** across islands, and at least a 4 pixel margin at 1024. The game owner will later paint real PBR textures (1k) over this, so the UVs must be clean. For now the model is coloured by material and vertex colour only; do not bake textures.

**Mesh quality (checked by me afterwards)**: all hide, plate and crystal surfaces **closed, manifold, outward-facing**: no loose vertices, no open edges (except the thin hide skin where it meets a plate), no zero-area faces, no inside-out faces, no two coplanar surfaces fighting. Smooth shading with sharp edges where plates meet (no tearing from shared normals). Nothing thinner than about 5 cm and no detail smaller than about 3 cm (it will not be seen and it shimmers in VR). Apply all modifiers (no live subdivision) before export. Export triangulated.

## 7. Process (please work in two stages)

1. **Stage 1, block-out**: rough shapes with the correct proportions, the full skeleton, a first skinning pass, and 4 or 5 preview renders (front, side, top, and a human-scale figure 1.7 m tall standing next to the front foot, so I can judge the scale). Show me before going on.
2. **Stage 2, detail**: plates, hide folds, crystals and holds, the head, the teeth; then the three levels of detail; then exports.

## 8. What to hand back

- The three `.glb` files, the `.blend` file, and your Python build script if you wrote one.
- Preview renders: front, side, three-quarter, top, a close-up of the head, a close-up of a foot with a 1.7 m person for scale, the back with the crystal routes, and the rest pose from underneath.
- A short report: triangle count for each level and each mesh part, the bone list, the bounding box (height, length, width), the number of crystal holds, and the results of your own mesh and skinning checks.
