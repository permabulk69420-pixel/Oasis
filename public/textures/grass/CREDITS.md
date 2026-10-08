# Grass material credits

Three 2K materials, stored in six active lossless WebP files:

- `grass-short_*`: Grass 01 by Mykhailo Ohorodnichuk / Game Piggs, https://game-piggs.com/textures/grass-01/, CC0.
- `grass-loose_*`: Grass 02 from the same material group, https://game-piggs.com/textures/grass-02/, CC0.
- `ground-litter_*`: Leafy Grass by Charlotte Baglioni / Poly Haven, https://polyhaven.com/a/leafy_grass, CC0.

Game Piggs license: https://game-piggs.com/license/.

Every file is 2048 × 2048. `*_albedo.webp`: original merged albedo in RGB (sRGB), matching AO in alpha (linear). `*_surface.webp`: matching OpenGL normal XY in RG, roughness in B, height/displacement in A (all linear). The shader reconstructs positive normal Z. Grass normals retain the DirectX-to-OpenGL green inversion from the merged maps. The leaf-litter height is the source's native 2K displacement map. These are non-metallic materials.

Packing preserves the merged albedo colours and each layer's matching maps. All six files are loaded. The grass uses GGX direct lighting, the scene's filtered PMREM sky, and the same material response for the headset torch, handheld torch and campfire. Camera distance does not select the layer.
