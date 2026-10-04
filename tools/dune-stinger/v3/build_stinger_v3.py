#!/usr/bin/env python3
"""Dune Stinger v3 — a scorpion-like desert predator, built procedurally in Blender (metres, no external assets).

What it is: a heavy ridged carapace with a raised eye mound (two big median eyes and three on each cheek), brow horns and small jaws; six
overlapping abdomen plates over a glowing seam; four pairs of three-part legs with ball knees, spiked shins and clawed feet; two jointed
pincers (the left is the bigger) whose movable finger opens and closes; a five-segment tail ending in a venom bulb and a lancet. Cyan glow
seams run round the tail joints, along the flanks and in the eyes and sting. Rust-brown chitin, pale bone edges.

Skeleton (55 joints, every rest rotation identity so a bone rotation is a rotation about the creature's own axes):
  Root > Body > Head > Mandible_L/R                      the shield, the eye turret, the jaws
  Body > Seg01 > ... > Seg06 > Tail1 > ... > Tail5 > Stinger    the abdomen plates and the tail
  Body > Leg{1-4}_{L,R}_Thigh > _Shin > _Foot > _Toe       the toe is a leaf joint at the claw tip, on the ground (y = 0)
  Body > Claw_{L,R}_Arm > _Fore > _Finger                 the shoulder, the elbow, the movable finger

Usage (needs bpy 4.5, numpy, Pillow, trimesh):  python3 build_stinger_v3.py --out-dir OUT [--lod 0|1|2] [--no-render] [--no-audit]
Triangle ceilings per level are BUDGET (the owner, 4 Oct: the close-up level may go up to about 50,000; build rich, cut down).
"""
import argparse, json, math, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'creature'))
import kit  # noqa: E402  (imports bpy first)
from kit import Geo, sweep, spike, ball, lerp, tint, mix, sstep, sgnpow, gauss, bumps, PI, TAU  # noqa: E402
from mathutils import Vector  # noqa: E402

V = lambda x, y, z: Vector((x, y, z))
BUDGET = [50000, 12000, 3000]
SIDES = [(1, 'L'), (-1, 'R')]

# Linear colours: dark chitin, rust plate, tan ridge, pale bone, charcoal joints.
CHITIN = (.045, .022, .013); PLATE = (.150, .060, .024); RUST = (.26, .075, .026); SAND = (.34, .18, .07)
RIDGE = (.40, .22, .09); EDGE = (.62, .40, .17); BONE = (.80, .60, .34); DARK = (.022, .016, .013); WHITE = (1, 1, 1)

# ----------------------------------------------------------------------------------------------------------------- layout
HIP_X = [.125, .165, .200, .225]
HIP_Z = [.255, .135, .015, -.105]
TOE_Z = [.46, .24, -.08, -.36]
REACH = [.86, .95, 1.0, .95]
SEG_Z = [-.115 - .0875 * i for i in range(6)]      # the front edge of each abdomen plate
PLATE_LEN = .108
TAIL_BASE = V(0, .310, -.655)
TAIL_LEN = [.34, .34, .33, .32, .30]
TAIL_ANG = [38, 8, -22, -52, -82]                   # degrees from vertical, positive leans back
TELSON_LEN = .38
TAIL_R = [.092, .085, .078, .071, .064]
CLAW_SIZE = {1: 1.45, -1: 1.2}                       # the left pincer is the bigger


def tail_points():
    p = [TAIL_BASE]
    for L, a in zip(TAIL_LEN, TAIL_ANG):
        a = math.radians(a); p.append(p[-1] + V(0, math.cos(a), -math.sin(a)) * L)
    return p


TAIL = tail_points()


def leg_joints(i, side):
    hz, tz, o = HIP_Z[i], TOE_Z[i], REACH[i]; d = tz - hz
    hip = V(side * HIP_X[i], .255, hz)
    knee = hip + V(side * .165 * o, .160, d * .30)
    ankle = knee + V(side * .200 * o, -.285, d * .45)
    toe = V(ankle.x + side * .045 * o, 0.0, tz)
    return hip, knee, ankle, toe


def claw_frame(side):
    cs = CLAW_SIZE[side]
    S = V(side * .175, .270, .300)
    E = S + V(side * .125, .010, .105)
    Wr = E + V(-side * .045, -.005, .125)
    a = V(-side * .030, 0, .100).normalized()
    l = V(side * a.z, 0, -side * a.x)             # outward, across the claw
    Pend = Wr + V(-side * .028 * cs, 0, .100 * cs)
    return dict(S=S, E=E, W=Wr, P=Pend, a=a, l=l, cs=cs)


