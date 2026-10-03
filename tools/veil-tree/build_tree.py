"""Veil tree — procedural build for headless Blender (bpy module).

Blender space is Z-up; the glTF exporter converts to +Y up. Units are metres.
Objects: Trunk, Limbs, Leaves, Strands, Glow_Pods, Glow_Veins
Materials: Bark (Trunk, Limbs, Strands), Leaves (alpha-tested), Glow (shared emissive)
"""
import math
import sys

import bpy
import numpy as np

import os
ATLAS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "veil_atlas.png")
OUT = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), "veil_tree.glb")
rng = np.random.default_rng(20261003)
UP = np.array([0.0, 0.0, 1.0])

# ----------------------------------------------------------------------------- atlas
PX = 1.0 / 2048
PAD = 8 * PX
TU, TV = 922 * PX, 1843 * PX          # bark tile size in UV (overflow strips beyond)
MAX_OVER = 0.105                      # allowed local overflow past 1.0 into the wrap strip
REG = {
    "leaf0": (0.5, 0.75, 0.75, 1.0), "leaf1": (0.75, 0.75, 1.0, 1.0),
    "leaf2": (0.5, 0.5, 0.75, 0.75), "leaf3": (0.75, 0.5, 1.0, 0.75),
    "shell": (0.5, 0.25, 0.75, 0.5), "strand": (0.75, 0.25, 1.0, 0.5),
    "pod": (0.5, 0.0, 0.75, 0.25), "vein": (0.75, 0.0, 1.0, 0.25),
}
stats = {"overflow_clamped": 0}
CUR = ["?"]


def reg_map(name, uv):
    u0, v0, u1, v1 = REG[name]
    uv = np.clip(uv, 0, 1)
    out = np.empty_like(uv)
    out[..., 0] = u0 + PAD + (u1 - u0 - 2 * PAD) * uv[..., 0]
    out[..., 1] = v0 + PAD + (v1 - v0 - 2 * PAD) * uv[..., 1]
    return out


def bark_map(uv):
    """uv: (...,4,2) continuous tile coords per quad corner -> atlas, using the wrap strips."""
    fl = np.floor(uv.min(axis=-2, keepdims=True) + 1e-6)
    loc = uv - fl
    over = loc > 1 + MAX_OVER
    stats["overflow_clamped"] += int(over.any(axis=(-1, -2)).sum())
    stats.setdefault("over_src", {})
    stats["over_src"][CUR[0]] = stats["over_src"].get(CUR[0], 0) + int(over.any(axis=(-1, -2)).sum())
    loc = np.minimum(loc, 1 + MAX_OVER)
    out = np.empty_like(loc)
    out[..., 0] = loc[..., 0] * TU
    out[..., 1] = loc[..., 1] * TV
    return out


# ----------------------------------------------------------------------------- helpers
def nrm(v, axis=-1):
    return v / np.maximum(np.linalg.norm(v, axis=axis, keepdims=True), 1e-9)


