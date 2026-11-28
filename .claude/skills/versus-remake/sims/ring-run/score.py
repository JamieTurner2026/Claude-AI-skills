#!/usr/bin/env python3
"""Sound for ring-run: an engine rumble bed plus whoosh bursts, matched to the reference's loudness every 0.1 s.

  python3 -I score.py OUT.wav [--ref REF.mp4]

Without --ref it uses the measured envelope below. With --ref it prints the per-0.1 s level of both, so the
burst list can be tuned. numpy only; deterministic (fixed seed).
"""
import sys, wave, subprocess
import numpy as np

SR = 48000
DUR = 241 / 24
# (start s, length s, peak dB rms of the 0.1 s window, centre Hz) — from the reference's 0.1 s rms strip
BURSTS = [
    (2.30, 0.70, -19.0, 300), (4.45, 0.30, -25.0, 260), (5.38, 0.32, -25.0, 280), (6.36, 0.28, -25.0, 300),
    (7.25, 0.32, -26.0, 280), (7.78, 0.12, -28.5, 320), (8.05, 0.45, -24.3, 260), (8.55, 0.12, -24.0, 300),
    (8.76, 0.14, -24.0, 320), (9.05, 0.70, -18.5, 280),
]
BED_DB = -33.0


def bandnoise(n, rng, lo, hi):
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    y = np.fft.irfft(X, n)
    return y / (np.sqrt((y ** 2).mean()) + 1e-12)


def brown(n, rng):
    y = np.cumsum(rng.standard_normal(n))
    y -= np.convolve(y, np.ones(4801) / 4801, mode='same')
    return y / (np.sqrt((y ** 2).mean()) + 1e-12)


def make():
    rng = np.random.default_rng(42)
    n = int(DUR * SR)
    t = np.arange(n) / SR
    mono = np.zeros(n)
    bed = 0.75 * brown(n, rng) + 0.35 * bandnoise(n, rng, 300, 600) + 0.15 * bandnoise(n, rng, 600, 2500)
    bed *= 1 + 0.12 * np.sin(2 * np.pi * 0.7 * t)
    mono += bed / np.sqrt((bed ** 2).mean()) * 10 ** (BED_DB / 20)
    for (s, L, db, fc) in BURSTS:
        m = int(L * SR)
        a = int(s * SR)
        m = min(m, n - a)
        env = np.sin(np.linspace(0, np.pi, m)) ** 1.5
        b = 0.7 * bandnoise(m, rng, 40, fc * 1.8) + 0.3 * bandnoise(m, rng, fc, fc * 4)
        mono[a:a + m] += b * env * 10 ** (db / 20) * 1.25
    mono[: int(0.06 * SR)] *= np.linspace(0, 1, int(0.06 * SR))
    # stereo: mostly the same signal, a little independent air on each side
    out = np.stack([mono + 10 ** ((BED_DB - 12) / 20) * bandnoise(n, rng, 200, 3000) for _ in range(2)])
    out[:, -int(0.3 * SR):] *= np.linspace(1, 0.35, int(0.3 * SR))
    peak = np.abs(out).max()
    if peak > 0.9:
        out *= 0.9 / peak
    return out


def levels(x):
    w = SR // 10
    return [20 * np.log10(np.sqrt((x[i:i + w] ** 2).mean()) + 1e-9) for i in range(0, len(x) - w, w)]


if __name__ == '__main__':
    path = sys.argv[1]
    y = make()
    pcm = (np.clip(y.T, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f'wrote {path}: {DUR:.2f} s, peak {20 * np.log10(np.abs(y).max()):.1f} dBFS, mean {20 * np.log10(np.sqrt((y ** 2).mean())):.1f} dB')
    if '--ref' in sys.argv:
        ref = sys.argv[sys.argv.index('--ref') + 1]
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', ref, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True).stdout
        r = np.frombuffer(raw, np.int16).astype(float) / 32768
        a, b = levels(r), levels(y.mean(0))
        print('t    ref   mine')
        for i in range(min(len(a), len(b))):
            print(f'{i / 10:4.1f} {a[i]:6.1f} {b[i]:6.1f}', end='   ' if i % 4 != 3 else '\n')
        print()