def bones_table():
    B = [('Root', (0, 0, 0), None), ('Body', (0, .29, .05), 'Root'), ('Head', (0, .30, .20), 'Body')]
    for s, sd in SIDES: B.append((f'Mandible_{sd}', (s * .045, .225, .32), 'Head'))
    prev = 'Body'
    for i in range(6):
        B.append((f'Seg{i+1:02d}', (0, .31, SEG_Z[i]), prev)); prev = f'Seg{i+1:02d}'
    for k in range(5): B.append((f'Tail{k+1}', tuple(TAIL[k]), 'Seg06' if k == 0 else f'Tail{k}'))
    B.append(('Stinger', tuple(TAIL[5]), 'Tail5'))
    for side, sd in SIDES:
        for i in range(4):
            hip, knee, ankle, toe = leg_joints(i, side); n = f'Leg{i+1}_{sd}'
            B += [(n + '_Thigh', tuple(hip), 'Body'), (n + '_Shin', tuple(knee), n + '_Thigh'), (n + '_Foot', tuple(ankle), n + '_Shin'), (n + '_Toe', tuple(toe), n + '_Foot')]
        c = claw_frame(side); n = f'Claw_{sd}'
        q = c['P'] + c['l'] * (.026 * c['cs'])
        B += [(n + '_Arm', tuple(c['S']), 'Body'), (n + '_Fore', tuple(c['E']), n + '_Arm'), (n + '_Finger', tuple(q), n + '_Fore')]
    return B


def w2(a, b, t):
    """Weights for a blend of two bones; t = 0 is all a."""
    if t <= 1e-4: return {a: 1.0}
    if t >= 1 - 1e-4: return {b: 1.0}
    return {a: 1 - t, b: t}


# ----------------------------------------------------------------------------------------------------------------- the shield
_SHIELD = {}


def shield_w(z):
    rings = _SHIELD['rings']
    for a, b in zip(rings, rings[1:]):
        if a['z'] <= z <= b['z']:
            t = (z - a['z']) / (b['z'] - a['z']); return lerp(a['W'], b['W'], t), lerp(a['yc'], b['yc'], t)
    r = rings[0] if z < rings[0]['z'] else rings[-1]
    return r['W'], r['yc']


def shield_y(x, z):
    """Height of the shield's upper surface at (x, z), read from the rings that were built (so eyes sit on it)."""
    rings = _SHIELD['rings']
    zs = [r['z'] for r in rings]
    k = max(0, min(len(rings) - 2, max(i for i, zz in enumerate(zs) if zz <= z) if z >= zs[0] else 0))
    a, b = rings[k], rings[k + 1]; t = 0 if b['z'] == a['z'] else max(0, min(1, (z - a['z']) / (b['z'] - a['z'])))

    def at(r):
        pts = sorted((p for p in r['pts'] if p[2] >= 0), key=lambda p: p[0])
        for (x0, y0, _), (x1, y1, _) in zip(pts, pts[1:]):
            if x0 <= x <= x1: return lerp(y0, y1, (x - x0) / max(1e-9, x1 - x0))
        return pts[0][1] if x < pts[0][0] else pts[-1][1]
    return lerp(at(a), at(b), t)


def carapace(g, L):
    nR = (36, 18, 9)[L]; n = (56, 28, 12)[L]
    z0, z1 = -.13, .365
    rings = []; cols = []; wts = []; store = []
    for k in range(nR):
        t = k / (nR - 1); z = lerp(z0, z1, t)
        W = lerp(.268, .138, sstep(.08, .88, t))
        top = .455 - .075 * sstep(.30, 1.0, t)
        floor = .200 + .016 * t
        nose = 1.0
        if t > .86:
            u = (t - .86) / .14; nose = max(.22, math.sqrt(max(0.0, 1 - u * u)))
        W *= nose; top = lerp(floor + .05, top, .45 + .55 * nose)
        yc = (top + floor) / 2; Hh = (top - floor) / 2
        wh = sstep(.14, .30, z)
        ring = []; spts = []
        for j in range(n):
            th = TAU * j / n; c, s = math.cos(th), math.sin(th)
            x = W * sgnpow(c, .8) * (1 + .07 * gauss(s, .22))
            y = yc + Hh * sgnpow(s, .8) * (1 if s >= 0 else .55)
            if s > 0:
                ridge = .034 * gauss(x, .28 * W) * (.4 + .6 * sstep(0, .2, t)) + .016 * gauss(abs(x) - .60 * W, .13 * W)
                ridge += .075 * gauss(z - .215, .08) * gauss(x, .095)
                y += ridge * s ** .5
            rel = abs(x) / max(W, 1e-6)
            if s <= 0.05: col = DARK
            else:
                col = mix(PLATE, CHITIN, .35 + .35 * sstep(.3, 1.0, t))
                col = mix(col, RIDGE, min(1, (gauss(x, .20 * W) * .85 + .7 * gauss(abs(x) - .60 * W, .09 * W)) * (.3 + .7 * s)))
                if rel > .86: col = mix(col, RIDGE, .6 * sstep(.86, .98, rel))
                if t > .955 or t < .02: col = mix(col, RIDGE, .5)
            ring.append((x, y, z)); cols.append(col); wts.append(w2('Body', 'Head', wh))
            spts.append((x, y, s))
        rings.append(ring); store.append({'z': z, 'pts': spts, 'W': W, 'yc': yc})
    _SHIELD['rings'] = store
    g.rings('shield', rings, wts, cols)
    if L >= 2: return
    # pauldrons: a spike over each leg's hip, sweeping out and back
    for i in range(4):
        z = HIP_Z[i] + .025; Wz, yc = shield_w(z); wz = sstep(.14, .30, z)
        for s in (-1, 1):
            spike(g, 'pauldron', V(s * Wz * .90, yc + .012, z), V(s * (Wz + .074 - .006 * i), yc + .050, z - .040), .030, .022,
                  {'Head': 1} if wz > .5 else {'Body': 1}, mix(PLATE, RIDGE, .6), 6 if L == 0 else 4, lift=(s * .006, .012, 0), up=(0, 1, 0))
    if L == 0:
        # rows of tubercles along the shield's ridges: the median ridge and the two lateral keels
        for q in range(7):
            z = lerp(-.10, .17, q / 6); Wz, yc = shield_w(z); yy = shield_y(0, z)
            spike(g, 'tubercle', V(0, yy - .004, z), V(0, yy + .026 - .002 * q, z - .012), .011, .009, {'Body': 1} if z < .17 else {'Head': 1}, mix(RIDGE, BONE, .4), 4, up=(1, 0, 0))
        for q in range(8):
            z = lerp(-.11, .22, q / 7); Wz, yc = shield_w(z)
            for s in (-1, 1):
                xx = s * Wz * .60; yy = shield_y(xx, z)
                spike(g, 'tubercle', V(xx, yy - .004, z), V(xx + s * .004, yy + .022, z - .010), .009, .008, {'Body': 1} if z < .17 else {'Head': 1}, mix(RIDGE, BONE, .3), 4, up=(1, 0, 0))