def sstep(a, b, x):
    t = np.clip((np.asarray(x) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def wrap_ang(a):
    return (a + np.pi) % (2 * np.pi) - np.pi


class Noise:
    """Smooth 3D noise from a sum of random plane waves (~unit variance)."""

    def __init__(self, n, freq, seed):
        r = np.random.default_rng(seed)
        d = nrm(r.normal(size=(n, 3)))
        self.w = d * freq * r.uniform(0.6, 1.5, (n, 1))
        self.p = r.uniform(0, 2 * np.pi, n)
        self.a = math.sqrt(2.0 / n)

    def __call__(self, P):
        return np.sin(P @ self.w.T + self.p).sum(-1) * self.a


def catmull(pts, n):
    """Centripetal-ish uniform Catmull-Rom through pts, n output samples."""
    P = np.asarray(pts, float)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    segs = len(P) - 3
    out = []
    for i in range(n):
        t = i / (n - 1) * segs
        k = min(int(t), segs - 1)
        u = t - k
        p0, p1, p2, p3 = P[k:k + 4]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


def resample(P, ds=None, n=None):
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    if n is None:
        n = max(3, int(math.ceil(L / ds)) + 1)
    t = np.linspace(0, L, n)
    return np.stack([np.interp(t, s, P[:, k]) for k in range(3)], 1), t, L


def pt_frames(P, n0=None):
    T = nrm(np.gradient(P, axis=0))
    N = np.zeros_like(P)
    if n0 is None:
        a = UP if abs(T[0] @ UP) < 0.9 else np.array([1.0, 0, 0])
        n0 = np.cross(a, T[0])
    n0 = n0 - (n0 @ T[0]) * T[0]
    N[0] = nrm(n0)
    for i in range(1, len(P)):
        v = np.cross(T[i - 1], T[i])
        sv = np.linalg.norm(v)
        if sv < 1e-9:
            N[i] = N[i - 1]
            continue
        k = v / sv
        ang = math.atan2(sv, T[i - 1] @ T[i])
        n = N[i - 1]
        n = n * math.cos(ang) + np.cross(k, n) * math.sin(ang) + k * (k @ n) * (1 - math.cos(ang))
        N[i] = nrm(n - (n @ T[i]) * T[i])
    B = np.cross(T, N)
    return T, N, B


class Acc:
    """Accumulates geometry for one Blender object."""

    def __init__(self):
        self.V, self.C, self.F, self.UV, self.Nrm = [], [], [], [], []
        self.nv = 0

    def add_verts(self, V, C, normals=None):
        V = np.asarray(V, float).reshape(-1, 3)
        C = np.broadcast_to(np.asarray(C, float), V.shape).copy() if np.ndim(C) <= 1 else np.asarray(C, float).reshape(-1, 3)
        base = self.nv
        self.V.append(V)
        self.C.append(C)
        if normals is not None:
            self.Nrm.append(np.asarray(normals, float).reshape(-1, 3))
        self.nv += len(V)
        return base

    def add_faces(self, faces, uvs):
        """faces: (K,n) int, uvs: (K,n,2)"""
        for f, uv in zip(np.asarray(faces), np.asarray(uvs)):
            self.F.append(tuple(int(i) for i in f))
            self.UV.append(uv)

    def tri_count(self):
        return sum(len(f) - 2 for f in self.F)


def grid_faces(base, R, M, wrap=True):
    idx = base + np.arange(R * M).reshape(R, M)
    jn = (np.arange(M) + 1) % M if wrap else np.arange(1, M)
    jj = np.arange(M) if wrap else np.arange(M - 1)
    f = np.stack([idx[:-1][:, jj], idx[:-1][:, jn], idx[1:][:, jn], idx[1:][:, jj]], -1)
    return f.reshape(-1, 4)


def grid_uv(U, V):
    """U, V: (R, M+1) continuous coords (column M = wrap). returns (K,4,2) per quad in face order."""
    R = U.shape[0]
    M = U.shape[1] - 1
    q = lambda A, di, dj: A[di:R - 1 + di, dj:M + dj]
    u = np.stack([q(U, 0, 0), q(U, 0, 1), q(U, 1, 1), q(U, 1, 0)], -1)
    v = np.stack([q(V, 0, 0), q(V, 0, 1), q(V, 1, 1), q(V, 1, 0)], -1)
    return np.stack([u, v], -1).reshape(-1, 4, 2)


def add_tube(acc, X, U, V, C, region, cap_tip=None):
    """X: (R,M,3) ring grid. U,V: (R,M+1). region 'bark' (tiled) or atlas region name."""
    R, M, _ = X.shape
    base = acc.add_verts(X, C)
    faces = grid_faces(base, R, M)
    uv = grid_uv(U, V)
    uv = bark_map(uv) if region == "bark" else reg_map(region, uv)
    acc.add_faces(faces, uv)
    if cap_tip is not None:
        tip, tipcol = cap_tip
        ti = acc.add_verts(tip[None], tipcol)
        ring = base + (R - 1) * M + np.arange(M)
        f = np.stack([ring, np.roll(ring, -1), np.full(M, ti)], 1)
        if region == "bark":
            uvc = np.tile(np.array([[0.1, 0.1], [0.2, 0.1], [0.15, 0.2]]) * [TU, TV], (M, 1, 1))
        else:
            uvc = reg_map(region, np.tile(np.array([[0.4, 0.05], [0.6, 0.05], [0.5, 0.0]]), (M, 1, 1)))
        acc.add_faces(f, uvc)


def tube_rings(P, radius, M, frames=None, rfn=None):
    T, N, B = frames if frames is not None else pt_frames(P)
    phi = np.linspace(0, 2 * np.pi, M, endpoint=False)
    D = np.cos(phi)[None, :, None] * N[:, None, :] + np.sin(phi)[None, :, None] * B[:, None, :]
    rr = np.repeat(np.asarray(radius, float)[:, None], M, 1)
    if rfn is not None:
        rr = rr + rfn(P, D, phi, rr)
    X = P[:, None, :] + rr[..., None] * D
    return X, D, phi, rr, (T, N, B)


def uv_tube(R, M, s, k_around, tile_len):
    U = np.repeat((np.arange(M + 1) / M * k_around)[None, :], R, 0)
    V = np.repeat((np.asarray(s) / tile_len)[:, None], M + 1, 1)
    return U, V


# ============================================================================= TRUNK
nA = Noise(24, 0.16, 1)
nB = Noise(24, 0.55, 2)
nC = Noise(16, 0.05, 3)

TW_RATE = 0.045


def twist(h):
    return TW_RATE * h + 0.16 * np.sin(h * 0.21 + 1.0)


NL = 7
lobe_phi = np.arange(NL) * 2 * np.pi / NL + rng.uniform(-0.22, 0.22, NL)
lobe_reach = rng.uniform(6.5, 9.0, NL)
lobe_H = rng.uniform(11.0, 15.0, NL)
lobe_w = rng.uniform(0.20, 0.27, NL)
order = np.argsort(lobe_phi)
lobe_phi, lobe_reach, lobe_H, lobe_w = lobe_phi[order], lobe_reach[order], lobe_H[order], lobe_w[order]
valley_phi = np.array([(lobe_phi[i] + wrap_ang(lobe_phi[(i + 1) % NL] - lobe_phi[i]) / 2) for i in range(NL)])
TRUNK_TOP = 19.5


def core_R(h):
    h = np.asarray(h, float)
    hh = np.maximum(h, 0)
    R = 5.5 + 2.2 * np.exp(-hh / 4.0) + 1.7 * sstep(10.0, TRUNK_TOP, h)
    R = R * (1 - 0.30 * sstep(17.0, TRUNK_TOP, h) ** 1.5)   # rounded shoulder under the limbs
    return R + np.maximum(-h, 0) * 0.35


def lobe_extra(h, i):
    h = np.asarray(h, float)
    t = np.clip(h / lobe_H[i], 0, 1)
    e = lobe_reach[i] * (1 - t) ** 2.1
    return np.where(h < 0, lobe_reach[i] * (1 + 0.08 * -h), e)


# vein grooves on the trunk: list of (theta_fn(h), h0, h1, depth, sigma)
trunk_vein_defs = []
for i in range(NL):
    m1, m2 = (0.0, 0.0) if i == 0 else (rng.uniform(0.04, 0.08), rng.uniform(0.015, 0.03))  # vein 0 hides the texture seam
    p1, p2 = rng.uniform(0, 6.28, 2)
    trunk_vein_defs.append(dict(kind="valley", fn=(lambda h, a=valley_phi[i], m1=m1, m2=m2, p1=p1, p2=p2:
                                                   a + m1 * np.sin(0.31 * h + p1) + m2 * np.sin(0.95 * h + p2)),
                                h0=-0.6, h1=TRUNK_TOP - 0.4, depth=0.24, sigma=0.36, i=i))
crest_top = set(rng.choice(NL, 3, replace=False).tolist())
for i in range(NL):
    h1 = TRUNK_TOP - 0.5 if i in crest_top else lobe_H[i] * 0.88
    p1 = rng.uniform(0, 6.28)
    trunk_vein_defs.append(dict(kind="crest", fn=(lambda h, a=lobe_phi[i] + 0.012, p1=p1: a + 0.02 * np.sin(0.7 * h + p1)),
                                h0=0.6, h1=h1, depth=0.22, sigma=0.32, i=i))


def trunk_radius(theta, h, with_groove=True):
    """theta in the twisted frame, h height. Broadcasts."""
    theta, h = np.broadcast_arrays(np.asarray(theta, float), np.asarray(h, float))
    R = core_R(h)
    r = R.copy()
    lobe_sum = np.zeros_like(r)
    for i in range(NL):
        w = lobe_w[i] * (1 + 0.9 * np.clip(h / lobe_H[i], 0, 1))
        g = np.exp(-(wrap_ang(theta - lobe_phi[i]) / w) ** 2)
        e = lobe_extra(h, i) * g
        r = r + e
        lobe_sum = lobe_sum + g * np.clip(lobe_extra(h, i) / 3, 0, 1)
    flute = (0.5 + 0.5 * np.cos(11 * theta + 2.5 * np.sin(h * 0.27))) ** 3
    r = r - 0.60 * flute * (1 - np.clip(lobe_sum, 0, 1)) * sstep(-1, 3, h)
    ang = theta + twist(h)
    P = np.stack([R * np.cos(ang), R * np.sin(ang), h], -1)
    r = r + 0.60 * nA(P) + 0.16 * nB(P) + 0.75 * nC(P) * sstep(1, 8, h)
    g_sum = np.zeros_like(r)
    if with_groove:
        for d in trunk_vein_defs:
            win = sstep(d["h0"] - 0.8, d["h0"] + 0.3, h) * (1 - sstep(d["h1"] - 0.2, d["h1"] + 1.0, h))
            arc = wrap_ang(theta - d["fn"](h)) * r
            g = np.exp(-(arc / d["sigma"]) ** 2) * win
            r = r - d["depth"] * g
            g_sum = np.maximum(g_sum, g)
    return r, g_sum


# rows (denser near ground)
NR = 54
H0 = -1.0
s = np.linspace(0, 1, NR)
rows_h = H0 + (TRUNK_TOP - H0) * s ** 1.3
# columns: equal arc length of the h=0.8 cross-section blended with uniform
th_f = np.linspace(-np.pi, np.pi, 4000, endpoint=False) + valley_phi[0] + np.pi  # start at seam vein
rr0, _ = trunk_radius(th_f, 0.8, with_groove=False)
xy = np.stack([rr0 * np.cos(th_f), rr0 * np.sin(th_f)], 1)
seg = np.linalg.norm(np.diff(np.vstack([xy, xy[:1]]), axis=0), axis=1)
dens = seg / seg.sum() * 0.62 + (1.0 / len(seg)) * 0.38
cdf = np.concatenate([[0], np.cumsum(dens)])[:-1]
NC = 184
cols_theta = np.interp(np.arange(NC) / NC, cdf, th_f)
cols_theta = cols_theta - cols_theta[0] + valley_phi[0]   # column 0 exactly on vein 0 (texture seam)

TH, HH = np.meshgrid(cols_theta, rows_h)
R_tr, G_tr = trunk_radius(TH, HH)
ANG = TH + twist(HH)
X_tr = np.stack([R_tr * np.cos(ANG), R_tr * np.sin(ANG), HH], -1)

# UVs: U = true arc length around each ring / tile width; V = height / tile height
TILE_W, TILE_H = 9.0, 13.0
Xw = np.concatenate([X_tr, X_tr[:, :1]], 1)
cum = np.concatenate([np.zeros((NR, 1)), np.cumsum(np.linalg.norm(np.diff(Xw, axis=1), axis=2), 1)], 1)
perim = cum[:, -1]
S_t = perim / TILE_W                     # ideal tiles per ring
S_r = S_t.copy()
for _ in range(200):                     # rate-limit so neighbouring rings don't shear the texture
    for i in range(1, NR):
        S_r[i] = np.clip(S_r[i], S_r[i - 1] - 0.085, S_r[i - 1] + 0.085)
    for i in range(NR - 2, -1, -1):
        S_r[i] = np.clip(S_r[i], S_r[i + 1] - 0.085, S_r[i + 1] + 0.085)
U_tr = cum / perim[:, None] * S_r[:, None]
V_tr = np.repeat(((rows_h - H0) / TILE_H)[:, None], NC + 1, 1)

# bark albedo variation (not lighting): darker in the vein cracks, mottled patches
nM = Noise(16, 0.25, 9)
mott = 0.88 + 0.12 * np.clip(nM(X_tr), -1, 1)
C_tr = (mott * (1 - 0.55 * G_tr))[..., None] * np.array([1.0, 1.0, 1.0])

trunk = Acc()
CUR[0] = 'trunk'
cap_c = np.array([0, 0, TRUNK_TOP + 1.2])
add_tube(trunk, X_tr, U_tr, V_tr, C_tr, "bark", cap_tip=(cap_c, [0.7, 0.7, 0.7]))

# ---- surface roots rolling out from the buttress lobes
veins = Acc()
VEIN_M = 4


def add_vein_segmented(P, r0, r1, min_len=2.5):
    """Break a vein path into 1-3 pieces with short gaps so it reads as a crack, not a tube."""
    P, sarc, L = resample(P, ds=0.3)
    if L < min_len:
        return
    cuts = [0.0]
    pos = 0.0
    while True:
        pos += rng.uniform(4.0, 11.0)
        if pos >= L - 1.5:
            break
        cuts.append(pos)
        pos += rng.uniform(0.6, 2.2)
        cuts.append(pos)
    cuts.append(L)
    for a, b in zip(cuts[0::2], cuts[1::2]):
        if b - a < 1.2:
            continue
        sel = (sarc >= a) & (sarc <= b)
        if sel.sum() < 3:
            continue
        ta, tb = a / L, b / L
        add_vein(P[sel], r0 + (r1 - r0) * ta, r0 + (r1 - r0) * tb)


def add_vein(P, r0, r1, M=VEIN_M, taper=0.12):
    """Thin emissive tube along polyline P (already on/under the surface)."""
    P, sarc, L = resample(P, ds=0.62)
    if len(P) < 3:
        return
    t = sarc / max(L, 1e-6)
    radius = r0 + (r1 - r0) * t
    radius *= sstep(0, taper, t) * 0.8 + 0.2
    radius *= (1 - sstep(1 - taper, 1, t)) * 0.8 + 0.2
    X, D, phi, rr, _ = tube_rings(P, radius, M)
    U = np.repeat((np.arange(M + 1) / M)[None, :], len(P), 0)
    V = np.repeat((0.1 + 0.8 * t)[:, None], M + 1, 1)
    add_tube(veins, X, U, V, np.ones((len(P), M, 3)), "vein")


root_defs = []
for i in range(NL):
    phi0 = lobe_phi[i] + twist(0.0)
    reach = core_R(0.0) + lobe_reach[i]
    n_r = 1 + (rng.random() < 0.55)
    for k in range(n_r):
        az = phi0 + (0 if k == 0 else rng.choice([-1, 1]) * rng.uniform(0.25, 0.45))
        L = rng.uniform(10, 17) * (1 if k == 0 else 0.65)
        root_defs.append((i, az, reach - (2.6 if k == 0 else 1.0), L, k))

nR = Noise(12, 0.3, 11)
for (i, az, r_start, L, k) in root_defs:
    CUR[0] = 'root'
    n_s = max(8, int(L / 0.55))
    t = np.linspace(0, 1, n_s)
    ph = rng.uniform(0, 6.28)
    meander = rng.uniform(1.0, 2.2) * np.sin(t * np.pi * rng.uniform(1.2, 2.2) + ph) * t
    rad = r_start + L * t
    a = az + meander / np.maximum(rad, 1)
    zc = (0.35 - 0.55 * t) + 0.32 * np.sin(t * np.pi * 2.6 + ph) * (1 - 0.4 * t)
    if k == 1:
        zc = zc - 0.15
    P = np.stack([rad * np.cos(a), rad * np.sin(a), zc], 1)
    # Bury the root's start inside the trunk: its flat first ring used to poke out beside the
    # buttress fin as a blunt stub. Extend the path inward at full width instead.
    EXT = 3.4 if k == 0 else 2.6
    t0 = nrm(P[1] - P[0])
    ext_pts = P[0][None, :] - t0[None, :] * np.arange(EXT, 0, -0.5)[:, None]
    P = np.concatenate([ext_pts, P])
    P, sarc, Lr = resample(P, ds=0.55)
    tt = np.clip((sarc - EXT) / (Lr - EXT), 0, 1)
    T = nrm(np.gradient(P, axis=0))
    N = nrm(np.cross(UP, T))
    B = np.cross(T, N)
    wdt = (2.3 if k == 0 else 1.5) * (1 - tt) ** 0.8 + 0.25   # half width
    hgt = (1.55 if k == 0 else 1.0) * (1 - tt) ** 0.9 + 0.22  # half height
    M = 12
    phi = np.linspace(0, 2 * np.pi, M, endpoint=False)
    groove_a = np.pi / 2 + 0.25
    Pg = P[:, None, :]
    lump = 0.12 * nR(P)[:, None]
    gq = np.exp(-(wrap_ang(phi[None, :] - groove_a) / 0.22) ** 2) * (1 - sstep(0.85, 1.0, tt))[:, None]
    ax = (wdt[:, None] + lump) * np.cos(phi)[None, :]
    bz = (hgt[:, None] + lump) * np.sin(phi)[None, :] * (1 - 0.35 * gq)
    X = Pg + ax[..., None] * N[:, None, :] + bz[..., None] * B[:, None, :]
    U, V = uv_tube(len(P), M, sarc, 1, TILE_H)
    Cc = (0.9 * (1 - 0.5 * gq))[..., None] * np.ones(3)
    add_tube(trunk, X, U, V, Cc, "bark")
    # vein along the root-top crack (groove bottom), tip -> trunk
    ga = groove_a
    vp = P + (wdt * math.cos(ga))[:, None] * N + ((hgt * math.sin(ga) * 0.65) + 0.04)[:, None] * B
    sel = (tt < 0.86) & (sarc >= EXT)
    if sel.sum() > 3:
        add_vein_segmented(vp[sel][::-1], 0.06, 0.10 if k == 0 else 0.08)

# ---- trunk veins (valley and crest cracks)
for d in trunk_vein_defs:
    hs = np.linspace(d["h0"], d["h1"], int((d["h1"] - d["h0"]) / 0.4) + 2)
    th = d["fn"](hs)
    r, _ = trunk_radius(th, hs)
    r = r + 0.03
    a = th + twist(hs)
    P = np.stack([r * np.cos(a), r * np.sin(a), hs], 1)
    add_vein_segmented(P, 0.095, 0.07 if d["kind"] == "valley" else 0.06)
    # one or two hair-thin forks peeling off the crack and fading out on the bark
    for _ in range(rng.integers(0, 3)):
        h0 = rng.uniform(d["h0"] + 1, d["h1"] - 3) if d["h1"] - d["h0"] > 5 else None
        if h0 is None:
            continue
        flen = rng.uniform(2.5, 5.0)
        hh = np.linspace(h0, min(h0 + flen, TRUNK_TOP - 0.3), 14)
        tt = (hh - h0) / max(hh[-1] - h0, 1e-3)
        thf = d["fn"](hh) + rng.choice([-1, 1]) * rng.uniform(0.10, 0.22) * tt ** 1.3
        rf, _ = trunk_radius(thf, hh)
        af = thf + twist(hh)
        Pf = np.stack([(rf + 0.035) * np.cos(af), (rf + 0.035) * np.sin(af), hh], 1)
        add_vein(Pf, 0.06, 0.03, taper=0.3)

# ============================================================================= LIMBS
limbs = Acc()
CUR[0] = 'limb'
NLIMB = 6
limb_az = np.arange(NLIMB) * 2 * np.pi / NLIMB + rng.uniform(-0.2, 0.2, NLIMB) + 0.3
base_rz = np.array([(2.4, 12.5), (4.8, 17.5), (9.0, 25.5), (17.0, 33.5), (26.0, 38.5),
                    (34.0, 38.8), (40.0, 35.2), (43.5, 30.5)])
nL = Noise(20, 0.32, 21)
nL2 = Noise(20, 1.1, 22)
limb_data = []


def limb_rfn_factory(seed, vein_angles_fn):
    ph = seed * 1.7

    def rfn(P, D, phi, rr):
        X = P[:, None, :] + rr[..., None] * D
        s_ = np.linspace(0, 1, len(P))[:, None]
        lump = 0.10 * nL(X) + 0.035 * nL2(X)
        ridge = 0.05 * np.cos(5 * phi[None, :] + 9 * s_ + ph)
        return rr * (lump + ridge)
    return rfn


for li in range(NLIMB):
    az0 = limb_az[li]
    sc = rng.uniform(0.94, 1.06)
    dz = np.concatenate([[0, 0, 0], rng.uniform(-2.5, 2.5, 5)])
    drift = rng.uniform(-0.18, 0.18)
    ph = rng.uniform(0, 6.28)
    pts = []
    for j, (rr_, zz) in enumerate(base_rz):
        t = j / (len(base_rz) - 1)
        a = az0 + drift * t + 0.06 * math.sin(3 * t + ph)
        r_ = rr_ * (sc if j > 1 else 1)
        side = 1.4 * math.sin(t * 5 + ph) * t
        p = np.array([r_ * math.cos(a), r_ * math.sin(a), zz + dz[j]])
        p += side * np.array([-math.sin(a), math.cos(a), 0])
        pts.append(p)
    dense = catmull(pts, 400)
    P, sarc, L = resample(dense, ds=1.0)
    t = sarc / L
    radius = 0.28 + (3.4 - 0.28) * (1 - t) ** 1.35
    frames = pt_frames(P, n0=np.array([-math.sin(az0), math.cos(az0), 0.0]))
    rfn = limb_rfn_factory(li, None)
    M = 14
    X, D, phi, rr, (T, N, B) = tube_rings(P, radius, M, frames, rfn)
    U, V = uv_tube(len(P), M, sarc, 1, 12.0)
    Cc = (0.86 + 0.14 * np.clip(nM(X), -1, 1))[..., None] * np.ones(3)
    tip = P[-1] + T[-1] * 0.6
    add_tube(limbs, X, U, V, Cc, "bark", cap_tip=(tip, [0.8, 0.8, 0.8]))
    limb_data.append(dict(P=P, t=t, radius=radius, T=T, N=N, B=B, az=az0, L=L, rfn=rfn, M=M))

    # two veins along the lower flanks, so they read from the ground
    down = -UP
    phi_down = np.arctan2(down @ B.T, down @ N.T)
    for side in (-1, 1):
        a_v = phi_down + side * (0.95 + 0.25 * np.sin(t * 7 + ph + side))
        sel = (P[:, 2] > TRUNK_TOP - 1.5) & (t < 0.80)
        idx = np.where(sel)[0]
        if len(idx) < 4:
            continue
        Dv = np.cos(a_v)[:, None] * N + np.sin(a_v)[:, None] * B
        # surface radius at that angle (same displacement function)
        rv = radius + rfn(P, Dv[:, None, :], a_v, radius[:, None])[:, 0] if False else None
        Xs = P[:, None, :] + radius[:, None, None] * Dv[:, None, :]
        lump = 0.10 * nL(Xs[:, 0]) + 0.035 * nL2(Xs[:, 0])
        # ridge term evaluated at the vein angle
        s_ = np.linspace(0, 1, len(P))
        ridge = 0.05 * np.cos(5 * a_v + 9 * s_ + li * 1.7)
        rsurf = radius * (1 + lump + ridge)
        vp = P + (rsurf + 0.04)[:, None] * Dv
        add_vein_segmented(vp[idx], 0.085, 0.04)

# ============================================================================= CANOPY CLUMPS
clumps = []  # (center, radii(3), rotz, tier)


def limb_point(li, tq):
    d = limb_data[li]
    i = int(np.clip(np.searchsorted(d["t"], tq), 0, len(d["t"]) - 1))
    return d["P"][i], i


for li in range(NLIMB):
    p, _ = limb_point(li, 0.86)
    out = nrm(np.array([p[0], p[1], 0]))
    clumps.append((p + out * 1.0 + UP * 4.0, np.array([11.0, 10.0, 6.5]) * rng.uniform(0.92, 1.06), rng.uniform(0, 6.28), 1))
    p, _ = limb_point(li, 0.62)
    clumps.append((p + UP * 5.5, np.array([12.0, 11.0, 7.0]) * rng.uniform(0.92, 1.06), rng.uniform(0, 6.28), 1))
for li in range(NLIMB):
    a = (limb_az[li] + limb_az[(li + 1) % NLIMB] + (2 * np.pi if li == NLIMB - 1 else 0)) / 2
    r_, z_ = rng.uniform(36, 39), rng.uniform(40, 43)
    clumps.append((np.array([r_ * math.cos(a), r_ * math.sin(a), z_]), np.array([10.5, 9.5, 6.5]) * rng.uniform(0.92, 1.05), rng.uniform(0, 6.28), 1))
N2 = 9
for k in range(N2):
    a = limb_az[0] + k * 2 * np.pi / N2 + rng.uniform(-0.15, 0.15)
    r_, z_ = rng.uniform(24, 28), rng.uniform(54, 57)
    clumps.append((np.array([r_ * math.cos(a), r_ * math.sin(a), z_]), np.array([12.5, 11.5, 7.5]) * rng.uniform(0.94, 1.05), rng.uniform(0, 6.28), 2))
for k in range(4):
    a = limb_az[0] + 0.5 + k * np.pi / 2 + rng.uniform(-0.2, 0.2)
    clumps.append((np.array([12 * math.cos(a), 12 * math.sin(a), rng.uniform(64, 66)]), np.array([12.0, 11.0, 7.5]), rng.uniform(0, 6.28), 3))
clumps.append((np.array([0.0, 0.0, 70.5]), np.array([14.0, 13.0, 8.6]), 0.4, 3))


def ell_inv(cen, rad, rot):
    c, s_ = math.cos(rot), math.sin(rot)
    Rm = np.array([[c, -s_, 0], [s_, c, 0], [0, 0, 1]])
    return Rm, cen, rad


CL = [ell_inv(*c[:3]) for c in clumps]


def inside_other(X, k, scale=0.94):
    """True where point X (N,3) lies inside any clump other than k (ellipsoid scaled)."""
    res = np.zeros(len(X), bool)
    for j, (Rm, cen, rad) in enumerate(CL):
        if j == k:
            continue
        L = (X - cen) @ Rm
        res |= ((L / (rad * scale)) ** 2).sum(1) < 1
    return res


def ico(sub):
    t = (1 + 5 ** 0.5) / 2
    V = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
         (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6),
         (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10),
         (8, 6, 7), (9, 8, 1)]
    V = [np.array(v, float) / np.linalg.norm(v) for v in V]
    for _ in range(sub):
        cache = {}
        nF = []

        def mid(a, b):
            key = (min(a, b), max(a, b))
            if key not in cache:
                m = V[a] + V[b]
                V.append(m / np.linalg.norm(m))
                cache[key] = len(V) - 1
            return cache[key]
        for a, b, c in F:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nF += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        F = nF
    return np.array(V), np.array(F)


ICO_V, ICO_F = ico(2)
leaves = Acc()
leaf_normals = []
nS = Noise(16, 0.22, 31)
TOP_TINT = np.array([0.76, 0.66, 0.95])
BOT_TINT = np.array([0.96, 1.0, 1.0])


def leaf_color(nz, extra=1.0, jitter=0.0):
    f = np.clip((nz + 0.25) / 1.05, 0, 1)[..., None]
    bright = (1.0 - 0.30 * f) * extra * (1 + jitter)
    tint = BOT_TINT + (TOP_TINT - BOT_TINT) * f
    return np.clip(tint * bright, 0, 1)


SHELL_K = 0.82
card_count = 0
for k, (cen, rad, rot, tier) in enumerate(clumps):
    Rm, _, _ = CL[k]
    # ---------- opaque core shell
    Vs = ICO_V.copy()
    Vs[:, 2] = np.where(Vs[:, 2] < 0, Vs[:, 2] * 0.80, Vs[:, 2])        # flatter underside
    disp = 1 + 0.10 * nS(Vs * 6 + k * 3.1)
    Lp = Vs * rad * SHELL_K * disp[:, None]
    Xs = Lp @ Rm.T + cen
    nrm_e = nrm((Vs / rad ** 2) @ Rm.T)
    cent = Xs[ICO_F].mean(1)
    keep = ~inside_other(cent, k, 0.96)
    F = ICO_F[keep]
    base = leaves.add_verts(Xs, leaf_color(nrm_e[:, 2], 0.95))
    leaf_normals.append(nrm_e)
    # per-face random placement of the triangle inside the shell region (tileable mat)
    uvs = []
    for f in F:
        p0, p1, p2 = Xs[f]
        e1 = p1 - p0
        e2 = p2 - p0
        ax = nrm(e1)
        ay = nrm(np.cross(np.cross(e1, e2), e1))
        q = np.array([[0, 0], [e1 @ ax, e1 @ ay], [e2 @ ax, e2 @ ay]]) / 9.0
        q -= q.min(0)
        ext = q.max(0)
        sc = min(1.0, 0.95 / max(ext.max(), 1e-6))
        q *= sc
        off = rng.uniform(0, 1 - q.max(0).clip(0, 0.99))
        uvs.append(reg_map("shell", q + off))
    leaves.add_faces(F + base, np.array(uvs))

    # ---------- leaf cards on the clump surface (shingled, 1-2 layers over the shell)
    area = 4 * np.pi * ((rad[0] * rad[1]) ** 1.6 + (rad[0] * rad[2]) ** 1.6 + (rad[1] * rad[2]) ** 1.6) ** (1 / 1.6) / 3 ** (1 / 1.6)
    csize_mean = {1: 5.0, 2: 5.4, 3: 5.8}[tier]
    n_try = int(area * 2.5 / (csize_mean ** 2 * 0.80))
    dirs = nrm(rng.normal(size=(n_try, 3)))
    Pl = dirs * rad
    Pw = Pl @ Rm.T + cen
    ok = ~inside_other(Pw, k, 0.90)
    for d_, pw in zip(dirs[ok], Pw[ok]):
        n_e = nrm((d_ / rad ** 2) @ Rm.T)
        size = csize_mean * rng.uniform(0.82, 1.18)
        under = n_e[2] < -0.35
        jitter = rng.normal(size=3)
        n_c = nrm(n_e + jitter * (0.6 if under else 0.26))
        if under:   # hanging fringe on the underside: tilt toward vertical
            hor = nrm(np.array([n_e[0], n_e[1], 0]) + 1e-3)
            n_c = nrm(n_c * 0.5 + hor * 0.8)
        upv = UP - (UP @ n_c) * n_c
        if np.linalg.norm(upv) < 0.2:
            upv = np.cross(n_c, nrm(rng.normal(size=3)))
        upv = nrm(upv)
        rot_a = rng.normal(0, 0.35)
        rgt = np.cross(upv, n_c)
        upv, rgt = upv * math.cos(rot_a) + rgt * math.sin(rot_a), rgt * math.cos(rot_a) - upv * math.sin(rot_a)
        w = size * rng.uniform(0.9, 1.1)
        h = size
        c0 = pw + n_e * size * 0.06 - upv * h * 0.12      # hang slightly below the attach point
        bulge = n_c * w * 0.13
        top_in, bot_out = -n_c * h * 0.06, n_c * h * 0.10
        V6 = np.array([
            c0 - rgt * w / 2 - upv * h / 2 + bot_out, c0 - upv * h / 2 + bot_out + bulge, c0 + rgt * w / 2 - upv * h / 2 + bot_out,
            c0 - rgt * w / 2 + upv * h / 2 + top_in, c0 + upv * h / 2 + top_in + bulge, c0 + rgt * w / 2 + upv * h / 2 + top_in])
        jit = rng.uniform(-0.035, 0.035)
        extra = {1: 1.0, 2: 0.97, 3: 0.93}[tier]
        nz_v = np.full(6, n_c[2]) * 0.5 + n_e[2] * 0.5
        cols = leaf_color(nz_v, extra, jit)
        # bent normals: mostly the clump's ellipsoid normal so the mass shades as one volume
        Lv = (V6 - cen) @ Rm
        en = nrm((Lv / rad ** 2) @ Rm.T)
        vn = nrm(0.35 * n_c + 0.65 * en)
        b = leaves.add_verts(V6, cols)
        leaf_normals.append(vn)
        var = rng.integers(0, 4)
        if tier == 3 or n_e[2] > 0.5:
            var = rng.choice([1, 2, 3])
        uv6 = reg_map(f"leaf{var}", np.array([[0, 0], [0.5, 0], [1, 0], [0, 1], [0.5, 1], [1, 1]], float))
        f2 = np.array([[b + 0, b + 1, b + 4, b + 3], [b + 1, b + 2, b + 5, b + 4]])
        leaves.add_faces(f2, np.array([uv6[[0, 1, 4, 3]], uv6[[1, 2, 5, 4]]]))
        card_count += 1

# ============================================================================= SECONDARY / TERTIARY BRANCHES
def branch(start, start_dir, goal, r0, r1, M, sideways=0.0, ds=1.2):
    CUR[0] = 'branch'
    mid = start + start_dir * np.linalg.norm(goal - start) * 0.25
    mid2 = (mid + goal) / 2 + UP * np.linalg.norm(goal - start) * 0.08 + sideways
    dense = catmull([start - start_dir * 0.8, start, mid, mid2, goal], 200)
    P, sarc, L = resample(dense, ds=ds)
    t = sarc / L
    radius = r1 + (r0 - r1) * (1 - t) ** 1.2

    def rfn(P_, D, phi, rr):
        X = P_[:, None, :] + rr[..., None] * D
        return rr * (0.12 * nL(X * 1.3) + 0.04 * np.cos(4 * phi[None, :] + 6 * t[:, None]))
    X, D, phi, rr, (T, N, B) = tube_rings(P, radius, M, rfn=rfn)
    U, V = uv_tube(len(P), M, sarc, 1, 14.0)
    Cc = (0.86 + 0.14 * np.clip(nM(X), -1, 1))[..., None] * np.ones(3)
    add_tube(limbs, X, U, V, Cc, "bark", cap_tip=(P[-1] + T[-1] * 0.3, [0.8, 0.8, 0.8]))
    return P, t, radius


sec = []
upper = [k for k, c in enumerate(clumps) if c[3] >= 2]
for k in upper:
    cen, rad, rot, tier = clumps[k]
    a = math.atan2(cen[1], cen[0])
    li = int(np.argmin([abs(wrap_ang(a - d["az"])) for d in limb_data]))
    tq = 0.42 if tier == 2 else 0.22
    if np.linalg.norm(cen[:2]) < 1:
        tq = 0.18
    p, i = limb_point(li, tq + rng.uniform(-0.05, 0.05))
    d = limb_data[li]
    sdir = nrm(d["T"][i] * 0.4 + UP * 1.0)
    goal = cen - UP * rad[2] * 0.15
    r0 = d["radius"][i] * 0.55
    P, t, radius = branch(p, sdir, goal, r0, 0.22, 10, sideways=rng.normal(0, 2, 3) * [1, 1, 0])
    sec.append((P, t, radius, k))
    # tertiary twigs into the clump
    for _ in range(2):
        j = int(len(P) * rng.uniform(0.55, 0.8))
        g = cen + nrm(rng.normal(size=3) * [1, 1, 0.6]) * rad * 0.7
        branch(P[j], nrm(g - P[j]), g, radius[j] * 0.6, 0.10, 6, ds=1.3)
# a few tertiary twigs from the main limbs into the skirt clumps
for k, c in enumerate(clumps):
    if c[3] != 1:
        continue
    cen, rad = c[0], c[1]
    a = math.atan2(cen[1], cen[0])
    li = int(np.argmin([abs(wrap_ang(a - d["az"])) for d in limb_data]))
    d = limb_data[li]
    dist = np.linalg.norm(d["P"] - cen, axis=1)
    i = int(np.argmin(dist + (d["t"] > 0.9) * 100))
    i = max(3, i - 6)
    g = cen + nrm(rng.normal(size=3) * [1, 1, 0.5]) * rad * 0.6
    branch(d["P"][i], nrm(g - d["P"][i] + UP * 4), g, d["radius"][i] * 0.5, 0.12, 8, ds=1.3)

# ============================================================================= STRANDS + PODS
strands = Acc()
pods = Acc()
# (limb, t centre, t spread, count, desired length range)
# (limb, horizontal distance from trunk axis, spread, count, desired length range)
clusters = [
    (0, 13.5, 1.6, 8, (21, 25)),
    (2, 13.0, 1.4, 7, (19, 24)),
    (4, 14.5, 1.8, 5, (17, 23)),
    (1, 21.0, 1.6, 6, (12, 18)),
    (3, 23.0, 1.4, 4, (11, 16)),
    (5, 35.0, 1.4, 4, (8, 12)),
    (2, 37.0, 1.2, 3, (8, 11)),
    (4, 33.0, 1.2, 3, (9, 13)),
    # second pass: more pods nearer the trunk and mid limbs so the tree glows from every side
    (0, 9.5, 1.0, 4, (20, 24)),
    (2, 9.5, 1.0, 3, (18, 22)),
    (1, 16.5, 1.2, 4, (13, 18)),
    (3, 17.0, 1.0, 3, (12, 16)),
    (5, 28.0, 1.2, 2, (9, 12)),
]
assert sum(c[3] for c in clusters) == 56
strand_info = []
POD_M = 12
POD_RINGS = 12


def strand_clear(attach, L, pod_len, margin=1.6):
    zz = np.linspace(attach[2], attach[2] - L - pod_len, 60)
    th_w = math.atan2(attach[1], attach[0]) - twist(zz)
    rt, _ = trunk_radius(th_w, zz, with_groove=False)
    rt = np.where(zz < TRUNK_TOP + 2, rt, 0)
    return not np.any(np.linalg.norm(attach[:2]) < rt + margin)


for (li, rc, rs, cnt, (l0, l1)) in clusters:
    d = limb_data[li]
    rxy = np.linalg.norm(d["P"][:, :2], axis=1)
    imax = int(np.argmax(rxy))
    for n in range(cnt):
        L_want = rng.uniform(l0, l1)
        # Big glowing fruit: roughly twice the size of the first version so they read from afar.
        D = rng.uniform(1.5, 2.6) * (1.0 if rc < 20 else 0.82)
        pod_len = D * 1.2
        r_try = rc + rng.uniform(-rs, rs)
        side_off = rng.uniform(-0.6, 0.6)
        for attempt in range(8):
            i = int(np.clip(np.searchsorted(rxy[:imax], r_try), 1, imax))
            p, T, rad_ = d["P"][i], d["T"][i], d["radius"][i]
            side = nrm(np.cross(UP, T) + 1e-6)
            attach = p - UP * rad_ * 0.55 + side * side_off * rad_
            L = min(L_want, attach[2] - pod_len - 2.7)
            if L >= 8.0 and strand_clear(attach, L, pod_len):
                break
            r_try += 1.0
            stats["strand_nudges"] = stats.get("strand_nudges", 0) + 1
        L = max(L, 8.0)
        nseg = max(10, int(L / 0.65))
        s = np.linspace(0, 1, nseg)
        a1, a2 = rng.uniform(0.4, 1.4), rng.uniform(0.15, 0.45)
        d1 = nrm(rng.normal(size=3) * [1, 1, 0] * 0.6 + nrm(np.array([attach[0], attach[1], 0])))
        d2 = np.cross(UP, d1)
        ph = rng.uniform(0, 6.28)
        P = attach[None] - UP[None] * (s * L)[:, None] + (a1 * s ** 1.5)[:, None] * d1 + (a2 * np.sin(2 * np.pi * s * 1.3 + ph) * s)[:, None] * d2
        radius = 0.08 + 0.17 * (1 - s) ** 0.6
        M = 6
        X, Dd, phi, rr, (Tt, Nn, Bb) = tube_rings(P, radius, M)
        U = np.repeat((np.arange(M + 1) / M)[None, :], nseg, 0)
        V = np.repeat((1 - s)[:, None], M + 1, 1)
        Cc = (0.72 + 0.28 * s)[:, None, None] * np.ones((nseg, M, 3))
        add_tube(strands, X, U, V, Cc, "strand")
        # ---- pod: lathe along the strand's end tangent
        ax = nrm(P[-1] - P[-2])
        top = P[-1] - ax * 0.15
        sp = np.linspace(0.05, 0.96, POD_RINGS)
        # plump lantern: widest around the middle, rounded at both ends (was a narrow teardrop)
        prof = np.sin(np.pi * sp ** 0.86) ** 0.62
        prof = prof / prof.max() * D / 2
        prof = np.maximum(prof, 0.075)
        Nn0 = nrm(np.cross(ax, d1) + 1e-6)
        Bb0 = np.cross(ax, Nn0)
        phi = np.linspace(0, 2 * np.pi, POD_M, endpoint=False)
        rib = 1 + 0.07 * np.cos(6 * phi)[None, :] * np.sin(np.pi * sp)[:, None]
        rr = prof[:, None] * rib
        ctr = top[None] + ax[None] * (sp * pod_len)[:, None]
        Dp = np.cos(phi)[None, :, None] * Nn0[None, None, :] + np.sin(phi)[None, :, None] * Bb0[None, None, :]
        Xp = ctr[:, None, :] + rr[..., None] * Dp
        # tube faces wind outward when (axis, N, B) is right-handed: B = ax x N
        Up_ = np.repeat((np.arange(POD_M + 1) / POD_M)[None, :], len(sp), 0)
        Vp = np.repeat((1 - sp)[:, None], POD_M + 1, 1)
        b0 = pods.add_verts(Xp, np.ones(3))
        pods.add_faces(grid_faces(b0, len(sp), POD_M), reg_map("pod", grid_uv(Up_, Vp)))
        # poles
        tp = pods.add_verts((top - ax * 0.02)[None], np.ones(3))
        bp = pods.add_verts((top + ax * pod_len)[None], np.ones(3))
        r0i = b0 + np.arange(POD_M)
        rLi = b0 + (len(sp) - 1) * POD_M + np.arange(POD_M)
        pods.add_faces(np.stack([np.roll(r0i, -1), r0i, np.full(POD_M, tp)], 1),
                       reg_map("pod", np.tile([[0.5, 1.0], [0.55, 1.0], [0.52, 1.0]], (POD_M, 1, 1))))
        pods.add_faces(np.stack([rLi, np.roll(rLi, -1), np.full(POD_M, bp)], 1),
                       reg_map("pod", np.tile([[0.5, 0.0], [0.55, 0.0], [0.52, 0.0]], (POD_M, 1, 1))))
        strand_info.append(dict(attach=attach, L=L, D=D, pod_bottom=(top + ax * pod_len)[2], r_from_axis=float(np.linalg.norm(attach[:2]))))

# ============================================================================= BLENDER SCENE
bpy.ops.wm.read_factory_settings(use_empty=True)
img = bpy.data.images.load(ATLAS)
img.name = "veil_atlas"


def make_mat(name, kind):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = 0.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    if kind in ("bark", "leaf"):
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(tex.outputs["Color"], mix.inputs[6])
        nt.links.new(vc.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.92 if kind == "bark" else 0.78
        m.use_backface_culling = kind == "bark"
    if kind == "leaf":
        lt = nt.nodes.new("ShaderNodeMath")
        lt.operation = "LESS_THAN"
        lt.inputs[1].default_value = 0.45
        sub = nt.nodes.new("ShaderNodeMath")
        sub.operation = "SUBTRACT"
        sub.inputs[0].default_value = 1.0
        nt.links.new(tex.outputs["Alpha"], lt.inputs[0])
        nt.links.new(lt.outputs[0], sub.inputs[1])
        nt.links.new(sub.outputs[0], bsdf.inputs["Alpha"])
        try:
            m.surface_render_method = "DITHERED"
        except Exception:
            pass
    if kind == "glow":
        bsdf.inputs["Base Color"].default_value = (0.010, 0.030, 0.045, 1)
        bsdf.inputs["Roughness"].default_value = 0.45
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
        m.use_backface_culling = True
    return m


MAT_BARK = make_mat("Bark", "bark")
MAT_LEAF = make_mat("Leaves", "leaf")
MAT_GLOW = make_mat("Glow", "glow")


def build(name, acc, mat, custom_normals=None):
    V = np.concatenate(acc.V)
    C = np.concatenate(acc.C)
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], acc.F)
    uv = me.uv_layers.new(name="UVMap")
    uvflat = np.concatenate([np.asarray(u, float).reshape(-1, 2) for u in acc.UV])
    assert len(uvflat) == len(me.loops), (len(uvflat), len(me.loops))
    uv.data.foreach_set("uv", uvflat.ravel())
    if mat is not MAT_GLOW:
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        rgba = np.concatenate([np.clip(C, 0, 1), np.ones((len(C), 1))], 1)
        ca.data.foreach_set("color", rgba.ravel())
    me.materials.append(mat)
    me.shade_smooth()
    if custom_normals is not None:
        me.normals_split_custom_set_from_vertices(nrm(custom_normals).tolist())
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


