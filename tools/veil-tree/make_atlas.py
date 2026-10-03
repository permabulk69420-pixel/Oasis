"""Procedural 2048x2048 atlas for the veil tree.

Layout in Blender UV space (u right, v up):
  bark   u[0,.5]   v[0,1]    tile 922x1843 px + wrapped overflow strip (right / top)
  leaf0  u[.5,.75] v[.75,1]   leaf1 u[.75,1] v[.75,1]
  leaf2  u[.5,.75] v[.5,.75]  leaf3 u[.75,1] v[.5,.75]
  shell  u[.5,.75] v[.25,.5]  dense opaque foliage mat (canopy core)
  strand u[.75,1]  v[.25,.5]
  pod    u[.5,.75] v[0,.25]   emissive pod pattern
  vein   u[.75,1]  v[0,.25]   emissive vein colour
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2048
import os, sys
OUT = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), "veil_atlas.png")
atlas = np.zeros((S, S, 4), np.float32)
np.seterr(all='ignore')  # rows top->bottom


def pnoise(h, w, sx, sy, seed):
    """Periodic gaussian-filtered noise, zero mean unit std. sx, sy in cycles/image."""
    r = np.random.default_rng(seed)
    F = np.fft.fft2(r.standard_normal((h, w)))
    fy = np.fft.fftfreq(h)[:, None] * h
    fx = np.fft.fftfreq(w)[None, :] * w
    out = np.real(np.fft.ifft2(F * np.exp(-((fx / sx) ** 2 + (fy / sy) ** 2))))
    return (out - out.mean()) / (out.std() + 1e-9)


def worley(h, w, nx, ny, warpx, warpy, stretch, seed):
    r = np.random.default_rng(seed)
    cw, ch = w / nx, h / ny
    pts = r.random((ny, nx, 2)).astype(np.float32)
    E = np.empty((h, w), np.float32)
    xx = np.arange(w, dtype=np.float32)[None, :]
    for y0 in range(0, h, 128):
        y1 = min(h, y0 + 128)
        yy = np.arange(y0, y1, dtype=np.float32)[:, None]
        x = xx + warpx[y0:y1]
        y = yy + warpy[y0:y1]
        cx = np.floor(x / cw).astype(np.int32)
        cy = np.floor(y / ch).astype(np.int32)
        F1 = np.full(x.shape, 1e9, np.float32)
        F2 = F1.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ix, iy = cx + dx, cy + dy
                p = pts[iy % ny, ix % nx]
                px = (ix + p[..., 0]) * cw
                py = (iy + p[..., 1]) * ch
                d = np.sqrt(((x - px) * stretch) ** 2 + (y - py) ** 2)
                F2 = np.where(d < F1, F1, np.minimum(F2, d))
                F1 = np.minimum(F1, d)
        E[y0:y1] = F2 - F1
    return E


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def srgb(c):
    return np.array(c, np.float32) / 255.0


# ------------------------------------------------------------------ bark
TW, TH = 922, 1843  # periodic tile
fib = pnoise(TH, TW, 70, 7, 1)
fib2 = pnoise(TH, TW, 160, 20, 2)
low = pnoise(TH, TW, 5, 4, 3)
wx = pnoise(TH, TW, 6, 5, 4) * 26
wy = pnoise(TH, TW, 5, 6, 5) * 40
e1 = worley(TH, TW, 13, 4, wx, wy, 2.6, 6)
e2 = worley(TH, TW, 21, 13, wx * 0.6 + fib * 4, wy * 0.6, 1.6, 7)
height = np.clip(0.5 + 0.22 * fib + 0.10 * fib2 + 0.16 * low, 0, 1)
base = srgb((17, 20, 33))
ridge = srgb((46, 53, 76))
crack = srgb((3, 4, 8))
col = base + (ridge - base) * (height[..., None] ** 1.6)
# raised plate edges catch a touch more value next to the cracks
edge_hi = sstep(12, 18, e1) * (1 - sstep(18, 34, e1))
col *= (1 + 0.18 * edge_hi)[..., None]
m1 = sstep(2.0, 14, e1) ** 1.3
m2 = 0.6 + 0.4 * sstep(0.4, 3.0, e2)
m = (m1 * m2)[..., None]
col = crack + (col - crack) * m
# faint cold mineral flecks
fl = pnoise(TH, TW, 120, 120, 8)
fl = sstep(2.3, 3.2, fl)[..., None]
col = col + (srgb((50, 80, 96)) - col) * fl * 0.35
col = np.clip(col, 0, 1)
# region: 1024 x 2048, bottom-up coordinates, wrap the tile into the overflow strips
rows_b = np.arange(S) % TH
cols_ = np.arange(1024) % TW
bark_bu = col[rows_b][:, cols_]  # tile is defined bottom-up: row 0 = v 0
atlas[:, 0:1024, :3] = bark_bu[::-1]
atlas[:, 0:1024, 3] = 1.0


# ------------------------------------------------------------------ leaf helpers
def leaf_poly(x, y, L, W, ang):
    t = np.linspace(0, 1, 16)
    xs = t * L
    ys = W * np.sin(np.pi * t) ** 0.85 * (1 - 0.25 * t)
    pts = np.concatenate([np.stack([xs, ys], 1), np.stack([xs[::-1], -ys[::-1]], 1)])
    half = np.stack([xs, ys], 1)
    half = np.concatenate([half, np.stack([xs[::-1], np.zeros_like(xs)], 1)])
    c, s = np.cos(ang), np.sin(ang)
    Rm = np.array([[c, -s], [s, c]])
    return (pts @ Rm.T + [x, y]), (half @ Rm.T + [x, y])


def draw_leaf(dr, x, y, L, W, ang, c, offsets=((0, 0),)):
    full, half = leaf_poly(x, y, L, W, ang)
    cl = tuple(int(v) for v in np.clip(c * 255, 0, 255)) + (255,)
    ch = tuple(int(v) for v in np.clip(c * 1.16 * 255, 0, 255)) + (255,)
    cm = tuple(int(v) for v in np.clip(c * 1.35 * 255, 0, 255)) + (255,)
    tip = (x + np.cos(ang) * L * 0.92, y + np.sin(ang) * L * 0.92)
    for ox, oy in offsets:
        dr.polygon([tuple(p + (ox, oy)) for p in full], fill=cl)
        dr.polygon([tuple(p + (ox, oy)) for p in half], fill=ch)
        dr.line([(x + ox, y + oy), (tip[0] + ox, tip[1] + oy)], fill=cm, width=2)


TEAL = srgb((22, 112, 116))
INDIGO = srgb((46, 46, 138))


def leaf_card(seed, indigo_bias):
    r = np.random.default_rng(seed)
    C = 1024
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    # ragged, roughly square footprint so neighbouring cards knit together instead of reading as discs
    edge_n = pnoise(64, 64, 4, 4, seed + 100)
    for _ in range(5):
        x0 = r.uniform(250, 774)
        pts = [(x0, 20)]
        for k in range(1, 6):
            pts.append((float(np.clip(pts[-1][0] + r.normal(0, 40), 20, C - 20)), 20 + k * r.uniform(90, 150)))
        dr.line(pts, fill=(14, 22, 30, 255), width=4)
    leaves = []
    tries = 0
    while len(leaves) < 330 and tries < 20000:
        tries += 1
        x, y = r.uniform(30, C - 30, 2)
        ed = min(x, y, C - x, C - y) / C
        nz = edge_n[int(y / C * 63), int(x / C * 63)]
        if r.random() > sstep(0.0, 0.16, ed + 0.06 * nz):
            continue
        ang = np.radians(90 + r.normal(0, 38))
        L = r.uniform(90, 165)
        W = L * r.uniform(0.17, 0.23)
        tx, ty = x + np.cos(ang) * L, y + np.sin(ang) * L
        if not (10 < tx < C - 10 and 10 < ty < C - 10):
            continue
        depth = r.random()
        h = np.clip(r.beta(2, 2) * 0.8 + indigo_bias * 0.5 - 0.15, 0, 1)
        c = TEAL + (INDIGO - TEAL) * h
        c = c * (0.72 + 0.34 * depth) * r.uniform(0.94, 1.06)
        leaves.append((depth, x, y, L, W, ang, c))
    leaves.sort(key=lambda t: t[0])
    for depth, x, y, L, W, ang, c in leaves:
        draw_leaf(dr, x, y, L, W, ang, c)
    img = img.resize((512, 512), Image.LANCZOS)
    return np.asarray(img).astype(np.float32) / 255.0


def bleed(rgba):
    """Push leaf colour into transparent pixels so mips/alpha edges don't halo."""
    rgb, a = rgba[..., :3], rgba[..., 3:4]
    out = rgb.copy()
    filled = a[..., 0] > 0.02
    for rad in (2, 4, 8, 16, 32, 64):
        pm = Image.fromarray(np.uint8(np.clip(rgb * a, 0, 1) * 255))
        al = Image.fromarray(np.uint8(np.clip(a[..., 0], 0, 1) * 255))
        pmb = np.asarray(pm.filter(ImageFilter.GaussianBlur(rad))).astype(np.float32) / 255
        alb = np.asarray(al.filter(ImageFilter.GaussianBlur(rad))).astype(np.float32) / 255
        ok = (alb > 0.004) & ~filled
        out[ok] = pmb[ok] / alb[ok][:, None]
        filled |= ok
    res = rgba.copy()
    res[..., :3] = np.where(a > 0.02, rgb, out)
    return res