def face(g, L):
    """Eyes (the glow), their dark sockets, brow ridges, horns and the jaws."""
    head = {'Head': 1}
    for s in (-1, 1):
        p = V(s * .040, shield_y(s * .040, .220) + .006, .222)
        if L < 2:
            sweep(g, 'median_socket', [p + V(0, -.014, 0), p + V(0, .006, 0)], [(.044, .040), (.041, .037)], (16, 8)[L], head, CHITIN, up=(0, 0, 1))
        ball(g, 'median_eye', p + V(0, .010, .002), .031, head, WHITE, n=(14, 8, 6)[L], rings=(8, 6, 4)[L], material=1)
        for q, (r, zz, xx) in enumerate([(.019, .262, .114), (.0155, .292, .102), (.0125, .318, .088)][:(3 if L < 2 else 1)]):
            e = V(s * xx, shield_y(s * xx, zz) + .002, zz)
            if L < 2:
                sweep(g, 'cheek_socket', [e + V(0, -.012, 0), e + V(0, .005, 0)], [(r + .008, r + .007), (r + .006, r + .005)], 10 if L == 0 else 6, head, CHITIN, up=(0, 0, 1))
            ball(g, 'cheek_eye', e + V(0, .005, .001), r, head, WHITE, n=(12, 7, 5)[L], rings=(7, 5, 4)[L], material=1)
    if L >= 2: return
    for s in (-1, 1):
        # brow ridge over the cheek eyes and a forward horn
        b0 = V(s * .060, shield_y(s * .060, .225) + .008, .225); b1 = V(s * .112, shield_y(s * .112, .285) + .012, .285); b2 = V(s * .120, shield_y(s * .104, .336) + .006, .338)
        sweep(g, 'brow', [b0, b0.lerp(b1, .5) + V(0, .008, 0), b1, b2], [(.015, .010), (.017, .011), (.014, .009), (.005, .004)], (8, 5)[L], head,
              lambda k, j, n: EDGE if k < 3 else BONE, up=(0, 0, 1))
        yh = shield_y(s * .060, .335)
        spike(g, 'horn', V(s * .060, yh - .008, .336), V(s * .074, yh + .018, .486), .026, .022, head, BONE, (7, 5)[L], lift=(0, .034, .0), up=(1, 0, 0))
        b = 'Mandible_' + ('L' if s > 0 else 'R')
        pts = [V(s * .050, .236, .318), V(s * .072, .210, .392), V(s * .062, .192, .452), V(s * .034, .188, .496)]
        rr = [(.032, .027), (.030, .024), (.020, .015), (.002, .0025)]
        if L == 1: pts = [pts[0], pts[1], pts[3]]; rr = [rr[0], rr[1], rr[3]]
        sweep(g, 'jaw', pts, rr, (10, 6)[L], {b: 1}, lambda k, j, n: BONE if k >= 1 and math.cos(TAU * j / n) > 0 else tint(EDGE, .8))
        if L == 0:
            for q in range(3):
                base = pts[1].lerp(pts[3], .22 + .22 * q) + V(-s * .014, -.004, 0)
                spike(g, 'tooth', base, base + V(-s * .030, -.004, .010), .008, .007, {b: 1}, DARK, 4)
    # a short blunt rostrum between the horns
    yr = shield_y(0, .345)
    spike(g, 'rostrum', V(0, yr - .010, .335), V(0, yr + .004, .420), .026, .020, head, EDGE, (6, 4)[L], up=(1, 0, 0))


