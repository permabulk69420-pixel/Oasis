"""Turns Poly Haven's "Bark Brown 02" (CC0) into the two files the island's tall jungle trees wear: the colour photo and its normal map, both 1024 x 1024.

    python3 tools/textures/make_jungle_bark.py <dir with bark_brown_02_diff.jpg, bark_brown_02_nor_gl.jpg> [outdir]

Source: "Bark Brown 02" by Rob Tuytel, Poly Haven (https://polyhaven.com/a/bark_brown_02), CC0 (no credit needed; given anyway).
Download the 1k JPGs from
  https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/bark_brown_02/bark_brown_02_diff_1k.jpg
  https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/bark_brown_02/bark_brown_02_nor_gl_1k.jpg
(the script expects them renamed bark_brown_02_diff.jpg and bark_brown_02_nor_gl.jpg).

Unlike the palm bark (src/surface-textures.js throws its colour away so one grey can be tinted teal, brown or grey), this one keeps its colour: the fissured
brown-grey with green moss is the look, and the model's vertex colours only darken it for the twilight and add more moss at the foot. It tiles (the photo is seamless),
and JPEG at quality 84 keeps each file near half a megabyte.
"""
import os
import sys

from PIL import Image

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "public/textures/bark"
os.makedirs(out, exist_ok=True)
for name, dest in (("bark_brown_02_diff.jpg", "jungle_bark_colour.jpg"), ("bark_brown_02_nor_gl.jpg", "jungle_bark_normal.jpg")):
    image = Image.open(os.path.join(src, name)).convert("RGB")
    assert image.size == (1024, 1024), image.size
    image.save(os.path.join(out, dest), quality=84, optimize=True)
    print(dest, os.path.getsize(os.path.join(out, dest)), "bytes")
