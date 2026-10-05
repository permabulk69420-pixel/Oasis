#!/usr/bin/env python3
"""Paints the island's foliage textures: public/textures/island-leaves/{fern,broadleaf,shrub,vine,canopy}.png (1024 x 1024 RGBA each).

    /usr/bin/python3 tools/island-leaves/make_leaf_atlas.py [outdir] [--only fern,vine] [--preview]

Own art (Kane, 6 Oct: no other people's models, textures are fine): every pixel comes from the formulas in leafkit.py, no photographs. The sprite rectangles
(pixels, top-left origin) are written to sprites.json next to the PNGs; src/foliage-cards.js reads the same table (SPRITES there), so change both together.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from leafkit import Sprite, lerp, smoothstep  # noqa: E402

DEG = math.pi / 180.0
OUT = 'public/textures/island-leaves'

# ------------------------------------------------------------------------------------------------------------------------- palette (sRGB, 0..1)
DEEP = (0.055, 0.20, 0.07)
GREEN = (0.14, 0.38, 0.10)
FRESH = (0.34, 0.58, 0.16)
LIME = (0.52, 0.68, 0.20)
TEAL = (0.07, 0.32, 0.27)
PALE = (0.66, 0.80, 0.46)
RUST = (0.62, 0.26, 0.10)


def frond_axis(w, h, sway, n=160):
    s = np.linspace(0, 1, n)
    rx = w / 2 + sway * w * 0.07 * np.sin(s * 2.4) + 0.05 * w * s ** 2 * np.sign(sway if sway else 1)
    ry = (h - 8) - s * (h - 30)
    return s, rx, ry


def axis_angle(rx, ry, i):
    j0, j1 = max(i - 2, 0), min(i + 2, len(rx) - 1)
    return math.atan2(rx[j1] - rx[j0], -(ry[j1] - ry[j0]))


# ------------------------------------------------------------------------------------------------------------------------- ferns
def sword_fern(w, h, rng):
    """A long single-pinnate frond: many narrow leaflets, the longest a third of the way up."""
    sp = Sprite(w, h, rng)
    s, rx, ry = frond_axis(w, h, 0.5)
    pairs = 24
    lmax = 0.47 * w
    for i in range(pairs, -1, -1):
        si = 0.035 + 0.95 * i / pairs
        idx = int(si * (len(s) - 1))
        px, py = rx[idx], ry[idx]
        at = axis_angle(rx, ry, idx)
        f = (math.sin(math.pi * (0.10 + 0.90 * si) ** 0.8) ** 0.7) * (0.30 + 0.70 * float(smoothstep(0.0, 0.2, si)))
        spread = lerp(78, 42, si ** 0.8) * DEG
        for side in (-1, 1):
            jitter = rng.uniform(-0.05, 0.05)
            length = lmax * f * rng.uniform(0.88, 1.08)
            sp.leaf(px, py, at + side * (spread + jitter), length, max(length * 0.085, 7.0), shape='lance', bend=-side * 0.20,
                    c0=lerp(DEEP, GREEN, si * 0.7 + 0.1), c1=lerp(GREEN, FRESH, 0.35 + 0.5 * si), tip_pow=0.9, rib=0.03, rib_mix=0.55,
                    veins=7, vein_slope=1.4, vein_w=0.12, vein_mix=0.12, serrate=0.07, serrate_n=11, edge_dark=0.22, side=0.12,
                    mottle=0.16, grain=0.05)
    pts = [(rx[i], ry[i]) for i in range(0, len(s), 4)]
    sp.tapered(pts, 6.0, 1.6, (0.30, 0.46, 0.18), (0.42, 0.58, 0.24))
    return sp


def lace_fern(w, h, rng):
    """A bipinnate frond: fewer pinnae, each cut into small pinnules, lighter and lacier."""
    sp = Sprite(w, h, rng)
    s, rx, ry = frond_axis(w, h, -0.35)
    pairs = 14
    lmax = 0.47 * w
    for i in range(pairs, -1, -1):
        si = 0.05 + 0.93 * i / pairs
        idx = int(si * (len(s) - 1))
        px, py = rx[idx], ry[idx]
        at = axis_angle(rx, ry, idx)
        f = (math.sin(math.pi * (0.10 + 0.90 * si) ** 0.85) ** 0.75) * (0.35 + 0.65 * float(smoothstep(0.0, 0.18, si)))
        spread = lerp(74, 44, si ** 0.8) * DEG
        shade_c0 = lerp(DEEP, GREEN, 0.25 + 0.5 * si)
        shade_c1 = lerp(GREEN, LIME, 0.25 + 0.55 * si)
        for side in (-1, 1):
            ang = at + side * (spread + rng.uniform(-0.06, 0.06))
            lp = lmax * f * rng.uniform(0.94, 1.05)
            # the pinna's own curved axis
            path = []
            for q in np.linspace(0, 1, 14):
                a = ang - side * 0.20 * q
                path.append((px + math.sin(a) * lp * q, py - math.cos(a) * lp * q))
            n = int(6 + 8 * f)
            for j in range(n, -1, -1):
                q = 0.10 + 0.88 * j / n
                pi_ = min(int(q * (len(path) - 1)), len(path) - 2)
                bx, by = path[pi_]
                pa = math.atan2(path[pi_ + 1][0] - path[pi_][0], -(path[pi_ + 1][1] - path[pi_][1]))
                lj = lp * 0.26 * (1 - 0.62 * q) * rng.uniform(0.9, 1.1)
                for ps in (-1, 1):
                    sp.leaf(bx, by, pa + ps * lerp(66, 40, q) * DEG, lj, max(lj * 0.34, 4.0), shape='lance', bend=-ps * 0.10, c0=shade_c0, c1=shade_c1,
                            rib=0.045, rib_mix=0.4, veins=0, serrate=0.14, serrate_n=5, edge_dark=0.2, side=0.1, mottle=0.14, grain=0.05)
            sp.tapered(path, 3.2 * f + 0.8, 0.8, (0.32, 0.46, 0.2), (0.4, 0.56, 0.24))
    pts = [(rx[i], ry[i]) for i in range(0, len(s), 4)]
    sp.tapered(pts, 5.5, 1.4, (0.30, 0.46, 0.18), (0.42, 0.58, 0.24))
    return sp


# ------------------------------------------------------------------------------------------------------------------------- broad leaves
def heart_leaf(size, rng):
    sp = Sprite(size, size, rng)
    sp.leaf(size / 2, size - 14, 0.0, size - 30, size * 0.92, shape='heart', c0=DEEP, c1=(0.07, 0.30, 0.12), tip_pow=0.7,
            rib=0.022, rib_mix=0.8, rib_color=PALE, veins=8, vein_slope=1.25, vein_w=0.10, vein_mix=0.55, vein_curve=0.35, edge_dark=0.30, side=0.16,
            wave=0.012, wave_n=9, mottle=0.18, grain=0.05)
    return sp


def calathea_leaf(size, rng):
    sp = Sprite(size, size, rng)
    sp.leaf(size / 2, size - 14, 0.0, size - 30, size * 0.56, shape='oval', c0=(0.05, 0.19, 0.08), c1=(0.12, 0.38, 0.16), tip_pow=0.8,
            rib=0.02, rib_mix=0.9, rib_color=(0.74, 0.86, 0.52), veins=13, vein_slope=1.9, vein_w=0.20, vein_mix=0.38, vein_curve=0.2, edge_dark=0.22,
            side=0.14, wave=0.02, wave_n=6, mottle=0.14, grain=0.05)
    return sp


def monstera_leaf(size, rng):
    sp = Sprite(size, size, rng)
    holes = [(0.46, 0.28, 0.05), (0.46, -0.28, 0.05), (0.62, 0.40, 0.04), (0.62, -0.40, 0.04), (0.30, 0.50, 0.035), (0.30, -0.50, 0.035)]
    sp.leaf(size / 2, size - 14, 0.0, size - 30, size * 0.94, shape='heart', c0=(0.05, 0.22, 0.09), c1=(0.09, 0.34, 0.12), tip_pow=0.8,
            rib=0.024, rib_mix=0.85, rib_color=PALE, veins=7, vein_slope=1.3, vein_w=0.10, vein_mix=0.45, vein_curve=0.3, edge_dark=0.26, side=0.15,
            cuts=6, cut_w=0.22, cut_start=0.42, cut_slope=1.1, holes=holes, mottle=0.16, grain=0.05)
    return sp


def paddle_leaf(size, rng):
    sp = Sprite(size, size, rng)
    sp.leaf(size / 2, size - 14, 0.0, size - 30, size * 0.50, shape='paddle', c0=(0.12, 0.34, 0.09), c1=(0.20, 0.47, 0.14), tip_pow=1.0,
            rib=0.03, rib_mix=0.85, rib_color=(0.70, 0.82, 0.45), veins=30, vein_slope=3.4, vein_w=0.34, vein_mix=0.22, edge_dark=0.24, side=0.16,
            cuts=9, cut_w=0.22, cut_start=0.58, cut_slope=3.4, wave=0.012, wave_n=3, mottle=0.18, grain=0.05)
    return sp


# ------------------------------------------------------------------------------------------------------------------------- shrub sprays
def twig_path(w, h, lean, n=40, top=0.96):
    pts = []
    for i in range(n + 1):
        s = i / n
        pts.append((w / 2 + lean * w * (0.5 * s * s + 0.18 * math.sin(s * 3.0)), (h - 8) - s * (h - 16) * top))
    return pts


def twig_angle(pts, i):
    j0, j1 = max(i - 1, 0), min(i + 1, len(pts) - 1)
    return math.atan2(pts[j1][0] - pts[j0][0], -(pts[j1][1] - pts[j0][1]))


def spray(w, h, rng, *, lean, count, length, width, spread, shape, c0, c1, opposite, bend=0.0, terminal=True, droop=0.0, rib_mix=0.6, vein_n=6, serrate=0.0):
    sp = Sprite(w, h, rng)
    pts = twig_path(w, h, lean)
    for i in range(count, -1, -1):
        s = 0.04 + 0.90 * i / count
        idx = int(s * (len(pts) - 1))
        x, y = pts[idx]
        at = twig_angle(pts, idx)
        scale = (1 - 0.55 * s) * rng.uniform(0.9, 1.1)
        for side in ((-1, 1) if opposite else ((-1, 1)[i % 2],)):
            sp.leaf(x, y, at + side * (spread + rng.uniform(-0.12, 0.12)) * (1 - 0.35 * s) - droop * side * 0.0, length * scale, width * scale, shape=shape,
                    bend=-side * bend, c0=lerp(c0, c1, 0.0 + 0.5 * s), c1=lerp(c0, c1, 0.5 + 0.5 * s), tip_pow=0.9, rib=0.035, rib_mix=rib_mix, veins=vein_n, vein_slope=1.5,
                    vein_w=0.14, vein_mix=0.18, edge_dark=0.24, side=0.12, serrate=serrate, serrate_n=7, mottle=0.16, grain=0.05)
    if terminal:
        x, y = pts[-1]
        sp.leaf(x, y, twig_angle(pts, len(pts) - 1), length * 0.5, width * 0.5, shape=shape, c0=c0, c1=c1, rib=0.035, rib_mix=rib_mix, veins=0, mottle=0.16)
    sp.tapered(pts, 3.0, 1.2, (0.28, 0.20, 0.10), (0.22, 0.30, 0.10))
    return sp


def compound_spray(w, h, rng):
    sp = Sprite(w, h, rng)
    pts = twig_path(w, h, 0.25)
    n = 10
    for i in range(n, -1, -1):
        s = 0.05 + 0.88 * i / n
        idx = int(s * (len(pts) - 1))
        x, y = pts[idx]
        at = twig_angle(pts, idx)
        scale = (1 - 0.4 * s)
        for side in (-1, 1):
            sp.leaf(x, y, at + side * (62 - 22 * s) * DEG, 128 * scale, 62 * scale, shape='oval', bend=-side * 0.10, c0=lerp(DEEP, GREEN, 0.35), c1=lerp(GREEN, FRESH, 0.55),
                    rib=0.04, rib_mix=0.65, veins=7, vein_slope=1.4, vein_w=0.12, vein_mix=0.2, edge_dark=0.24, mottle=0.16)
    x, y = pts[-1]
    sp.leaf(x, y, twig_angle(pts, len(pts) - 1), 100, 50, shape='oval', c0=lerp(DEEP, GREEN, 0.4), c1=lerp(GREEN, FRESH, 0.6), rib=0.04, rib_mix=0.65, veins=6, vein_w=0.12, vein_mix=0.2)
    sp.tapered(pts, 4.5, 1.6, (0.30, 0.34, 0.14), (0.30, 0.44, 0.16))
    return sp


# ------------------------------------------------------------------------------------------------------------------------- vines
def vine_strand(w, h, rng, *, leaf, density, color0, color1, wiggle=0.22, tint=0.0):
    sp = Sprite(w, h, rng)
    n = 120
    ph = rng.uniform(0, 6)
    pts = []
    for i in range(n + 1):
        s = i / n
        pts.append((w / 2 + wiggle * w * (0.5 * math.sin(s * 9 + ph) + 0.25 * math.sin(s * 21 + ph * 2)), 4 + s * (h - 8)))
    sp.tapered(pts, 3.0, 2.0, (0.20, 0.27, 0.10), (0.16, 0.30, 0.10))
    k = int(density)
    for j in range(k):
        s = 0.02 + 0.96 * (j + rng.uniform(0.0, 0.8)) / k
        idx = int(s * n)
        x, y = pts[idx]
        side = (-1, 1)[j % 2]
        # leaf hangs down and out from the stem
        ang = math.pi + side * rng.uniform(0.55, 1.15)
        size = leaf * rng.uniform(0.75, 1.12) * (1 - 0.3 * s)
        # the stalk
        sx, sy = x + math.sin(ang) * size * 0.35, y - math.cos(ang) * size * 0.35
        sp.line([(x, y), (sx, sy)], 1.8, (0.18, 0.30, 0.10))
        g = rng.uniform(0, 1)
        sp.leaf(sx, sy, ang, size, size * 0.92, shape='heart', notch=0.35, bend=side * 0.10, c0=lerp(color0, color1, 0.2 + 0.3 * g), c1=lerp(color0, color1, 0.6 + 0.4 * g),
                tip_pow=0.8, rib=0.03, rib_mix=0.7, veins=5, vein_slope=1.2, vein_w=0.12, vein_mix=0.35, edge_dark=0.26, side=0.12, mottle=0.16, grain=0.05, tint_noise=tint)
        if j % 3 == 0:                       # a curl of tendril
            tx, ty = x, y
            tp = [(tx, ty)]
            a = rng.uniform(0, 6.28)
            r0 = 2.0
            for q in range(14):
                a += 0.55
                r0 += 0.8
                tp.append((tx + math.cos(a) * r0 + side * q * 1.5, ty + math.sin(a) * r0 + q * 0.5))
            sp.line(tp, 1.2, (0.22, 0.34, 0.12))
    return sp


# ------------------------------------------------------------------------------------------------------------------------- canopy clusters
def leaf_cluster(size, rng, *, count=70, length=150, width=62, c0=DEEP, c1=FRESH, shape='oval', radial=0.17, tilt=0.5):
    """A round clump of leaves seen from the side, for the big cards in a tree's crown: the back leaves are darker, the front ones lighter."""
    sp = Sprite(size, size, rng)
    cx = cy = size / 2
    items = []
    for _ in range(count):
        a = rng.uniform(0, 2 * math.pi)
        r = size * radial * math.sqrt(rng.uniform(0.02, 1.0))
        items.append((rng.uniform(0, 1), cx + math.cos(a) * r, cy + math.sin(a) * r * 0.92, a))
    items.sort(key=lambda t: t[0])
    for depth, x, y, a in items:
        # leaves point away from the clump's middle, with a little random turn
        ang = math.atan2(x - cx, -(y - cy)) + rng.uniform(-tilt, tilt)
        d = math.hypot(x - cx, y - cy) / (size * radial)
        L = length * rng.uniform(0.8, 1.15)
        sp.leaf(x - math.sin(ang) * L * 0.18, y + math.cos(ang) * L * 0.18, ang, L, width * rng.uniform(0.85, 1.1), shape=shape, bend=rng.uniform(-0.12, 0.12),
                c0=lerp(c0, c1, 0.1 + 0.35 * depth), c1=lerp(c0, c1, 0.45 + 0.5 * depth + 0.1 * d), tip_pow=0.9, rib=0.03, rib_mix=0.55, veins=7, vein_slope=1.4, vein_w=0.12,
                vein_mix=0.16, edge_dark=0.30, side=0.14, mottle=0.15, grain=0.05)
    return sp