# ----------------------------------------------------------------------------------------------------------------- the abdomen
PLATE_PROFILE = [(0, .74, .50), (.08, .88, .70), (.2, .97, .90), (.35, 1.02, 1.0), (.5, 1.04, 1.05), (.65, 1.03, 1.05), (.8, 1.0, 1.0), (.9, .97, .98), (.965, .94, .92), (1.0, .88, .70)]


def plate(g, i, L):
    name = f'Seg{i+1:02d}'; wt = {name: 1}
    zf = SEG_Z[i]
    prof = [PLATE_PROFILE[k] for k in ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 2, 4, 6, 8, 9], [0, 4, 9])[L]]
    n = (48, 24, 10)[L]
    Wm = lerp(.262, .142, i / 5); crown = .440 - .014 * i; floor = .195
    rings = []; cols = []
    for (u, ws, hs) in prof:
        z = zf - u * PLATE_LEN
        W = Wm * ws; top = floor + (crown - floor) * hs; yc = (top + floor) / 2; Hh = (top - floor) / 2
        ring = []
        for j in range(n):
            th = TAU * j / n; c, s = math.cos(th), math.sin(th)
            x = W * sgnpow(c, .74) * (1 + .05 * gauss(s, .2)); y = yc + Hh * sgnpow(s, .74) * (1 if s >= 0 else .6)
            if s > 0: y += (.026 * gauss(x, .15 * W) + .012 * gauss(abs(x) - .58 * W, .12 * W)) * hs * s ** .5
            rel = abs(x) / W
            if s <= .05: col = DARK
            else:
                col = mix(CHITIN, PLATE, sstep(.15, .6, u))
                col = mix(col, RIDGE, min(1, (gauss(x, .14 * W) + .6 * gauss(abs(x) - .58 * W, .09 * W)) * .75 * (.3 + .7 * s)))
                if u > .88: col = mix(col, RIDGE, .8 * sstep(.88, .96, u))
                if rel > .88: col = mix(col, SAND, .35)
            ring.append((x, y, z)); cols.append(col)
        rings.append(ring)
    g.rings('plate_' + name, rings, wt, cols)
    if L >= 2: return
    zmid = zf - .52 * PLATE_LEN; topmid = floor + (crown - floor) * 1.05 + .026
    spike(g, 'keel_' + name, V(0, topmid - .016, zmid + .014), V(0, topmid + .060, zmid - .040), .020, .011, wt, EDGE, 5 if L == 0 else 4, lift=(0, .008, 0))
    for s in (-1, 1):
        for fz in (.30, .72):
            if L == 0:
                zt = zf - fz * PLATE_LEN; xt = s * Wm * .58 * 1.03
                spike(g, 'tubercle_' + name, V(xt, floor + (crown - floor) * 1.02 + .012, zt), V(xt, floor + (crown - floor) * 1.02 + .040, zt - .012), .010, .009, wt, mix(RIDGE, BONE, .3), 4)
        zr = zf - .93 * PLATE_LEN; xr = Wm * .94
        spike(g, 'spine_' + name, V(s * xr, .33, zr + .014), V(s * (xr + .040), .362, zr - .060), .016, .011, wt, mix(PLATE, EDGE, .5), 4, lift=(s * .005, .010, 0))
        zc = zf - .5 * PLATE_LEN
        sweep(g, 'flank_glow', [V(s * Wm * 1.03, .315, zc + .030), V(s * Wm * 1.03, .315, zc - .030)], [(.0075, .0075), (.0075, .0075)], (7, 5)[L], wt, WHITE, 1, up=(0, 1, 0))


def seg_weights(z):
    if z > -.115: return {'Body': .5, 'Seg01': .5}
    f = (-z - .115) / .0875
    i = min(5, int(f)); fr = f - i
    return w2(f'Seg{i+1:02d}', f'Seg{i+2:02d}', fr) if i < 5 else {'Seg06': 1.0}


def dermis(g, L):
    """The soft sleeve under the plates; it glows, so where the plates part the light shows, and a bend never opens a gap."""
    ks = list(range(7)) if L < 2 else [0, 3, 6]
    pts = []; rr = []; ww = []
    for k in ks:
        z = lerp(-.10, -.665, k / 6)
        pts.append(V(0, .310, z)); wi = lerp(.262, .142, min(1, max(0, (-z - .115) / .44)))
        rr.append((wi * .74, .056 * lerp(1, .8, k / 6))); ww.append(seg_weights(z))
    sweep(g, 'dermis', pts, rr, (16, 10, 6)[L], ww, WHITE, 1, up=(1, 0, 0))


