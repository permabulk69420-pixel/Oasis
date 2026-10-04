"""Downloads the sandstone set the desert outcrops use (Poly Haven, CC0) and shrinks it to the two small files the game loads.

    python3 tools/textures/make_sandstone.py [outdir]

Source: "Cliff Side" by James Ray Cock, Jenelle van Heerden and Dario Barresi, Poly Haven (https://polyhaven.com/a/cliff_side), CC0
(no credit needed; given anyway). It is red and ochre sandstone with horizontal beds, which is why it fits an outcrop: the strata run
level round every rock. Both files are the 1k (1024 x 1024) versions, which tile seamlessly, as JPEG: the colour at quality 80 and the
normal map (OpenGL, +Y up, as three.js wants) at quality 88, because a normal map shows blocky artefacts sooner. The photo has
almost no roughness variation (0.86 +- 0.02) and a very faint ambient occlusion, so neither map is used: the game sets a plain
roughness.
"""
import io
import os
import sys
import urllib.request

from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/textures/sandstone"
BASE = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/cliff_side/cliff_side_{}_1k.jpg"
FILES = [("diff", "sandstone_albedo.jpg", 80), ("nor_gl", "sandstone_normal.jpg", 88)]

os.makedirs(OUT, exist_ok=True)
for kind, name, quality in FILES:
    data = urllib.request.urlopen(BASE.format(kind), timeout=90).read()
    image = Image.open(io.BytesIO(data)).convert("RGB")
    assert image.size == (1024, 1024), image.size
    path = os.path.join(OUT, name)
    image.save(path, quality=quality, optimize=True)
    print(name, os.path.getsize(path), "bytes")
with open(os.path.join(OUT, "CREDITS.md"), "w") as fh:
    fh.write("""# Sandstone textures

`sandstone_albedo.jpg` and `sandstone_normal.jpg` are the 1k colour and normal (OpenGL) maps of **Cliff Side** by James Ray Cock,
Jenelle van Heerden and Dario Barresi, from [Poly Haven](https://polyhaven.com/a/cliff_side), released under CC0 (public domain),
re-saved as JPEG. Regenerate with `tools/textures/make_sandstone.py`.
""")