# ------------------------------------------------------------------------------------------------------------------------- atlases
def paste(atlas, sprite, x, y):
    atlas[y:y + sprite.shape[0], x:x + sprite.shape[1]] = sprite


def make_atlas(name, cells, seed, swatches=()):
    """cells: [(key, x, y, w, h, builder(w, h, rng) -> Sprite)]; swatches: [(key, x, y, w, h, (r, g, b))] plain patches (a stalk takes its colour from one). Returns (RGBA array, rects)."""
    rng = np.random.default_rng(seed)
    atlas = np.zeros((1024, 1024, 4), np.uint8)
    rects = {}
    for key, x, y, w, h, build in cells:
        sp = build(w, h, np.random.default_rng(rng.integers(1 << 30)))
        paste(atlas, sp.finish(), x, y)
        rects[key] = [x, y, w, h]
        print(f'  {name}.{key} {w}x{h}', flush=True)
    for key, x, y, w, h, color in swatches:
        atlas[y:y + h, x:x + w, :3] = np.array(np.asarray(color) * 255 + 0.5, np.uint8)
        atlas[y:y + h, x:x + w, 3] = 255
        rects[key] = [x, y, w, h]
    return atlas, rects


def build_all(only=None):
    sheets = {}
    want = lambda n: only is None or n in only
    if want('fern'):
        sheets['fern'] = make_atlas('fern', [('sword', 0, 0, 512, 1024, sword_fern), ('lace', 512, 0, 512, 1024, lace_fern)], 101)
    if want('broadleaf'):
        sheets['broadleaf'] = make_atlas('broadleaf', [
            ('heart', 0, 0, 496, 496, lambda w, h, r: heart_leaf(w, r)), ('calathea', 512, 0, 496, 496, lambda w, h, r: calathea_leaf(w, r)),
            ('monstera', 0, 496, 496, 496, lambda w, h, r: monstera_leaf(w, r)), ('paddle', 512, 496, 496, 496, lambda w, h, r: paddle_leaf(w, r))], 202,
            swatches=[('stem', 0, 992, 32, 32, (0.20, 0.30, 0.11))])
    if want('shrub'):
        sheets['shrub'] = make_atlas('shrub', [
            ('privet', 0, 0, 512, 512, lambda w, h, r: spray(w, h, r, lean=0.20, count=13, length=82, width=46, spread=62 * DEG, shape='oval', c0=DEEP, c1=FRESH, opposite=True, bend=0.06)),
            ('willow', 512, 0, 512, 512, lambda w, h, r: spray(w, h, r, lean=-0.28, count=17, length=150, width=24, spread=48 * DEG, shape='lance', c0=lerp(DEEP, TEAL, 0.5), c1=lerp(GREEN, LIME, 0.5), opposite=False, bend=0.10, vein_n=0)),
            ('compound', 0, 512, 512, 512, lambda w, h, r: compound_spray(w, h, r)),
            ('coin', 512, 512, 512, 512, lambda w, h, r: spray(w, h, r, lean=0.30, count=12, length=70, width=64, spread=75 * DEG, shape='oval', c0=lerp(DEEP, TEAL, 0.8), c1=lerp(TEAL, (0.30, 0.58, 0.46), 0.7), opposite=False, bend=0.05, vein_n=5))], 303)
    if want('vine'):
        sheets['vine'] = make_atlas('vine', [
            ('strandA', 0, 0, 256, 1024, lambda w, h, r: vine_strand(w, h, r, leaf=62, density=15, color0=DEEP, color1=FRESH)),
            ('strandB', 256, 0, 256, 1024, lambda w, h, r: vine_strand(w, h, r, leaf=48, density=22, color0=lerp(DEEP, TEAL, 0.5), color1=lerp(GREEN, LIME, 0.5), wiggle=0.30)),
            ('strandC', 512, 0, 256, 1024, lambda w, h, r: vine_strand(w, h, r, leaf=78, density=10, color0=DEEP, color1=GREEN, wiggle=0.16)),
            ('strandD', 768, 0, 256, 1024, lambda w, h, r: vine_strand(w, h, r, leaf=40, density=28, color0=GREEN, color1=LIME, wiggle=0.26))], 404)
    if want('canopy'):
        sheets['canopy'] = make_atlas('canopy', [
            ('broad', 0, 0, 512, 512, lambda w, h, r: leaf_cluster(w, r, count=56, length=140, width=62, c0=DEEP, c1=FRESH, shape='oval')),
            ('slender', 512, 0, 512, 512, lambda w, h, r: leaf_cluster(w, r, count=78, length=165, width=32, c0=lerp(DEEP, TEAL, 0.4), c1=lerp(GREEN, LIME, 0.5), shape='lance')),
            ('fan', 0, 512, 512, 512, lambda w, h, r: leaf_cluster(w, r, count=44, length=160, width=70, c0=lerp(DEEP, GREEN, 0.3), c1=lerp(FRESH, LIME, 0.3), shape='oval', radial=0.15)),
            ('rusty', 512, 512, 512, 512, lambda w, h, r: leaf_cluster(w, r, count=56, length=140, width=58, c0=lerp(DEEP, RUST, 0.25), c1=lerp(FRESH, RUST, 0.35), shape='oval'))], 505)
    return sheets


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    out = args[0] if args else OUT
    only = None
    for i, a in enumerate(sys.argv):
        if a == '--only':
            only = set(sys.argv[i + 1].split(','))
            args = [x for x in args if x != sys.argv[i + 1]]
            out = args[0] if args else OUT
    os.makedirs(out, exist_ok=True)
    sheets = build_all(only)
    table = {}
    for name, (atlas, rects) in sheets.items():
        Image.fromarray(atlas, 'RGBA').save(os.path.join(out, f'{name}.png'), optimize=True)
        table[name] = rects
        print(name, os.path.getsize(os.path.join(out, f'{name}.png')) // 1024, 'KB')
    path = os.path.join(out, 'sprites.json')
    old = json.load(open(path)) if os.path.exists(path) else {}
    old.update(table)
    json.dump(old, open(path, 'w'), indent=1)
    if '--preview' in sys.argv:
        pdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'preview')   # git-ignored
        os.makedirs(pdir, exist_ok=True)
        for name, (atlas, rects) in sheets.items():
            a = atlas.astype(np.float32) / 255
            for label, bg in (('dark', (0.04, 0.10, 0.12)), ('light', (0.75, 0.80, 0.85))):
                comp = a[..., :3] * a[..., 3:4] + np.array(bg, np.float32) * (1 - a[..., 3:4])
                Image.fromarray((comp * 255).astype(np.uint8)).save(os.path.join(pdir, f'preview_{name}_{label}.png'))


if __name__ == '__main__':
    main()