# ----------------------------------------------------------------------------------------------------------------- the tail
def tail(g, L):
    K = (9, 5, 3)[L]; n = (22, 12, 6)[L]
    for k in range(5):
        a, b = TAIL[k], TAIL[k + 1]; bn = f'Tail{k+1}'; r = TAIL_R[k]; wt = {bn: 1}
        fr = [i / (K - 1) for i in range(K)]
        pts = [a.lerp(b, f) for f in fr]
        if K == 9: prof = [.80, .92, .98, 1.0, 1.0, .97, .94, 1.0, 1.07]
        else: prof = [.82 + .18 * math.sin(PI * f) + (.08 if f > .9 else 0) for f in fr]
        pts[0] = pts[0] + (a - b).normalized() * .008
        pts[-1] = pts[-1] + (b - a).normalized() * .004

        def shape(kk, j, th):
            sq = 1 / (abs(math.cos(th)) ** 3 + abs(math.sin(th)) ** 3) ** (1 / 3)
            return sq * bumps(th, 4, PI / 4, .26, .10)

        def colr(kk, j, nn, k=k, npts=len(pts)):
            th = TAU * j / nn; dorsal = math.sin(th)
            col = mix(PLATE, CHITIN, .15 * k) if dorsal > -.3 else mix(CHITIN, DARK, .6)
            kb = max(bumps(th, 4, PI / 4, .26, 1) - 1, 0)
            col = mix(col, RIDGE, min(1, kb * .8))
            if kk >= npts - 2: col = mix(col, RIDGE, .6)
            if kk == 0: col = mix(col, DARK, .6)
            return col
        sweep(g, 'tail_' + bn, pts, [(r * f, r * f) for f in prof], n, wt, colr, shape=shape, up=(1, 0, 0))
        t = (b - a).normalized()
        if L < 2:
            # the glowing seam round the joint
            sweep(g, 'seam_' + bn, [b - t * .012, b + t * .010], [(r * .93, r * .93), (r * .93, r * .93)], (24, 12)[L], {f'Tail{k+2}' if k < 4 else 'Stinger': 1}, WHITE, 1, up=(1, 0, 0))
            if L == 0:
                dors = V(0, t.z, -t.y).normalized()
                for fz in (.34, .70):
                    c0 = a.lerp(b, fz)
                    spike(g, 'tail_spine', c0 + dors * (r * .92), c0 + dors * (r * .92 + .044) + t * .014, .013, .010, wt, BONE, 4, up=(1, 0, 0))
    # the soft core through all five joints
    cp = [TAIL[0] + (TAIL[0] - TAIL[1]).normalized() * .01]; cr = [TAIL_R[0] * .72]; cw = [{'Seg06': .5, 'Tail1': .5}]
    for k in range(1, 5):
        cp.append(TAIL[k]); cr.append(TAIL_R[k] * .70); cw.append({f'Tail{k}': .5, f'Tail{k+1}': .5})
    cp.append(TAIL[5]); cr.append(TAIL_R[4] * .62); cw.append({'Tail5': .5, 'Stinger': .5})
    sweep(g, 'tail_core', cp, [(r, r) for r in cr], (10, 6, 4)[L], cw, DARK, up=(1, 0, 0))
    telson(g, L)


def telson(g, L):
    wt = {'Stinger': 1}
    base = TAIL[5]; K = (11, 7, 4)[L]
    pts = [base]; ang = []
    for i in range(1, K):
        u = i / (K - 1); a = math.radians(-100 - 62 * u); ang.append(a)
        pts.append(pts[-1] + V(0, math.cos(a), -math.sin(a)) * (TELSON_LEN / (K - 1)))
    rad = []
    for i in range(K):
        u = i / (K - 1)
        if u < .35: rad.append(.060 + .030 * math.sin(PI / 2 * u / .35))
        else: rad.append(max(.0014, .090 * (1 - (u - .35) / .65) ** 1.1))
    rad[0] = .060
    sweep(g, 'telson', pts, [(r, r * .92) for r in rad], (18, 10, 6)[L], wt, lambda k, j, n: PLATE if k < K * .38 else mix(BONE, DARK, sstep(.55, 1.0, k / (K - 1))), up=(1, 0, 0))
    if L < 2:
        seam = []; srad = []
        for i in range(2, K - 1):
            p = pts[i]; a = ang[i - 1]; out = V(0, math.sin(a), math.cos(a)) * (rad[i] * .80)
            seam.append(p + out); srad.append((.0095 if i < K - 3 else .005,) * 2)
        sweep(g, 'venom_glow', seam, srad, (8, 5)[L], wt, WHITE, 1, up=(1, 0, 0))
        ball(g, 'venom_bead', pts[1] + V(0, .024, -.052), .022, wt, WHITE, n=(10, 6)[L], rings=(6, 5)[L], material=1)


