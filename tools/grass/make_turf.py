#!/usr/bin/env python3
"""Procedural, seamless oasis turf texture set (albedo / normal / roughness / height).

Replaces the old arrow-blade 'stylized-grass1' set, which read as huge cartoon blades at a very
saturated yellow-green. This one is a calm, slightly dry, dark turf: fine blade strokes, soft
clumping, a few straw and soil flecks. The real vertical grass blades are rendered on top of it,
so the ground only has to read as shaded undergrowth.

Everything is built from FFT-filtered noise, so it tiles perfectly with no seams.

    python3 tools/grass/make_turf.py                 # writes into public/textures/grass/
    python3 tools/grass/make_turf.py --size 1024 --seed 7 --out /tmp/turf

Requires numpy and Pillow. Tile size in the game is GRASS_TILE_METRES (src/grass-texture.js).
"""
import argparse
import os

import numpy as np
from PIL import Image

TILE_METRES = 3.2  # keep in sync with GRASS_TILE_METRES in src/grass-texture.js


def freq_grid(n):
    f = np.fft.fftfreq(n)
    fy, fx = np.meshgrid(f, f, indexing="ij")
    return fx, fy


def periodic_noise(rng, n, lo, hi, power=1.0):
    """Band-limited periodic noise, normalised to roughly unit std. lo/hi are in cycles per tile."""
    fx, fy = freq_grid(n)
    r = np.hypot(fx, fy) * n  # cycles per tile
    filt = np.where((r >= lo) & (r <= hi), 1.0 / np.maximum(r, 1.0) ** power, 0.0)
    # soft band edges so there is no ringing
    filt *= np.clip((r - lo) / max(lo * 0.5, 1.0), 0, 1) * np.clip((hi - r) / max(hi * 0.4, 1.0), 0, 1)
    spec = np.fft.fft2(rng.standard_normal((n, n))) * filt
    out = np.real(np.fft.ifft2(spec))
    return out / (out.std() + 1e-9)


def strand_noise(rng, n, angle, length, width):
    """Noise streaked along `angle` (radians): short blade-like strokes. length/width in pixels."""
    fx, fy = freq_grid(n)
    ca, sa = np.cos(angle), np.sin(angle)
    along = fx * ca + fy * sa
    across = -fx * sa + fy * ca
    # spatial elongation along the angle == narrow frequency band along it
    sig_along = 1.0 / (2 * np.pi * length)
    sig_across = 1.0 / (2 * np.pi * width)
    filt = np.exp(-(along ** 2) / (2 * sig_along ** 2) - (across ** 2) / (2 * sig_across ** 2))
    filt[0, 0] = 0.0
    spec = np.fft.fft2(rng.standard_normal((n, n))) * filt
    out = np.real(np.fft.ifft2(spec))
    return out / (out.std() + 1e-9)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def srgb(*rgb):
    return np.array(rgb, dtype=np.float32)


