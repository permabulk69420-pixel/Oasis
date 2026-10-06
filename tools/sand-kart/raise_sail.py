"""The sand sail kart, fixed up in headless Blender (bpy module), from the owner's notes on 6 Oct:
  - the mast lengthened so the sail sits higher (its foot was at the handle bar, right in the rider's face): 45 cm in all
  (the handle's grips are left as modelled: the hand is fitted to their real thickness in the game, src/handle-hold.js)

    python3 tools/sand-kart/raise_sail.py [lift metres, default 0.45]

Reads tools/sand-kart/source/sand_sail_kart.glb (the owner's original, unchanged) and writes public/models/sand-kart/sand_sail_kart.glb.
  - the sail (Cambered_Canvas_Sail) and the rig's canvas (Rig_Canvas) move up by the lift, whole
  - the mast and fittings (Rig_Dark, Rig_Metal) and the rigging lines (Rig_Web): every vertex above the handle bar (SPLIT) moves up, so the mast's shaft
    and the lines stretch; the handle bar and its grips (everything at or below the bar) stay exactly where they were, as do the grip markers
Everything else (chassis, wheels, the markers and their notes) is untouched. Blender turns glTF's +Y up into its +Z up; the file is written back +Y up.
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(HERE, 'source', 'sand_sail_kart.glb')
OUT = os.path.join(ROOT, 'public', 'models', 'sand-kart', 'sand_sail_kart.glb')
LIFT = float(sys.argv[1]) if len(sys.argv) > 1 else 0.45
SPLIT = 1.33            # metres above the kart's ground: the top of the handle bar's fittings (the grips are 1.17 to 1.24, its trim 1.29 to 1.31)
WHOLE = ('Cambered_Canvas_Sail', 'Rig_Canvas')
STRETCH = ('Rig_Dark', 'Rig_Metal', 'Rig_Web')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
moved = {}
for ob in bpy.context.scene.objects:
    if ob.type != 'MESH':
        continue
    whole = ob.name.startswith(WHOLE)
    stretch = ob.name.startswith(STRETCH)
    if not (whole or stretch):
        continue
    mw = ob.matrix_world
    inv = mw.inverted()
    n = 0
    for v in ob.data.vertices:
        w = mw @ v.co
        if whole or w.z > SPLIT:
            w.z += LIFT
            v.co = inv @ w
            n += 1
    ob.data.update()
    moved[ob.name] = n
for name, n in sorted(moved.items()):
    print(f'{name}: {n} vertices up {LIFT} m')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_animations=False, export_skins=False,
                          export_morph=False, export_extras=True, export_normals=True, export_texcoords=True, export_materials='EXPORT', export_image_format='NONE')
print('wrote', os.path.relpath(OUT, ROOT), os.path.getsize(OUT) // 1024, 'KB')
