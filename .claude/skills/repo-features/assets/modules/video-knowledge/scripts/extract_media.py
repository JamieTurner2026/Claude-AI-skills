#!/usr/bin/env python3
"""Media extraction for the video-knowledge skill.

Subcommands:
  probe       <video>                       duration / streams (JSON)
  transcribe  <video> --out DIR             audio -> DIR/transcript.json + transcript.txt
  frames      <video> --out DIR             key frames -> DIR/frames/*.jpg, frames.json, sheet_*.jpg

Only needs ffmpeg/ffprobe + Pillow. Speech-to-text uses, in order: a sidecar
.srt/.vtt next to the video, an embedded subtitle stream, faster-whisper,
openai-whisper. If none exist it exits with code 3 and says what to do.
"""
import argparse, json, os, re, subprocess, sys, tempfile

SIGNAL_WORDS = re.compile(
    r"\b(click|press|push|select|screen|display|alarm|error|fault|warning|danger|caution|"
    r"panel|diagram|wiring|you can see|look at|as you can see|notice|here is|this is the|"
    r"setting|parameter|button|indicator|light|led)\b", re.I)


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def ts(sec):
    sec = int(round(sec))
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def probe(path):
    r = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path])
    if r.returncode:
        sys.exit(f"ffprobe failed: {r.stderr.strip()}")
    d = json.loads(r.stdout)
    kinds = [s["codec_type"] for s in d.get("streams", [])]
    return {
        "file_name": os.path.basename(path),
        "duration": float(d["format"].get("duration", 0)),
        "has_audio": "audio" in kinds,
        "has_video": "video" in kinds,
        "subtitle_streams": kinds.count("subtitle"),
    }


