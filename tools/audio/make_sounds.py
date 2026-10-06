"""The game's sounds made from the owner's recordings and synthesised ones (the owner, 7 Oct). Needs numpy and ffmpeg.

    python3 tools/audio/make_sounds.py <wind recording> <growl recording> [outdir]

  wind   tools: the owner's "wind lake" recording (soundreality, Pixabay; 48 s, very loud at -10 LUFS). Its steady middle (6 to 30 s) is cut out and made
         into a seamless 22 s loop (the last 2 s crossfaded into the start, equal power), stereo, levelled to -24 LUFS (the desert ambience is about
         -32 at half volume, so the game turns this up with speed): public/audio/wind/wind_rush_loop.mp3
  growl  the owner's "colossal growl" (freesound_community, Pixabay; 5.5 s). Trimmed, faded out, mono (it is placed at the Colossus), levelled to
         -16 LUFS: public/audio/colossus/colossus_growl.mp3
  steps  synthesised here: four booming Colossus footfalls (a sub boom sweeping down from 52 to 30 Hz, saturated so its harmonics carry on small
         speakers, a 110 Hz body thud, a low rumble of filtered noise, gravel and sand pattering down after it, and a long soft tail), mono, -16 LUFS:
         public/audio/colossus/colossus_step_0{1..4}.mp3
The loudness is measured with ffmpeg's EBU R128 filter and corrected in a second pass.
"""
import os
import subprocess
import sys

import numpy as np

SR = 48000
wind_src, growl_src = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'audio')


def read(path, channels):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', str(channels), '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, channels).copy()


def loudness(x):
    p = subprocess.run(['ffmpeg', '-hide_banner', '-f', 'f32le', '-ar', str(SR), '-ac', str(x.shape[1]), '-i', '-', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
                       input=x.astype(np.float32).tobytes(), capture_output=True)
    for line in p.stderr.decode().splitlines()[::-1]:
        if line.strip().startswith('I:'):
            return float(line.split()[1])
    raise RuntimeError('no loudness')


def level(x, target):
    gain = 10 ** ((target - loudness(x)) / 20)
    y = x * gain
    peak = np.abs(y).max()
    if peak > 0.95:                     # never clip: a soft limit on the peaks
        y = np.tanh(y / 0.95) * 0.95
    return y


def write(x, path, kbps):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(x.shape[1]), '-i', '-', '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', path],
                   input=x.astype(np.float32).tobytes(), check=True)
    print(os.path.relpath(path), f'{len(x) / SR:.2f} s', f'{loudness(x):.1f} LUFS', os.path.getsize(path) // 1024, 'KB')


# ---- the wind loop
w = read(wind_src, 2)[int(6 * SR):int(30 * SR)]
xf = int(2 * SR)
body, tail = w[:-xf], w[-xf:]
t = np.linspace(0, 1, xf)[:, None]
body[:xf] = body[:xf] * np.sin(t * np.pi / 2) + tail * np.cos(t * np.pi / 2)   # the end fades into the start: the loop has no seam
write(level(body, -24), os.path.join(out, 'wind', 'wind_rush_loop.mp3'), 96)

# ---- the growl
g = read(growl_src, 1)
env = np.abs(g[:, 0])
start = max(0, int(np.argmax(env > 0.02)) - int(0.03 * SR))
g = g[start:]
fade = int(0.4 * SR)
g[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
write(level(g, -16), os.path.join(out, 'colossus', 'colossus_growl.mp3'), 128)


# ---- the footsteps
def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)):
        s = (1 - a) * x[i] + a * s
        y[i] = s
    return y


def bandpass(x, lo, hi):
    return lowpass(x, hi) - lowpass(x, lo)


def footstep(seed):
    rng = np.random.default_rng(seed)
    n = int(3.4 * SR)
    t = np.arange(n) / SR
    pitch = 1 + rng.uniform(-0.08, 0.08)
    # the boom: a sine sweeping down, its phase integrated, with a fast attack and a long decay; saturated for harmonics a headset's speakers can play
    f = (30 + 22 * np.exp(-t / 0.18)) * pitch
    phase = 2 * np.pi * np.cumsum(f) / SR
    boom = np.sin(phase) * (1 - np.exp(-t / 0.004)) * (0.65 * np.exp(-t / 0.22) + 0.35 * np.exp(-t / 0.9))
    boom = np.tanh(boom * 2.6) / np.tanh(2.6)
    # the body: a shorter thud an octave and a half up
    body = np.sin(2 * np.pi * 110 * pitch * t * (1 - 0.15 * t)) * np.exp(-t / 0.12) * (1 - np.exp(-t / 0.003))
    # the impact: a short low-passed noise burst (the foot meeting the ground)
    hit = lowpass(rng.standard_normal(n) * np.exp(-t / 0.025), 900) * 3.0
    # the rumble: brown-ish noise, low-passed, swelling and dying with the ground's shake
    rumble = lowpass(lowpass(rng.standard_normal(n), 140), 140) * 9 * (1 - np.exp(-t / 0.05)) * np.exp(-t / 0.8)
    # gravel and sand falling back: little clicks, thinning out, after a short delay
    debris = np.zeros(n)
    for _ in range(140):
        at = 0.12 + rng.exponential(0.45)
        if at > 3.0:
            continue
        k = int(at * SR)
        size = int(rng.uniform(0.002, 0.008) * SR)
        if k + size >= n:
            continue
        debris[k:k + size] += rng.standard_normal(size) * np.hanning(size) * rng.uniform(0.2, 1.0) * np.exp(-at / 0.9)
    debris = bandpass(debris, 350, 3500) * 0.55
    # a soft tail, as if across the plain: the whole thing smeared and quieter
    dry = 1.0 * boom + 0.5 * body + 0.55 * hit + 0.22 * rumble + debris
    tail = np.zeros(n)
    for d, g_ in ((0.09, 0.35), (0.23, 0.22), (0.41, 0.14), (0.67, 0.08)):
        k = int(d * SR)
        tail[k:] += dry[:n - k] * g_
    x = dry + lowpass(tail, 1200)
    end = int(0.5 * SR)
    x[-end:] *= np.linspace(1, 0, end) ** 2
    return x[:, None]


for i in range(4):
    write(level(footstep(101 + i * 17), -16), os.path.join(out, 'colossus', f'colossus_step_{i + 1:02d}.mp3'), 128)