# PIL gives un-premultiplied colour already; just bleed into empty areas
def place(region_px, img):
    x0, y0 = region_px
    h, w = img.shape[:2]
    atlas[y0:y0 + h, x0:x0 + w] = img


cards = [leaf_card(11, 0.05), leaf_card(12, 0.2), leaf_card(13, 0.45), leaf_card(14, 0.7)]
for i, (px, py) in enumerate([(1024, 0), (1536, 0), (1024, 512), (1536, 512)]):
    c = cards[i]
    rgb = c[..., :3]
    a = c[..., 3:4]
    place((px, py), bleed(c))

# ------------------------------------------------------------------ shell foliage mat (periodic, opaque)
r = np.random.default_rng(21)
C = 1024
img = Image.new("RGBA", (C, C), (18, 54, 64, 255))
dr = ImageDraw.Draw(img)
offs = [(ox, oy) for ox in (-C, 0, C) for oy in (-C, 0, C)]
for _ in range(900):
    x, y = r.uniform(0, C, 2)
    ang = np.radians(90 + r.normal(0, 45))
    L = r.uniform(80, 150)
    h = r.beta(2, 2)
    c = (TEAL + (INDIGO - TEAL) * h) * r.uniform(0.5, 1.0)
    draw_leaf(dr, x, y, L, L * 0.2, ang, c, offs)