# ----------------------------------------------------------------------------------------------------------------- legs
def leg(g, i, side, L):
    sd = 'L' if side > 0 else 'R'; n = f'Leg{i+1}_{sd}'
    th, sh, ft = n + '_Thigh', n + '_Shin', n + '_Foot'
    hip, knee, ankle, toe = leg_joints(i, side)
    K = (10, 6, 3)[L]; ns = (14, 8, 5)[L]
    start = hip + V(-side * .040, -.005, 0)
    fr = [q / (K - 1) for q in range(K)]
    pts = [start.lerp(knee, f) for f in fr]
    prof = [1.0 + .16 * math.sin(PI * f) - .20 * f for f in fr]
    r0 = .052

    def shape(k, j, thh): return bumps(thh, 2, 0, .35, .10)

    def colr(k, j, nn):
        top = math.cos(TAU * j / nn)
        c = mix(PLATE, CHITIN, .3) if top > -.2 else DARK
        if top > .6: c = mix(c, RIDGE, .55)
        if k >= len(pts) - 2: c = mix(c, RIDGE, .6)
        return c
    sweep(g, 'thigh_' + n, pts, [(r0 * f, r0 * .86 * f) for f in prof], ns, {th: 1}, colr, shape=shape if L == 0 else None, up=(0, 1, 0))
    if L < 2: ball(g, 'coxa_' + n, hip + V(-side * .01, 0, 0), .056, {th: 1}, mix(PLATE, CHITIN, .4), n=(14, 8)[L], rings=(8, 5)[L])
    if L < 2: ball(g, 'knee_' + n, knee, .050, {th: .5, sh: .5}, mix(PLATE, RIDGE, .55), n=(14, 8)[L], rings=(8, 6)[L])
    K2 = (11, 6, 3)[L]
    fr2 = [q / (K2 - 1) for q in range(K2)]
    pts2 = [knee.lerp(ankle, f) for f in fr2]
    prof2 = [lerp(1.0, .52, f) + .12 * math.sin(PI * f) for f in fr2]

    def colr2(k, j, nn):
        top = math.cos(TAU * j / nn)
        c = mix(RUST, CHITIN, .5) if top > -.1 else DARK
        if top > .55: c = mix(c, RIDGE, .45)
        if k == 0: c = mix(c, RIDGE, .5)
        return c
    sweep(g, 'shin_' + n, pts2, [(.046 * f, .038 * f) for f in prof2], ns, {sh: 1}, colr2, shape=shape if L == 0 else None, up=(0, 1, 0))
    if L < 2: ball(g, 'ankle_' + n, ankle, .026, {sh: .5, ft: .5}, DARK, n=(10, 6)[L], rings=(6, 5)[L])
    K3 = (8, 5, 3)[L]
    mid = ankle.lerp(toe, .55) + V(side * .010, .016, 0)
    ctrl = [ankle, mid, toe]
    pts3 = []
    for q in range(K3):
        f = q / (K3 - 1)
        pts3.append(ctrl[0] * (1 - f) ** 2 + ctrl[1] * 2 * f * (1 - f) + ctrl[2] * f * f)
    rr3 = [(.024 * (1 - .78 * q / (K3 - 1)) + .0012, .020 * (1 - .78 * q / (K3 - 1)) + .0012) for q in range(K3)]
    sweep(g, 'foot_' + n, pts3, rr3, (10, 6, 4)[L], {ft: 1}, lambda k, j, nn: mix(CHITIN, DARK, sstep(.3, .9, k / (K3 - 1))), up=(0, 1, 0))
    if L == 0:
        spike(g, 'knee_spike', knee + V(side * .004, .036, 0), knee + V(side * .018, .118, i * -.003), .022, .019, {th: .5, sh: .5}, BONE, 5, lift=(0, .008, 0))
        for f in (.30, .62):
            q = knee.lerp(ankle, f); out = V(side * .040, .030, .014 if i < 2 else -.014)
            spike(g, 'shin_spike', q + V(0, .018, 0), q + V(0, .018, 0) + out, .012, .010, {sh: 1}, EDGE, 4)
        spike(g, 'dewclaw', ankle + V(side * .008, -.004, 0), ankle + V(side * .048, .034, -.026 if i < 2 else .026), .011, .009, {ft: 1}, DARK, 4)
    # the very tip sits exactly on y = 0
    for part in g.parts:
        if part['name'] == 'foot_' + n:
            a, b = part['vertices']; nn_ = (10, 6, 4)[L]
            tip = range(b - nn_, b)
            minz = min(g.v[j][1] for j in tip)
            for j in tip:
                x, y, z = g.v[j]; g.v[j] = (x, y - minz, z)


