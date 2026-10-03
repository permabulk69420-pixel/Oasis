# Veil tree generator

Procedural source for `public/models/vegetation/veil-tree/veil_tree.glb` (headless Blender, `pip install bpy`).
Everything is seeded, so reruns give the same tree.

```
python3 tools/veil-tree/build_tree.py --out /tmp/veil_tree.glb     # build (a few seconds)
python3 tools/veil-tree/cap_ends.py /tmp/veil_tree.glb public/models/vegetation/veil-tree/veil_tree.glb
```

`cap_ends.py` closes the open ends of the bark tubes (trunk, limbs, strands) so they don't show as holes.
`make_atlas.py` regenerates `veil_atlas.png`; `render_preview.py` renders previews of an exported file.
Root starts are buried inside the trunk (see `EXT` in the root loop) so they blend into the buttress.