shell = np.asarray(img.resize((512, 512), Image.LANCZOS)).astype(np.float32) / 255
shell[..., 3] = 1
place((1024, 1024), shell)

# ------------------------------------------------------------------ strand (u around periodic, v along: top row = strand top)
sf = pnoise(512, 512, 40, 3, 31)
sf2 = pnoise(512, 512, 90, 12, 32)
t = (np.arange(512) / 511.0)[:, None, None]  # 0 top -> 1 bottom (near pod)
top_c, bot_c = srgb((16, 18, 30)), srgb((22, 60, 74))
strand = top_c + (bot_c - top_c) * t ** 2.2
strand = strand * (0.8 + 0.22 * sf[..., None] + 0.08 * sf2[..., None])
st = np.ones((512, 512, 4), np.float32)
st[..., :3] = np.clip(strand, 0, 1)
place((1536, 1024), st)

# ------------------------------------------------------------------ pod emissive (top row = neck, bottom = tip, u around periodic)
s = (np.arange(512) / 511.0)[:, None]
x = (np.arange(512) / 512.0)[None, :]
b = 0.30 + 0.70 * np.sin(np.pi * np.clip(s * 1.08 - 0.04, 0, 1)) ** 0.55
ribs = (0.5 + 0.5 * np.cos(2 * np.pi * 6 * x)) ** 6
spk = sstep(1.8, 2.8, pnoise(512, 512, 90, 90, 41))
k = np.clip(b * (0.78 + 0.28 * ribs) + 0.25 * spk, 0, 1.2)[..., None]
dim, bright, hot = srgb((6, 58, 120)), srgb((70, 205, 255)), srgb((205, 250, 255))
kk = np.clip(k, 0, 1)
pod = dim + (bright - dim) * kk
# white-hot core through the belly of the fruit so it reads as a light source, not a flat cyan blob
core = sstep(0.55, 0.95, kk) * np.clip(np.sin(np.pi * np.clip((s - 0.18) / 0.72, 0, 1)), 0, 1) ** 1.5
pod = np.clip(pod + (hot - pod) * core * 0.85, 0, 1)
pd = np.ones((512, 512, 4), np.float32)
pd[..., :3] = pod
place((1024, 1536), pd)

# ------------------------------------------------------------------ vein emissive
vn = pnoise(512, 512, 4, 30, 51)
vein = srgb((45, 195, 255)) * (0.88 + 0.12 * np.clip(vn, -1, 1))[..., None]
vv = np.ones((512, 512, 4), np.float32)
vv[..., :3] = np.clip(vein, 0, 1)
place((1536, 1536), vv)

Image.fromarray(np.uint8(np.clip(atlas, 0, 1) * 255 + 0.5), "RGBA").save(OUT, optimize=True)
print("saved", OUT)