# ---------- transcript ----------
def _t(s):
    s = s.strip().replace(",", ".")
    parts = [float(p) for p in s.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def parse_subs(text):
    segs = []
    for block in re.split(r"\n\s*\n", text.replace("\r", "")):
        lines = [l for l in block.strip().split("\n") if l.strip()]
        for i, l in enumerate(lines):
            m = re.match(r"([\d:.,]+)\s*-->\s*([\d:.,]+)", l)
            if m:
                body = re.sub(r"<[^>]+>", "", " ".join(lines[i + 1:])).strip()
                if body:
                    segs.append({"start": _t(m[1]), "end": _t(m[2]), "text": body})
                break
    return segs


def transcribe(video, model_size="small"):
    base = os.path.splitext(video)[0]
    for ext in (".srt", ".vtt"):
        if os.path.exists(base + ext):
            return parse_subs(open(base + ext, encoding="utf-8", errors="ignore").read()), f"sidecar{ext}"
    if probe(video)["subtitle_streams"]:
        with tempfile.TemporaryDirectory() as td:
            out = os.path.join(td, "s.srt")
            if run(["ffmpeg", "-y", "-i", video, "-map", "0:s:0", out]).returncode == 0:
                return parse_subs(open(out, encoding="utf-8", errors="ignore").read()), "embedded-subtitles"
    if not probe(video)["has_audio"]:
        sys.exit("Video has no audio stream; rely on frames only.")
    wav = tempfile.mktemp(suffix=".wav")
    r = run(["ffmpeg", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000", wav])
    if r.returncode:
        sys.exit(f"audio extraction failed: {r.stderr[-500:]}")
    try:
        try:
            from faster_whisper import WhisperModel
            m = WhisperModel(model_size, compute_type="int8")
            segs, _ = m.transcribe(wav, vad_filter=True)
            return [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segs], "faster-whisper"
        except ImportError:
            pass
        try:
            import whisper
            res = whisper.load_model(model_size).transcribe(wav)
            return [{"start": s["start"], "end": s["end"], "text": s["text"].strip()} for s in res["segments"]], "openai-whisper"
        except ImportError:
            pass
    finally:
        if os.path.exists(wav):
            os.remove(wav)
    print("NO_STT_ENGINE: try `pip install faster-whisper`, or supply an .srt/.vtt next to the video, "
          "or paste a transcript with timestamps and run `kb.py add-video --transcript-file`.", file=sys.stderr)
    sys.exit(3)


def cmd_transcribe(a):
    os.makedirs(a.out, exist_ok=True)
    segs, engine = transcribe(a.video, a.model)
    json.dump({"engine": engine, "segments": segs}, open(f"{a.out}/transcript.json", "w"), indent=1)
    with open(f"{a.out}/transcript.txt", "w") as f:
        for s in segs:
            f.write(f"[{ts(s['start'])}] {s['text']}\n")
    print(f"{len(segs)} segments via {engine} -> {a.out}/transcript.txt")


# ---------- frames ----------
def scene_times(video, thr):
    r = run(["ffmpeg", "-i", video, "-vf", f"select='gt(scene,{thr})',showinfo", "-an", "-f", "null", "-"])
    return [float(m) for m in re.findall(r"pts_time:([\d.]+)", r.stderr)]


def ahash(path):
    from PIL import Image
    im = Image.open(path).convert("L").resize((8, 8))
    px = list(im.tobytes())
    avg = sum(px) / 64
    return sum((1 << i) for i, p in enumerate(px) if p > avg)


def cmd_frames(a):
    from PIL import Image, ImageDraw
    info = probe(a.video)
    if not info["has_video"]:
        sys.exit("no video stream")
    dur = info["duration"]
    cands = [(t, "scene-change") for t in scene_times(a.video, a.scene)]
    if a.transcript and os.path.exists(a.transcript):
        for s in json.load(open(a.transcript))["segments"]:
            if SIGNAL_WORDS.search(s["text"]):
                cands.append((s["start"] + min(1.5, (s["end"] - s["start"]) / 2), "narration-cue"))
    step = max(a.interval, dur / a.max)
    t = 0.0
    while t < dur:
        cands.append((t, "interval"))
        t += step
    pri = {"scene-change": 0, "narration-cue": 1, "interval": 2}
    cands.sort(key=lambda c: (c[0]))
    kept, last = [], -1e9
    for t, why in cands:  # enforce min gap, prefer higher-priority reason when close
        if t - last >= a.min_gap:
            kept.append([t, why]); last = t
        elif kept and pri[why] < pri[kept[-1][1]] and t - kept[-1][0] < a.min_gap:
            kept[-1] = [t, why]
    fdir = os.path.join(a.out, "frames")
    os.makedirs(fdir, exist_ok=True)
    frames, hashes = [], []
    for t, why in kept:
        p = os.path.join(fdir, f"f_{int(t):06d}.jpg")
        run(["ffmpeg", "-y", "-ss", f"{t:.2f}", "-i", a.video, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "3", p])
        if not os.path.exists(p):
            continue
        h = ahash(p)
        if any(bin(h ^ o).count("1") <= a.dup_bits for o in hashes):
            os.remove(p); continue          # near-identical to a frame already kept
        hashes.append(h)
        frames.append({"seconds": round(t, 2), "timestamp": ts(t), "path": p, "reason": why})
    frames = frames[: a.max]
    json.dump(frames, open(f"{a.out}/frames.json", "w"), indent=1)
    # contact sheets so Claude can inspect 6 frames per image view
    per = 6
    for i in range(0, len(frames), per):
        chunk = frames[i:i + per]
        W, H = 640, 360
        sheet = Image.new("RGB", (W * 2, H * 3), "black")
        d = ImageDraw.Draw(sheet)
        for j, f in enumerate(chunk):
            im = Image.open(f["path"]).convert("RGB"); im.thumbnail((W, H))
            x, y = (j % 2) * W, (j // 2) * H
            sheet.paste(im, (x, y))
            d.rectangle([x, y, x + 90, y + 18], fill="black")
            d.text((x + 4, y + 3), f["timestamp"], fill="yellow")
        sheet.save(f"{a.out}/sheet_{i // per + 1:02d}.jpg", quality=85)
    print(f"{len(frames)} frames -> {fdir}; contact sheets: {a.out}/sheet_*.jpg")


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("probe"); s.add_argument("video")
    s = sub.add_parser("transcribe"); s.add_argument("video"); s.add_argument("--out", required=True); s.add_argument("--model", default="small")
    s = sub.add_parser("frames"); s.add_argument("video"); s.add_argument("--out", required=True)
    s.add_argument("--transcript", help="transcript.json, enables narration-cue frames")
    s.add_argument("--scene", type=float, default=0.3); s.add_argument("--max", type=int, default=40)
    s.add_argument("--interval", type=float, default=30); s.add_argument("--min-gap", type=float, default=4)
    s.add_argument("--dup-bits", type=int, default=4)
    a = p.parse_args()
    if a.cmd == "probe": print(json.dumps(probe(a.video), indent=1))
    elif a.cmd == "transcribe": cmd_transcribe(a)
    else: cmd_frames(a)


if __name__ == "__main__":
    main()
