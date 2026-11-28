#!/usr/bin/env python3
"""Fit a planet (direction + angular radius) to its limb in reference frames.

  python3 -I scripts/fit_planet.py REF.mp4 T PANEL_X PANEL_Y [--fov 60] [--size 900]

Traces the limb (first bluish row under a brown/black sky) in each column of one panel at time T, turns the
pixels into camera rays and solves for the sphere whose limb passes through them. Prints the direction in
camera space (x right, y up, -z forward) and the angular radius: feed them to planetDir / planetAng for a
frame where the camera looks straight down -z (no yaw, pitch or roll).
"""
import subprocess, sys, math
import numpy as np

ref, t, px, py = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
fov = float(sys.argv[sys.argv.index('--fov') + 1]) if '--fov' in sys.argv else 60.0
N = int(sys.argv[sys.argv.index('--size') + 1]) if '--size' in sys.argv else 900
raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(t), '-i', ref, '-frames:v', '1', '-vf', f'crop={N}:{N}:{px}:{py}',
                      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
a = np.frombuffer(raw, np.uint8).reshape(N, N, 3).astype(int)
f = N / 2 / math.tan(math.radians(fov / 2))
pts = []
for x in range(10, N - 10, 6):
    if 300 < x < 600 and False:
        continue
    for y in range(140 if 300 < x < 600 else 90, N - 200):
        r, g, b = a[y, x]
        if b > r + 30 and b > 70:
            pts.append((x, y))
            break
pts = np.array(pts, float)
# reject columns where something (station, ship) sits in front: keep the smooth envelope
def rays(p):
    d = np.stack([(p[:, 0] - N / 2) / f, -(p[:, 1] - N / 2) / f, -np.ones(len(p))], 1)
    return d / np.linalg.norm(d, axis=1, keepdims=True)
R = rays(pts)
def loss(v):
    az, el, rho = v
    c = np.array([math.sin(az) * math.cos(el), math.sin(el), -math.cos(az) * math.cos(el)])
    e = np.arccos(np.clip(R @ c, -1, 1)) - rho
    return e
best = None
for az0 in np.linspace(-1.2, 1.2, 9):
    for el0 in np.linspace(-1.4, -0.2, 7):
        for rho0 in (0.6, 0.9, 1.2):
            v = np.array([az0, el0, rho0])
            for it in range(200):  # Gauss-Newton
                e = loss(v)
                J = np.zeros((len(e), 3))
                for k in range(3):
                    dv = np.zeros(3); dv[k] = 1e-5
                    J[:, k] = (loss(v + dv) - e) / 1e-5
                step = np.linalg.lstsq(J, -e, rcond=None)[0]
                v = v + step
                if np.abs(step).max() < 1e-9:
                    break
            # robust: drop points far from the fit once
            e = loss(v)
            keep = np.abs(e) < max(0.01, 3 * np.median(np.abs(e)))
            s = np.sqrt(np.mean(e[keep] ** 2))
            if best is None or s < best[0]:
                best = (s, v, keep.sum())
s, (az, el, rho), n = best
c = [math.sin(az) * math.cos(el), math.sin(el), -math.cos(az) * math.cos(el)]
print(f'points {len(pts)} kept {n}  rms {math.degrees(s):.3f} deg')
print(f'planetDir [{c[0]:.4f}, {c[1]:.4f}, {c[2]:.4f}]  planetAng {math.degrees(rho):.2f}')
print('limb samples (x,y):', ' '.join(f'{int(x)},{int(y)}' for x, y in pts[::10]))
