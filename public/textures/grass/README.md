# Oasis grass texture

The grass band around the water uses the turf set in this folder (`oasis-turf_*`), configured in
`src/grass-texture.js`. `GRASS_TILE_METRES` there controls its repeat size in metres.

The set is procedural and seamless. Regenerate or retune it with:

    python3 tools/grass/make_turf.py            # needs numpy + Pillow
    python3 tools/grass/make_turf.py --seed 7   # different pattern

The palette lives at the top of `build()` in that script (deep / mid / tip, straw, soil).
The previous arrow-blade `stylized-grass1_*` set is in git history if you ever want it back
(`git log -- public/textures/grass`).

To use any other seamless set instead, drop it in here and update the filenames in
`src/grass-texture.js`. 1024 pixels is plenty on Quest 3.
