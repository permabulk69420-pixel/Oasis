# Building kit

Made for Oasis by a separate model (OpenAI Codex) from the owner's brief, 7 Oct, in headless Blender 4.5: one `build_<piece>.py` per piece
(each writes its main, `_lod1` and `_collider` GLBs; they share `build_helpers.py`), `build_all.py` for all nine, checked and rendered by
`check_and_render.py`. Their report is `report.md`, the measurements `verification.json`, the renders `preview_overview.png` and
`preview_assembly.jpg` (a 2 × 2 hut). The scripts write next to themselves; the game's copies are in `public/models/building/`.
Not used in the game yet.

```sh
blender -b --python-exit-code 1 -P tools/building/build_all.py
blender -b --python-exit-code 1 -P tools/building/check_and_render.py -- --render
cp tools/building/*.glb public/models/building/ && rm tools/building/*.glb
```

The grid is 3 m. +Y up, north −Z, east +X. Every snap empty's local +Y points outward.

| Piece | LOD0 / LOD1 / collider tris | Size (m) | Origin | Snaps |
|---|---|---|---|---|
| foundation | 1,264 / 336 / 12 | 3 × 1 × 3 | top centre | snap_n/s/e/w (edges), snap_top |
| floor | 568 / 156 / 12 | 3 × 0.2 × 3 | top centre | snap_n/s/e/w, snap_top |
| wall | 540 / 144 / 12 | 3 × 3 × 0.2 | bottom centre | snap_bottom, snap_top, snap_left/right (mid-height) |
| wall_door | 916 / 264 / 36 | 3 × 3 × 0.2 | bottom centre | as wall; 1.2 × 2.2 m opening, centred |
| door | 346 / 102 / 12 | 1.2 × 2.2 × 0.1 | lower hinge | none (hinge at x −0.6 of the wall_door) |
| wall_window | 1,038 / 294 / 48 | 3 × 3 × 0.2 | bottom centre | as wall; 1 × 1 m opening, 1–2 m up; bars not in the collider |
| stairs | 888 / 264 / 100 | 3 × 3 × 3 | bottom front edge | snap_bottom (0,0,0), snap_top (0,3,−3) |
| roof | 912 / 252 / 12 | 3 × 1.73 × 3, 30° | low top edge | snap_low (0,0,0), snap_high (0,1.732,−3) |
| pillar | 404 / 120 / 12 | 0.3 × 3 × 0.3 | bottom centre | snap_bottom, snap_top |

Materials are slots by name only (flat preview colours, no images): Oasis_Wood_Dark, Oasis_Wood_Light, Oasis_Stone, Oasis_Cord,
Oasis_Fibre, Oasis_Bone, Oasis_Crystal_Glow (door and window only). The game should swap in shared tiling PBR textures by name.
TEXCOORD_0 is metric (1 unit = 1 m, grain along V), TEXCOORD_1 is the packed 0–1 AO set. Each piece is 3–6 draw primitives (one per
material), so the game should batch or instance by material.

Known gaps (fine for now): the stairs are steep (12 × 0.25 m rises, 45°); there's no gable triangle to close the roof ends; wall_door
has no marker for the door hinge (it's at x −0.6, y 0 of the wall).
