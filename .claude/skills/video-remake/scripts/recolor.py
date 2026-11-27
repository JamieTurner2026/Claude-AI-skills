"""Recolour one colour range of an existing video (e.g. turquoise water -> green), leaving everything else.

Selects pixels by hue band AND saturation/brightness, so a dim background of the same hue is kept.
Soft edges (smooth ramps + slight blur) avoid halos. Audio is copied unchanged.

  python3 -I recolor.py preview IN.png OUT_DIR [options]   -> recolored.png, mask.png, side_by_side.png
  python3 -I recolor.py video   IN.mov OUT.mp4 [options]   -> whole video, audio copied

Options (hue in degrees 0-360):
  --hue LO HI        source hue band to change           (default 160 210: cyan/turquoise)
  --to DEG           target hue                          (default 124: sea green)
  --sat LO HI        saturation ramp 0-255 for main mask (default 105 150)
  --val LO HI        brightness ramp 0-255 for main mask (default 80 120)
  --pale             also take pale bright pixels of the band (underwater haze, wave tops)
  --deep LO HI       also take a darker, very saturated band (e.g. 185 235 for deep blue water)
  --tame F           cut saturation inside the mask by F (default 0.18) so the new colour isn't neon
Tune on previews of several frames (wide shots and close-ups) before running the whole video.
Needs: numpy, opencv-python-headless, ffmpeg.
"""
import argparse, subprocess, sys
import numpy as np
import cv2


def ramp(x, a, b):
    t = np.clip((x - a) / max(1e-6, (b - a)), 0, 1)
    return t * t * (3 - 2 * t)


def build_mask(hsv, o):
    h, s, v = [hsv[..., i].astype(np.float32) for i in range(3)]
    lo, hi = o.hue[0] / 2, o.hue[1] / 2  # OpenCV hue is 0-180
    band = ramp(h, lo - 3, lo + 3) * (1 - ramp(h, hi - 3, hi + 3))
    m = band * ramp(s, *o.sat) * ramp(v, *o.val)
    if o.pale:
        m = np.maximum(m, band * ramp(s, 55, 95) * ramp(v, 118, 150))
    if o.deep:
        dl, dh = o.deep[0] / 2, o.deep[1] / 2
        deep = ramp(h, dl - 3, dl + 2) * (1 - ramp(h, dh - 3, dh + 3)) * ramp(s, 150, 185) * ramp(v, 55, 80)
        m = np.maximum(m, deep)
    return cv2.GaussianBlur(m, (0, 0), 1.2)


def recolor(bgr, o):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    m = build_mask(hsv, o)
    out = hsv.copy()
    h = hsv[..., 0].astype(np.float32)
    centre = (o.hue[0] + o.hue[1]) / 4
    new_h = o.to / 2 + (h - centre) * 0.5           # keep some of the original hue variation
    out[..., 0] = np.clip(h + (new_h - h) * m, 0, 179).astype(np.uint8)
    out[..., 1] = np.clip(hsv[..., 1] * (1 - o.tame * m), 0, 255).astype(np.uint8)
    out[..., 2] = np.clip(hsv[..., 2] * (1 - 0.10 * m), 0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_HSV2BGR), m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['preview', 'video'])
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--hue', nargs=2, type=float, default=[160, 210])
    ap.add_argument('--to', type=float, default=124)
    ap.add_argument('--sat', nargs=2, type=float, default=[105, 150])
    ap.add_argument('--val', nargs=2, type=float, default=[80, 120])
    ap.add_argument('--pale', action='store_true')
    ap.add_argument('--deep', nargs=2, type=float)
    ap.add_argument('--tame', type=float, default=0.18)
    ap.add_argument('--crf', type=int, default=16)
    o = ap.parse_args()

    if o.mode == 'preview':
        import os
        os.makedirs(o.dst, exist_ok=True)
        img = cv2.imread(o.src)
        res, m = recolor(img, o)
        mask = cv2.cvtColor((m * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
        cv2.imwrite(f'{o.dst}/recolored.png', res)
        cv2.imwrite(f'{o.dst}/mask.png', mask)
        cv2.imwrite(f'{o.dst}/side_by_side.png', np.hstack([img, mask, res]))
        print('wrote', o.dst)
        return

    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height,r_frame_rate',
                            '-of', 'csv=p=0', o.src], capture_output=True, text=True, check=True).stdout.strip().split(',')
    W, H, fps = int(probe[0]), int(probe[1]), probe[2]
    dec = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', o.src, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-framerate', fps, '-i', '-',
                            '-i', o.src, '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-preset', 'slow', '-crf', str(o.crf),
                            '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', o.dst], stdin=subprocess.PIPE)
    n = W * H * 3; frames = 0
    while True:
        buf = dec.stdout.read(n)
        if len(buf) < n:
            break
        enc.stdin.write(recolor(np.frombuffer(buf, np.uint8).reshape(H, W, 3), o)[0].tobytes())
        frames += 1
    enc.stdin.close(); enc.wait(); dec.wait()
    print(f'{frames} frames -> {o.dst}', file=sys.stderr)


if __name__ == '__main__':
    main()
