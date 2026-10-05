"""Painting kit for the island's leaf textures (own art: every pixel is drawn by these functions, no photos).

A Sprite is a supersampled RGB + alpha canvas. paint_leaf() draws one leaf into it from formulas (outline, colour ramp, midrib, lateral veins,
serrated or wavy margin, slits and holes), so the same function paints a 480 px elephant ear and a 14 px fern leaflet. Sprites are
reduced to their final size with area filtering and the colour under the transparent pixels is filled outwards from the edge, so a mip
or a bilinear tap at a leaf's edge never picks up black or grey.

Conventions: pixel units are the sprite's FINAL pixels (the kit multiplies by SS itself); angle 0 points up the sprite, positive turns clockwise;
a leaf starts at its base (x, y) and runs `length` along its axis.
"""
import math

import cv2
import numpy as np
from scipy import ndimage

SS = 3

# The implicit heart (x^2 + y^2 - 1)^3 - x^2 y^3 <= 0, point down, notch up. Flipped for a leaf (point = tip, notch = where the stalk joins).
# HEART_T: how far along the leaf (0 = the lobes' lowest edge, 1 = the tip) each row of the table is; HEART_HW: the leaf's half width there (0..1).
_Y = np.linspace(-1.0, 1.28, 600)
_XS = np.linspace(0.0, 1.2, 1500)
_HW = np.array([(_XS[((_XS ** 2 + y * y - 1.0) ** 3 - _XS ** 2 * y ** 3) <= 0].max() if (((_XS ** 2 + y * y - 1.0) ** 3 - _XS ** 2 * y ** 3) <= 0).any() else 0.0) for y in _Y])
HEART_T = (1.28 - _Y) / 2.28            # y = 1.28 is t = 0 (the lobes), y = -1 is t = 1 (the tip)
HEART_HW = _HW / 1.14
_order = np.argsort(HEART_T)
HEART_T, HEART_HW = HEART_T[_order], HEART_HW[_order]


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def fbm(h, w, rng, base=5, octaves=5, persistence=0.55):
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        n = base * (2 ** o)
        gh = max(2, int(round(n * h / max(h, w)))) + 1
        gw = max(2, int(round(n * w / max(h, w)))) + 1
        grid = rng.random((gh, gw)).astype(np.float32)
        out += amp * cv2.resize(grid, (w, h), interpolation=cv2.INTER_CUBIC)
        total += amp
        amp *= persistence
    return out / total


def lerp(a, b, t):
    a = np.asarray(a, np.float32)
    b = np.asarray(b, np.float32)
    return a + (b - a) * t


