# Dune stinger (first creature; v3 is in the game, see the main README)

`brief.md` is the brief written for another model to build the creature in headless Blender. `astra-v1/` is what came back (3 LODs,
build script, its own report). It is **not shipped**: nothing here is under `public/`, and Kane has not approved it for the game.

Checked by me with `python3 tools/creature/check_glb.py tools/dune-stinger/astra-v1/*.glb` (numpy + trimesh; independent of Blender):
4,482 / 1,560 / 582 triangles, 49 bones (identity rest rotations, `_L` at +X, head at +Z), two materials, all weights sum to 1 with at most 2
influences, every shell closed and outward, lowest vertex at y = 0. It loads in three.js and bends when bones are rotated. Weaknesses are
artistic: a generic centipede-scorpion silhouette, identical comb-like legs, a small plain head and almost no glow (two tiny eye bars and a
seam on the stinger), so at night it reads as a dark shape in firelight.
The zip had the earlier build (the chat said a refined 5,888 / 1,780 / 590 version existed but it was not in the package).

## v3 (mine, built from scratch in Blender; this is the one in the game)

Kane's verdict on v2 was "the centipede thing, we need to make it way more complex": 16 legs and no pincers read as a centipede. v3 is a different
animal: a **plated carapace** with a ridge and a mound of eyes (two big, a ring of small), **four pairs of three-part legs** (thigh, shin, claw foot,
knobbly knees, spikes), **two jointed pincers** (the left one a size bigger) that raise, spread and snap, toothed **mandibles**, six abdomen plates
with a keel and rear spines, and a **five segment tail** (about 2 m long) ending in a lancet sting. Glow is a second material (cyan, the spear's
cyan): eyes, flank dashes, the seams between tail segments, the venom seam and bead.

- `v3/build_stinger_v3.py` builds it in headless Blender (`bpy`) with the shared kit `tools/creature/kit.py` (rings, sweeps, spikes, balls, skeleton, GLB
  export and the audit). `python3.11 -m venv v && v/bin/pip install bpy==4.5.3 numpy pillow trimesh`, then
  `v/bin/python tools/dune-stinger/v3/build_stinger_v3.py --out-dir out [--lod 0|1|2] [--no-render] [--views tq,side,...]`
  (8 s without renders). The audit runs inside the script and fails the build; the measured numbers are in `v3/report.md`.
- 33,088 / 10,988 / 1,992 triangles (ceilings 50,000 / 12,000 / 3,000; 1.4 MB / 0.5 MB / 0.15 MB), 55 bones with identity rest rotations (+Z forward, +Y up, left = +X,
  feet on y = 0), 2 materials so 2 draw calls per level. The three levels share names, hierarchy and joint positions.
- The legs have **no animation in the file**: `src/stinger-pose.js` solves each leg (a two-bone solver on the loaded skeleton) so a foot stays planted
  on the sand while the body walks over it. The pincers, jaws, tail and abdomen are plain bone rotations.
- To copy a rebuilt model into the game: `cp out/dune_stinger_lod*.glb tools/dune-stinger/v3/ && cp out/dune_stinger_lod*.glb public/models/creatures/`.
  Bone names live in `STINGER_BONES` in `src/stinger-pose.js`; the pose tests (`tests/stinger-pose.test.js`) read the real GLBs, so they fail if a bone moves.
- **Pose lab** (never shipped): with `npm run dev` open `/tools/stinger-lab/stinger-lab.html?poses=rest,alert,windup,strike&cam=side` (`cam=tq|side|front|back|top|close`,
  `night=1`, `lod=`, `p.<key>=<number>` for any pose number, `joints=<JSON>` to try `JOINTS` numbers, `gc=r,g,b&gb=day,night` to try a glow colour).
  `python3 tools/stinger-lab/lab_shot.py "<query>" out.png` takes a screenshot. `node tools/stinger-lab/tail_explore.mjs strike|dead|print` searches for tail angles
  over the real skeleton (it found the strike: the sting lands 0.94 m ahead of the middle, on the ground, with the tail arching clear of the body).

## v2 (mine, built on the first build; replaced by v3)

`build_stinger.py` is the first build's script with the geometry reworked (stout arching legs with ball knees and spikes, a crested and rust-banded
body, flank spurs, a bigger head with brow ridges, horns, a row of glowing eyes, toothed mandibles with palps, a long lit stinger and a venom bead).
Same 49-bone skeleton and names as v1, so any pose code works on either. `v2/` has the three levels: 11,612 / 4,072 / 626 triangles
(ceilings in `BUDGET`: 50,000 / 12,000 / 3,000; there is a lot of room left in the close-up level, spend it only where it shows). It passes
`tools/creature/check_glb.py` and the script's own audit. Build it with the bpy venv: `python3.11 -m venv v && v/bin/pip install bpy==4.5.3 numpy pillow trimesh`
then `python tools/dune-stinger/build_stinger.py --out-dir out [--lod 0] [--no-render]` (Cycles renders are slow here; `QUICK=1 SAMPLES=8 RES_X=900`
cuts them down). `viewer.html` loads a GLB in three.js with night lighting and test poses (copy it to the repo root, serve with `npm run dev`).
In the game since Kane's go-ahead (4 Oct 2026): `v2/*.glb` are copied to `public/models/creatures/` and `src/dune-stinger.js` loads them. Rebuilding the models means copying the new files there again.

The combat build (same day) lengthened the tail: `TAIL_SCALE = 2.4` (and `TAIL_GIRTH = 1.45`) in `build_stinger.py` stretch the four tail pieces
from `TAIL_BASE` and carry the lancet, glow and bead points with them (`tp()`), because with the original tail the sting could never reach past
the head in a strike. Same skeleton, same triangle counts. The tail's poses (rest arch, straight windup, whip, flinch, death curl) are in
`src/stinger-pose.js`; `tests/stinger-pose.test.js` checks the sting reaches ahead of the head in the strike.