# ----------------------------------------------------------------------------------------------------------------- the pincers
FIXED_FINGER = [(0.000, -.010), (.040, -.011), (.080, -.004), (.115, .005), (.145, .012)]
MOVABLE_FINGER = [(0.000, .026), (.040, .031), (.080, .034), (.115, .032), (.145, .026)]


def claw(g, side, L):
    sd = 'L' if side > 0 else 'R'; n = f'Claw_{sd}'
    arm, fore, fing = n + '_Arm', n + '_Fore', n + '_Finger'
    c = claw_frame(side); cs = c['cs']; S, E, Wr, P, a, l = c['S'], c['E'], c['W'], c['P'], c['a'], c['l']
    ns = (14, 8, 5)[L]
    if L < 2: ball(g, 'shoulder_' + n, S, .060, {arm: 1}, mix(PLATE, CHITIN, .45), n=(14, 8)[L], rings=(8, 5)[L])
    K = (8, 5, 3)[L]
    fr = [q / (K - 1) for q in range(K)]
    pts = [(S + V(-side * .03, 0, -.02)).lerp(E, f) for f in fr]
    sweep(g, 'arm_' + n, pts, [(.040 * (1 - .10 * f), .047 * (1 - .10 * f)) for f in fr], ns, {arm: 1},
          lambda k, j, nn: mix(PLATE, CHITIN, .3) if math.cos(TAU * j / nn) > -.2 else DARK, shape=(lambda k, j, th: bumps(th, 2, 0, .35, .1)) if L == 0 else None, up=(0, 1, 0))
    if L < 2: ball(g, 'elbow_' + n, E, .052 * (1.0 + .1 * (cs - 1)), {arm: .5, fore: .5}, mix(PLATE, RIDGE, .55), n=(14, 8)[L], rings=(8, 6)[L])
    K2 = (8, 5, 3)[L]; fr2 = [q / (K2 - 1) for q in range(K2)]
    pts2 = [E.lerp(Wr, f) for f in fr2]
    sweep(g, 'forearm_' + n, pts2, [(.037 * lerp(1.0, 1.18, f), .043 * lerp(1.0, 1.35 * (1 + .1 * (cs - 1)), f)) for f in fr2], ns, {fore: 1},
          lambda k, j, nn: (mix(PLATE, CHITIN, .25) if math.cos(TAU * j / nn) > -.2 else DARK) if k < K2 - 1 else EDGE, up=(0, 1, 0))
    K3 = (9, 5, 3)[L]; fr3 = [q / (K3 - 1) for q in range(K3)]
    pal = [Wr.lerp(P, f) + V(0, .005 * math.sin(PI * f), 0) for f in fr3]
    prof = [.92 + .22 * math.sin(PI * min(1, f / .65)) if f < .65 else lerp(1.14, .78, (f - .65) / .35) for f in fr3]
    sweep(g, 'palm_' + n, pal, [(.040 * cs * f, .054 * cs * f) for f in prof], (18, 10, 6)[L], {fore: 1},
          lambda k, j, nn: (mix(PLATE, RIDGE, .25 + .35 * max(0, math.cos(TAU * j / nn))) if math.cos(TAU * j / nn) > -.15 else DARK), up=(0, 1, 0),
          shape=(lambda k, j, th: bumps(th, 2, 0, .30, .12)) if L == 0 else None)
    Q = P + l * (.026 * cs)

    def at(along, lat, up=0.0): return P + a * (along * cs) + l * (lat * cs) + V(0, up, 0)
    fx = list(FIXED_FINGER); mv = list(MOVABLE_FINGER)
    if L == 1: fx = [fx[0], fx[2], fx[4]]; mv = [mv[0], mv[2], mv[4]]
    if L == 2: fx = [fx[0], fx[4]]; mv = [mv[0], mv[4]]
    nf = len(fx)

    def finger(name, spec, bone, toward):
        fpts = [at(*p) for p in spec]
        rad = [(.026 * cs * (1 - .90 * q / (nf - 1)) + .0015, .018 * cs * (1 - .93 * q / (nf - 1)) + .0015) for q in range(nf)]
        sweep(g, name + '_' + n, fpts, rad, (10, 6, 4)[L], {bone: 1}, lambda k, j, nn: mix(EDGE, BONE, k / max(1, nf - 1)) if math.cos(TAU * j / nn) > -.3 else mix(BONE, DARK, .5), up=(0, 1, 0))
        if L == 0:
            for q in range(1, 5):
                f = q / 5.4; i0 = min(nf - 2, int(f * (nf - 1)))
                p0 = fpts[i0].lerp(fpts[i0 + 1], f * (nf - 1) - i0)
                d = l * toward
                spike(g, 'tooth', p0 + d * (.010 * cs), p0 + d * (.024 * cs) + a * (.010 * cs), .0075 * cs, .006 * cs, {bone: 1}, tint(BONE, .85), 4)
    finger('finger_fixed', fx, fore, +1)
    finger('finger_move', mv, fing, -1)
    if L < 2:
        ball(g, 'hinge_' + n, Q, .026 * cs, {fing: .5, fore: .5}, mix(PLATE, RIDGE, .55), n=(10, 6)[L], rings=(6, 5)[L])
    if L == 0:
        spike(g, 'palm_spike', Wr.lerp(P, .5) + V(0, .040 * cs, 0), Wr.lerp(P, .5) + V(0, .040 * cs, 0) + V(-side * .008, .060 * cs, -.014), .020 * cs, .017 * cs, {fore: 1}, BONE, 5)
        for f in (.35, .7):
            q = E.lerp(Wr, f)
            spike(g, 'fore_spike', q + V(0, .026, 0), q + V(side * .022, .066, -.010), .014, .011, {fore: 1}, EDGE, 4)
        spike(g, 'arm_spike', S.lerp(E, .6) + V(0, .030, 0), S.lerp(E, .6) + V(side * .018, .076, -.012), .017, .014, {arm: 1}, EDGE, 4)


