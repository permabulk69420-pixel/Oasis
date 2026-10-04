# Dune stinger (first creature, not in the game yet)

`brief.md` is the brief written for another model to build the creature in headless Blender. `astra-v1/` is what came back (3 LODs,
build script, its own report). It is **not shipped**: nothing here is under `public/`, and Kane has not approved it for the game.

Checked by me with `python3 tools/creature/check_glb.py tools/dune-stinger/astra-v1/*.glb` (numpy + trimesh; independent of Blender):
4,482 / 1,560 / 582 triangles, 49 bones (identity rest rotations, `_L` at +X, head at +Z), two materials, all weights sum to 1 with at most 2
influences, every shell closed and outward, lowest vertex at y = 0. It loads in three.js and bends when bones are rotated. Weaknesses are
artistic: a generic centipede-scorpion silhouette, identical comb-like legs, a small plain head and almost no glow (two tiny eye bars and a
seam on the stinger), so at night it reads as a dark shape in firelight.
The zip had the earlier build (the chat said a refined 5,888 / 1,780 / 590 version existed but it was not in the package).
