"""Turns a Poly Haven bark set (CC0) into the two small files the game uses for bark: a neutral grey detail map and a normal map.

    python3 tools/textures/make_bark.py <dir with palm_bark_diff.jpg, palm_bark_nor_gl.jpg> [outdir]

Source: "Palm Bark" by Charlotte Baglioni, Poly Haven (https://polyhaven.com/a/palm_bark), CC0 (no credit needed; given anyway).
Download the 1k JPGs from  https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/palm_bark/palm_bark_{diff,nor_gl}_1k.jpg
(the script expects them renamed palm_bark_diff.jpg and palm_bark_nor_gl.jpg).

The photo's colour is thrown away (the models carry their own colours in the vertices, so the same bark can be teal, brown or grey):
the grey is stretched to the average and contrast src/surface-textures.js expects (BARK.mean, about 0.81), so the bark keeps its
brightness. Both are 1024 x 1024, which tiles seamlessly, and JPEG at quality 86 to keep the download small. The photo has no
useful roughness map (it is nearly flat), so none is used.
"""
import os
import sys

import numpy as np
from PIL import Image

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "public/textures/bark"
MEAN, SPREAD = 0.81, 0.10          # target average grey and its standard deviation (the photo's own is about 0.04)

os.makedirs(out, exist_ok=True)
g = np.asarray(Image.open(os.path.join(src, "palm_bark_diff.jpg")).convert("L"), float) / 255.0
g = (g - g.mean()) / g.std() * SPREAD + MEAN
g = np.clip(g, 0.0, 1.0)
Image.fromarray((g * 255 + 0.5).astype(np.uint8), "L").save(os.path.join(out, "palm_bark_detail.jpg"), quality=86)
Image.open(os.path.join(src, "palm_bark_nor_gl.jpg")).convert("RGB").save(os.path.join(out, "palm_bark_normal.jpg"), quality=86)
print("grey mean %.3f std %.3f" % (g.mean(), g.std()))
for name in ("palm_bark_detail.jpg", "palm_bark_normal.jpg"):
    print(name, os.path.getsize(os.path.join(out, name)), "bytes")