build("Trunk", trunk, MAT_BARK)
build("Limbs", limbs, MAT_BARK)
build("Leaves", leaves, MAT_LEAF, custom_normals=np.concatenate(leaf_normals))
build("Strands", strands, MAT_BARK)
build("Glow_Pods", pods, MAT_GLOW)
build("Glow_Veins", veins, MAT_GLOW)

tri = {n: a.tri_count() for n, a in [("Trunk", trunk), ("Limbs", limbs), ("Leaves", leaves), ("Strands", strands),
                                     ("Glow_Pods", pods), ("Glow_Veins", veins)]}
print("TRIS", tri, "total", sum(tri.values()))
print("overflow by source", stats.get("over_src"), "strand nudges", stats.get("strand_nudges", 0))
print("cards", card_count, "clumps", len(clumps), "uv overflow clamped quads", stats["overflow_clamped"])
sl = sorted(strand_info, key=lambda s: s["r_from_axis"])
print("strands: n=%d  len %.1f-%.1f  pod D %.2f-%.2f  min pod bottom z %.2f" % (
    len(sl), min(s["L"] for s in sl), max(s["L"] for s in sl), min(s["D"] for s in sl), max(s["D"] for s in sl),
    min(s["pod_bottom"] for s in sl)))
for s_ in sl[::5]:
    print("   r=%.1f  L=%.1f  pod_bottom=%.1f" % (s_["r_from_axis"], s_["L"], s_["pod_bottom"]))

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", export_yup=True, export_apply=False,
    export_lights=False, export_cameras=False, export_vertex_color="MATERIAL",
    export_normals=True, export_tangents=False, export_texcoords=True,
    export_image_format="AUTO", export_materials="EXPORT", export_extras=False)
print("EXPORTED", OUT)
