# Oasis sand PBR drop folder

Drop the Park Sand 1K texture files directly in this folder using these exact filenames:

- `park_sand_diff_1k.jpg` — base colour / diffuse (used)
- `park_sand_nor_gl_1k.exr` — OpenGL normal map (used)
- `park_sand_rough_1k.exr` — roughness map (used)
- `park_sand_disp_1k.png` — displacement / height (stored for experiments; not currently used on Quest)

The Blender file itself is not required by the web build.

If the three runtime maps are absent, Oasis automatically keeps using its existing procedural sand shader, so deploying the repo before copying the textures does not break the scene.