# ----------------------------------------------------------------------------------------------------------------- assembly
def build_geo(lod):
    g = Geo()
    carapace(g, lod); face(g, lod); dermis(g, lod)
    for i in range(6): plate(g, i, lod)
    tail(g, lod)
    for side, _ in SIDES:
        for i in range(4): leg(g, i, side, lod)
        claw(g, side, lod)
    return g


def scene_model(lod):
    g = build_geo(lod)
    obj, rig = kit.build_scene(bones_table(), g, kit.default_materials, 'DuneStingerSkeleton', 'DuneStinger')
    return obj, rig, g


def write_report(out, results):
    same = all(r['skeleton'] == results[0]['skeleton'] for r in results)
    (out / 'measured_checks.json').write_text(json.dumps({'same_skeleton': same, 'levels': results}, indent=2))
    lines = ['# Dune Stinger v3 — measured export report', '', '| LOD | Triangles | Bytes | Bones | Closed shells | Dimensions X / Y / Z (m) | Failures |', '|---|---:|---:|---:|---:|---|---|']
    for r in results:
        lines.append(f"| {r['lod']} | {r['triangles']:,} | {r['file_bytes']:,} | {r['bones']} | {r['closed_shells']} | " + ' / '.join(f'{v:.3f}' for v in r['dimensions_xyz']) + f" | {', '.join(r['failures']) or 'none'} |")
    lines += ['', f'Identical names, hierarchy and joint positions across levels: **{same}**.', '',
              'Checked on the exported files: every shell closed and outward wound, no coplanar overlaps, at most four weights per vertex summing to 1, identity joint frames, bind matrices, +Z forward / +Y up / left = +X, lowest vertex at y = 0, one mesh, one skin, two materials (Stinger with vertex colour, Glow without), no animation, UVs or textures.']
    (out / 'report.md').write_text('\n'.join(lines) + '\n')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out-dir', required=True); ap.add_argument('--lod', type=int, choices=[0, 1, 2]); ap.add_argument('--no-render', action='store_true'); ap.add_argument('--no-audit', action='store_true')
    ap.add_argument('--views', default='all')
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else None)
    out = Path(args.out_dir).resolve(); out.mkdir(parents=True, exist_ok=True)
    levels = [args.lod] if args.lod is not None else [0, 1, 2]
    results = []
    for lod in levels:
        obj, rig, g = scene_model(lod); path = out / f'dune_stinger_lod{lod}.glb'; kit.export_glb(path)
        print('BUILT', lod, len(g.f), path.stat().st_size, flush=True)
        (out / f'parts_lod{lod}.json').write_text(json.dumps(g.parts, indent=1))
        if not args.no_audit:
            result = kit.audit(path, lod, BUDGET); results.append(result); print('AUDIT', lod, result['failures'], flush=True)
        if not args.no_render:
            cam = kit.render_setup(int(os.environ.get('RES_X', 1000)), 24)
            views = [v for v in args.views.split(',')] if args.views != 'all' else ['tq', 'side', 'front', 'top', 'close']
            if 'tq' in views: kit.render_view(cam, out / f'lod{lod}_three_quarter.png', (1.9, 1.5, 2.5), (0, .38, .1), 2.3)
            if lod == 0:
                if 'side' in views: kit.render_view(cam, out / 'lod0_side.png', (3, .45, -.1), (0, .45, -.1), 2.5)
                if 'front' in views: kit.render_view(cam, out / 'lod0_front.png', (0, .5, 3), (0, .45, 0), 2.0)
                if 'top' in views: kit.render_view(cam, out / 'lod0_top.png', (0, 4, .01), (0, .3, -.1), 2.6)
                if 'close' in views: kit.render_view(cam, out / 'lod0_closeup.png', (.8, .75, 1.4), (0, .3, .35), 1.0)
    if results: write_report(out, results)
    print('Build complete.', flush=True)


if __name__ == '__main__':
    main()
