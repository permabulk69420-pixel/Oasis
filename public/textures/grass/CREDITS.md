# Credits

- `ground-grass_*`: "Grass004" from ambientCG (https://ambientcg.com/view?id=Grass004), CC0.

The original `ground-grass_*` maps were toned and resized by `tools/textures/make_ground.py`; they are retained but are no longer loaded by the ground material.

## Layered 2K ground materials

- `grass-short_*`: **Grass 01** by Mykhailo Ohorodnichuk / Game Piggs, https://game-piggs.com/textures/grass-01/.
- `grass-loose_*`: **Grass 02**, the second style in the same Substance Sampler material group, https://game-piggs.com/textures/grass-02/.
- Both Game Piggs materials are **CC0**: https://game-piggs.com/license/.
- `ground-litter_*`: **Leafy Grass** by Charlotte Baglioni / Poly Haven, https://polyhaven.com/a/leafy_grass, **CC0**. Updated from the source's native 2K maps; albedo is darkened and desaturated to suit Oasis.

All active layer maps are 2048 × 2048. Albedos retain the source detail and are toned to Oasis's dark green/olive palette. The grass normal maps were converted from DirectX to OpenGL by inverting green; the leaf-litter normal is supplied as OpenGL. `*_arm.jpg` uses red = ambient occlusion, green = roughness, blue = metallic (the ground is non-metallic). Grass heights retain the source's absolute range, converted from 16-bit to 8-bit PNG for WebGL image loading. Colour and data maps use separate colour spaces in the loader.

The layers blend by fixed world-space masks and the grass materials' heights in `src/materials.js`. Camera distance does not select the grass layer.