def build(n, seed):
    rng = np.random.default_rng(seed)
    scale = n / 1024.0  # keep feature sizes constant in metres when changing resolution

    # --- blade strokes: several orientations, picked per-clump so direction varies gently -------
    angles = np.linspace(0, np.pi, 6, endpoint=False) + rng.uniform(0, 0.3)
    layers = [strand_noise(rng, n, a, 11 * scale, 1.4 * scale) for a in angles]
    selector = periodic_noise(rng, n, 2, 8)
    # soft weights: each orientation owns a slice of the selector range
    weights = []
    for i in range(len(angles)):
        centre = (i / (len(angles) - 1) - 0.5) * 3.2
        weights.append(np.exp(-((selector - centre) ** 2) / 1.6))
    wsum = np.sum(weights, axis=0) + 1e-6
    strands = sum(w * l for w, l in zip(weights, layers)) / wsum
    strands = strands / (strands.std() + 1e-9)

    fine = periodic_noise(rng, n, 60 * scale, 240 * scale, 0.6)   # leaf-scale speckle
    clump = periodic_noise(rng, n, 8, 40, 1.0)                   # 10-40 cm clumps
    macro = periodic_noise(rng, n, 2, 6, 1.0)                    # ~0.5-1.6 m colour drift
    dry_field = periodic_noise(rng, n, 3, 12, 1.0)               # where it is a bit straw-dry

    # --- height (0..1): strokes + clumps -----------------------------------------------------
    height = 0.5 + 0.13 * strands + 0.09 * clump + 0.04 * fine
    height = np.clip(height, 0.0, 1.0)

    # --- albedo ---------------------------------------------------------------------------------
    shade = np.clip(0.5 + 0.145 * strands + 0.11 * clump + 0.04 * fine, 0.0, 1.0)  # 0 deep, 1 lit tip
    deep = srgb(0.120, 0.185, 0.090)    # shaded undergrowth, a little teal
    mid = srgb(0.190, 0.275, 0.100)     # body of the turf
    tip = srgb(0.290, 0.370, 0.135)     # sunlit blade tips (kept muted: no neon)
    t1 = smoothstep(0.15, 0.55, shade)[..., None]
    t2 = smoothstep(0.55, 0.92, shade)[..., None]
    rgb = deep + (mid - deep) * t1
    rgb = rgb + (tip - mid) * t2

    # slow colour drift: a bit bluer / yellower from patch to patch
    drift = np.clip(0.5 + 0.22 * macro, 0, 1)[..., None]
    rgb = rgb * (srgb(0.92, 0.98, 1.06) * (1 - drift) + srgb(1.07, 1.02, 0.90) * drift)

    # dry straw patches
    dry = smoothstep(0.9, 2.1, dry_field + 0.35 * clump)[..., None] * 0.38
    straw = srgb(0.40, 0.36, 0.19) * (0.80 + 0.35 * shade[..., None])
    rgb = rgb * (1 - dry) + straw * dry

    # a few small soil flecks in the deepest gaps
    soil_mask = smoothstep(2.2, 3.4, -strands + 0.6 * fine - 0.3 * clump)[..., None] * 0.35
    soil = srgb(0.20, 0.155, 0.10)
    rgb = rgb * (1 - soil_mask) + soil * soil_mask

    # cheap ambient occlusion from the height field
    rgb *= (0.78 + 0.34 * height)[..., None]
    rgb = np.clip(rgb * 1.16, 0, 1)

    # --- normal (OpenGL / +Y up) ---------------------------------------------------------------
    h = height
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * n
    drow = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * n
    strength = 0.013  # modest: this is a soft ground, the blade meshes carry the silhouette
    nx = -dx * strength
    ny = drow * strength  # image rows run top->bottom, +Y is up
    nz = np.ones_like(h)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack([nx / length, ny / length, nz / length], axis=-1) * 0.5 + 0.5

    # --- roughness: matte, slightly glossier on lit tips -------------------------------------
    rough = np.clip(0.93 - 0.10 * smoothstep(0.55, 1.0, shade) + 0.03 * fine, 0.70, 1.0)

    return rgb, normal, rough, height


def save(path, arr, mode):
    img = np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(img, mode).save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "public", "textures", "grass"))
    ap.add_argument("--prefix", default="oasis-turf")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    rgb, normal, rough, height = build(args.size, args.seed)
    save(os.path.join(args.out, f"{args.prefix}_albedo.png"), rgb, "RGB")
    save(os.path.join(args.out, f"{args.prefix}_normal-ogl.png"), normal, "RGB")
    save(os.path.join(args.out, f"{args.prefix}_roughness.png"), rough, "L")
    save(os.path.join(args.out, f"{args.prefix}_height.png"), height, "L")
    mean = rgb.reshape(-1, 3).mean(axis=0)
    print(f"wrote {args.prefix}_* ({args.size}px, seed {args.seed}); albedo sRGB mean = {mean.round(3)}")


if __name__ == "__main__":
    main()
