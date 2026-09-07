# Oasis grass texture

The grass band is painted into the terrain around the sandy water bank.
It currently uses a muted green colour fallback, with no texture download.

To add your seamless grass base-colour image:

1. Put it in this folder (for example `grass_albedo.png`). PNG, JPG and WebP work.
2. In `src/grass-texture.js`, set `GRASS_TEXTURE` to that filename instead of `null`.
3. Build/publish normally. `GRASS_TILE_METRES` controls its repeat size in metres.

The image replaces the fallback colour, repeats across the ground, and blends
into sand at both edges. It shares terrain lighting and does not affect sand maps.
A 1024 or 2048 pixel image is a practical starting size for Quest 3.