class Sprite:
    def __init__(self, w, h, rng):
        self.w, self.h, self.rng = w, h, rng
        self.rgb = np.zeros((h * SS, w * SS, 3), np.float32)
        self.a = np.zeros((h * SS, w * SS), np.float32)
        self.noise = fbm(h * SS, w * SS, rng, base=6, octaves=5)
        self.grain = fbm(h * SS, w * SS, rng, base=90, octaves=2, persistence=0.5)

    # ---------------------------------------------------------------- lines
    def line(self, pts, width, color, closed=False):
        """A polyline `pts` ([(x, y)] final pixels) of `width` pixels in `color`."""
        arr = (np.asarray(pts, np.float64) * SS * 16).round().astype(np.int32).reshape(-1, 1, 2)
        t = max(1, int(round(width * SS)))
        col = tuple(float(c) for c in color)
        cv2.polylines(self.rgb, [arr], closed, col, thickness=t, lineType=cv2.LINE_8, shift=4)
        cv2.polylines(self.a, [arr], closed, 1.0, thickness=t, lineType=cv2.LINE_8, shift=4)

    def tapered(self, pts, w0, w1, color0, color1=None):
        """A polyline whose width runs from w0 to w1 (and colour from color0 to color1), drawn as short segments."""
        color1 = color0 if color1 is None else color1
        n = len(pts) - 1
        for i in range(n):
            t = (i + 0.5) / n
            self.line([pts[i], pts[i + 1]], w0 + (w1 - w0) * t, lerp(color0, color1, t))

    def disc(self, x, y, r, color):
        cv2.circle(self.rgb, (int(round(x * SS)), int(round(y * SS))), max(1, int(round(r * SS))), tuple(float(c) for c in color), -1, lineType=cv2.LINE_8)
        cv2.circle(self.a, (int(round(x * SS)), int(round(y * SS))), max(1, int(round(r * SS))), 1.0, -1, lineType=cv2.LINE_8)

    # ---------------------------------------------------------------- leaves
    def leaf(self, x, y, angle, length, width, *, shape='lance', bend=0.0, c0=(0.10, 0.30, 0.08), c1=(0.30, 0.55, 0.15), tip_pow=1.0,
             rib=0.03, rib_color=(0.62, 0.78, 0.42), rib_mix=0.75, veins=0, vein_slope=0.9, vein_w=0.045, vein_mix=0.30, vein_curve=0.0,
             edge_dark=0.28, side=0.10, light=(-0.6, -0.8), serrate=0.0, serrate_n=16, wave=0.0, wave_n=5, notch=0.0,
             holes=(), cuts=0, cut_w=0.16, cut_start=0.30, cut_slope=None, mottle=0.14, grain=0.05, tint_noise=0.0):
        k = SS
        x, y, L, W = x * k, y * k, length * k, width * k
        d = np.array([math.sin(angle), -math.cos(angle)])
        r = np.array([math.cos(angle), math.sin(angle)])
        bend_px = bend * L
        reach_v = W * 0.8 + abs(bend_px)
        corners = np.array([[x + u * d[0] + v * r[0], y + u * d[1] + v * r[1]] for u in (-0.08 * L, 1.05 * L) for v in (-reach_v, reach_v)])
        x0, y0 = np.floor(corners.min(0)).astype(int)
        x1, y1 = np.ceil(corners.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, self.w * k), min(y1, self.h * k)
        if x1 <= x0 or y1 <= y0:
            return
        X, Y = np.meshgrid(np.arange(x0, x1, dtype=np.float32), np.arange(y0, y1, dtype=np.float32))
        dx, dy = X + 0.5 - x, Y + 0.5 - y
        u = dx * d[0] + dy * d[1]
        v = dx * r[0] + dy * r[1]
        t = u / L
        tc = np.clip(t, 0.0, 1.0)
        v = v - bend_px * tc ** 2
        # outline
        if shape == 'lance':
            hwf = np.sin(np.pi * tc ** 0.72) ** 0.85
        elif shape == 'oval':
            hwf = np.sin(np.pi * tc ** 0.9) ** 0.7
        elif shape == 'heart':
            hwf = np.interp(tc, HEART_T, HEART_HW)
        elif shape == 'paddle':
            hwf = np.where(tc < 0.12, np.sin(np.pi / 2 * tc / 0.12) ** 0.7, np.cos(np.pi / 2 * np.clip((tc - 0.12) / 0.88, 0, 1)) ** 0.55)
        elif shape == 'needle':
            hwf = np.clip(1 - np.abs(2 * tc - 0.5) * 1.0, 0, 1) ** 0.6 * (tc < 1)
        else:
            raise ValueError(shape)
        hw = hwf * W / 2
        if serrate:
            saw = 2 * ((tc * serrate_n) % 1.0) - 1
            hw = hw * (1 + serrate * (saw * 0.5 + 0.5) - serrate * 0.4)
        if wave:
            hw = hw * (1 + wave * np.sin(tc * wave_n * 2 * np.pi + (x * 0.013)))
        inside = (t >= 0) & (t <= 1) & (np.abs(v) <= hw)
        if shape == 'heart':           # the notch where the stalk joins is part of the heart curve
            xv = v / (W / 2) * 1.14
            yv = 1.28 - 2.28 * tc
            inside = (t >= 0) & (t <= 1) & (((xv ** 2 + yv ** 2 - 1.0) ** 3 - xv ** 2 * yv ** 3) <= 0)
        if notch:
            inside &= ~((tc < 0.34) & (np.abs(v) < notch * (W / 2) * (0.34 - tc) / 0.34))
        # slits and holes
        slope = vein_slope if cut_slope is None else cut_slope
        s_abs = np.abs(v) / np.maximum(hw, 1e-3)
        if cuts:
            t0 = tc - slope * np.abs(v) / L
            ph = t0 * cuts
            dist = np.abs((ph + 0.5) % 1.0 - 0.5)
            slit = (dist < cut_w * (0.35 + 0.9 * smoothstep(cut_start, 1.0, s_abs))) & (s_abs > cut_start)
            inside &= ~slit
        for (ht, hs, hr) in holes:
            hx = (tc - ht) * L
            hy = v - hs * (W / 2)
            inside &= ~((hx / (hr * W * 0.8)) ** 2 + (hy / (hr * W)) ** 2 < 1.0)
        if not inside.any():
            return
        # colour
        g = (tc ** tip_pow)[..., None]
        col = c0 * (1 - g) + c1 * g
        col = col.astype(np.float32)
        ld = r[0] * light[0] + r[1] * light[1]
        sgn = np.clip(v / np.maximum(hw, 1e-3), -1, 1)
        shade = 1.0 + side * sgn * ld * 2.0 - edge_dark * smoothstep(0.55, 1.0, np.abs(sgn)) - edge_dark * 0.6 * smoothstep(0.86, 1.0, tc)
        col *= shade[..., None]
        if tint_noise:
            col *= (1 + tint_noise * (self.noise[y0:y1, x0:x1] - 0.5) * 2)[..., None]
        # veins
        if veins:
            t0 = tc - vein_slope * np.abs(v) / L * (1 + vein_curve * np.abs(sgn))
            ph = t0 * veins
            dist = np.abs((ph + 0.5) % 1.0 - 0.5) * (L / veins) / math.sqrt(1 + vein_slope ** 2)
            vw = max(vein_w * (L / veins) * 0.5, 0.45 * k)
            vv = (1 - smoothstep(vw * 0.45, vw, dist)) * (1 - smoothstep(0.80, 1.0, np.abs(sgn)))
            vv = vv * (np.abs(v) > rib * W * 0.8)
            col = col + (np.asarray(rib_color, np.float32) - col) * (vein_mix * vv)[..., None]
        # midrib
        rw = np.maximum(rib * W * (1 - 0.6 * tc), 0.7 * k)
        mr = 1 - smoothstep(rw * 0.55, rw * 1.05, np.abs(v))
        col = col + (np.asarray(rib_color, np.float32) - col) * (rib_mix * mr)[..., None]
        # mottle and grain
        sub = self.noise[y0:y1, x0:x1]
        col *= (1 + mottle * (sub - 0.5) * 2)[..., None]
        col *= (1 + grain * (self.grain[y0:y1, x0:x1] - 0.5) * 2)[..., None]
        reg_rgb = self.rgb[y0:y1, x0:x1]
        reg_a = self.a[y0:y1, x0:x1]
        reg_rgb[inside] = np.clip(col[inside], 0, 1)
        reg_a[inside] = 1.0

    # ---------------------------------------------------------------- output
    def finish(self):
        """-> RGBA uint8 array (h, w, 4), straight alpha, with the colour under the clear pixels filled in from the nearest leaf pixel."""
        premult = self.rgb * self.a[..., None]
        rgb = cv2.resize(premult, (self.w, self.h), interpolation=cv2.INTER_AREA)
        a = cv2.resize(self.a, (self.w, self.h), interpolation=cv2.INTER_AREA)
        rgb = rgb / np.maximum(a, 1e-4)[..., None]
        clear = a < 0.02
        if clear.any() and (~clear).any():
            idx = ndimage.distance_transform_edt(clear, return_distances=False, return_indices=True)
            filled = rgb[idx[0], idx[1]]
            rgb = np.where(clear[..., None], filled, rgb)
        out = np.zeros((self.h, self.w, 4), np.uint8)
        out[..., :3] = np.clip(rgb * 255 + 0.5, 0, 255).astype(np.uint8)
        out[..., 3] = np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
        return out
