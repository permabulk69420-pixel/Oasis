"""Turns two real photo-scanned CC0 ground sets into the grass ground the terrain wears (public/textures/grass/). Replaces the old generated "turf"
(a procedural texture that read as carpet).

    python3 tools/textures/make_ground.py <Grass004 dir> <leafy_grass dir> [outdir]

Sources (CC0, no credit needed; given anyway in public/textures/grass/CREDITS.md):
  grass   "Grass004" from ambientCG (https://ambientcg.com/view?id=Grass004), the 1K-JPG zip: Grass004_1K-JPG_{Color,NormalGL,Roughness}.jpg
  litter  "Leafy Grass" from Poly Haven (https://polyhaven.com/a/leafy_grass), the 1k JPGs renamed leafy_grass_{diff,nor_gl}.jpg
          (https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/leafy_grass/leafy_grass_{diff,nor_gl}_1k.jpg)

The terrain shader (src/materials.js) lays the grass everywhere grass grows, sampled at two scales and angles so its repeat never shows, and lays the
litter in big soft patches over it (leaf fall and trampled ground). Both photos are toned to the old turf's brightness and a shared dark green-olive
(the world is a dark twilight: do not brighten the night), keeping their own detail. Outputs, all 1024 x 1024 JPEG (quality 86, about 1 MB in all):
  ground-grass_albedo.jpg, ground-grass_normal.jpg, ground-grass_roughness.jpg, ground-litter_albedo.jpg, ground-litter_normal.jpg
"""
import os
import sys

import numpy as np
from PIL import Image

grass_dir, litter_dir = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else 'public/textures/grass'
os.makedirs(out, exist_ok=True)

LUMA = np.array([0.299, 0.587, 0.114])
# target mean colour (sRGB 0..1) of each: the old turf's brightness (luma about 0.25), the grass a little greener, the litter olive-brown and darker
TARGET = {'grass': np.array([0.215, 0.29, 0.115]), 'litter': np.array([0.25, 0.235, 0.14])}


def load(path, mode='RGB'):
    return np.asarray(Image.open(path).convert(mode), float) / 255.0


def tone(rgb, target, contrast=1.0):
    """Keep the photo's detail (its deviation from its own mean, per channel) and move its mean to `target`."""
    mean = rgb.reshape(-1, 3).mean(0)
    lum = rgb @ LUMA
    detail = (lum - lum.mean())[..., None] * contrast                 # brightness detail, shared by all channels
    hue = rgb / np.maximum(lum[..., None], 1e-3)                        # the photo's own colour variation (a yellow blade, a red leaf)
    hue = hue / (mean / max(mean @ LUMA, 1e-3))                          # relative to its average colour
    base = target * hue
    res = base * (1.0 + detail / max(lum.mean(), 1e-3))
    return np.clip(res, 0.0, 1.0)


def save(arr, name, mode='RGB'):
    img = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), mode)
    img.save(os.path.join(out, name), quality=86)
    print(name, os.path.getsize(os.path.join(out, name)) // 1024, 'KB', 'mean', np.round(arr.reshape(-1, arr.shape[-1] if arr.ndim == 3 else 1).mean(0), 3))


g = load(os.path.join(grass_dir, 'Grass004_1K-JPG_Color.jpg'))
save(tone(g, TARGET['grass'], 1.1), 'ground-grass_albedo.jpg')
save(load(os.path.join(grass_dir, 'Grass004_1K-JPG_NormalGL.jpg')), 'ground-grass_normal.jpg')
save(load(os.path.join(grass_dir, 'Grass004_1K-JPG_Roughness.jpg'), 'L'), 'ground-grass_roughness.jpg', 'L')
lit = load(os.path.join(litter_dir, 'leafy_grass_diff.jpg'))
lit = np.asarray(Image.fromarray((lit * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS), float) / 255.0
save(tone(lit, TARGET['litter'], 1.0), 'ground-litter_albedo.jpg')
ln = Image.open(os.path.join(litter_dir, 'leafy_grass_nor_gl.jpg')).convert('RGB').resize((1024, 1024), Image.LANCZOS)
save(np.asarray(ln, float) / 255.0, 'ground-litter_normal.jpg')
