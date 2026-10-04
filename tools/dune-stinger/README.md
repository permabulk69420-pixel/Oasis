# Dune stinger (first creature; v2 is in the game, see the main README)

`brief.md` is the brief written for another model to build the creature in headless Blender. `astra-v1/` is what came back (3 LODs,
build script, its own report). It is **not shipped**: nothing here is under `public/`, and Kane has not approved it for the game.

Checked by me with `python3 tools/creature/check_glb.py tools/dune-stinger/astra-v1/*.glb` (numpy + trimesh; independent of Blender):
4,482 / 1,560 / 582 triangles, 49 bones (identity rest rotations, `_L` at +X, head at +Z), two materials, all weights sum to 1 with at most 2
influences, every shell closed and outward, lowest vertex at y = 0. It loads in three.js and bends when bones are rotated. Weaknesses are
artistic: a generic centipede-scorpion silhouette, identical comb-like legs, a small plain head and almost no glow (two tiny eye bars and a
seam on the stinger), so at night it reads as a dark shape in firelight.
The zip had the earlier build (the chat said a refined 5,888 / 1,780 / 590 version existed but it was not in the package).

## v2 (mine, built on the first build)

`build_stinger.py` is the first build's script with the geometry reworked (stout arching legs with ball knees and spikes, a crested and rust-banded
body, flank spurs, a bigger head with brow ridges, horns, a row of glowing eyes, toothed mandibles with palps, a long lit stinger and a venom bead).
Same 49-bone skeleton and names as v1, so any pose code works on either. `v2/` has the three levels: 11,612 / 4,072 / 626 triangles
(ceilings in `BUDGET`: 50,000 / 12,000 / 3,000; there is a lot of room left in the close-up level, spend it only where it shows). It passes
`tools/creature/check_glb.py` and the script's own audit. Build it with the bpy venv: `python3.11 -m venv v && v/bin/pip install bpy==4.5.3 numpy pillow trimesh`
then `python tools/dune-stinger/build_stinger.py --out-dir out [--lod 0] [--no-render]` (Cycles renders are slow here; `QUICK=1 SAMPLES=8 RES_X=900`
cuts them down). `viewer.html` loads a GLB in three.js with night lighting and test poses (copy it to the repo root, serve with `npm run dev`).
In the game since Kane's go-ahead (4 Oct 2026): `v2/*.glb` are copied to `public/models/creatures/` and `src/dune-stinger.js` loads them. Rebuilding the models means copying the new files there again.
