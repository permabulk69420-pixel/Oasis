# Grass ground

The ground under the grass (the oasis's grass band and the floating island) is two real photo scans, both CC0, toned to the world's dark
palette by `tools/textures/make_ground.py` (its header says where to download the sources):

- `ground-grass_*` (albedo, normal, roughness): the grass, laid everywhere grass grows. The shader samples it at two scales and angles and
  blends them with soft noise, so its repeat (`GRASS_TILE_METRES` in `src/grass-texture.js`) does not show.
- `ground-litter_*` (albedo, normal): leaf litter and trampled ground, laid in big soft patches over the grass.

All 1024 px JPEG (about 2 MB together). The old generated "turf" set is in git history.
