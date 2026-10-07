import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
import bmesh
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_helpers import build
build("floor")
