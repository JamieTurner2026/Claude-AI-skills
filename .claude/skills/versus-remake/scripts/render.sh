#!/usr/bin/env bash
# Render a split-screen sim to a finished MP4: build, capture every frame, synthesize the score, mux, verify.
#   bash scripts/render.sh SIM_DIR [OUT.mp4]
#   e.g. bash "$SKILL_DIR/scripts/render.sh" "$SKILL_DIR/sims/ring-run" out/ring-run.mp4
# Size and fps come from the sim (window.SIM.duration / fps); SIZE defaults to the 1876x1030 two-panel layout.
# The sim folder may carry score.py (writes a wav: python3 -I score.py OUT.wav); without it the video is silent.
# On software WebGL (SwiftShader) budget ~2-4 s per frame for two 900 px panels.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TEARDOWN="${TEARDOWN:-$HERE/../teardown}"
SIMDIR="$(realpath "$1")"; SIM="$(basename "$SIMDIR")"
OUT="$(realpath -m "${2:-teardown-out/$SIM.mp4}")"
SIZE="${SIZE:-1876x1030}"; FPS="${FPS:-24}"
export READY_TIMEOUT="${READY_TIMEOUT:-600000}"
mkdir -p "$(dirname "$OUT")" teardown-out
node "$TEARDOWN/sims/build.mjs" "$SIMDIR" >/dev/null
SILENT="teardown-out/$SIM-silent.mp4"
node "$TEARDOWN/sims/capture.mjs" "$SIM" --size "$SIZE" --dpr 1 --fps "$FPS" --crf "${CRF:-16}" --out "$SILENT"
if [ -f "$SIMDIR/score.py" ]; then
  python3 -I "$SIMDIR/score.py" "teardown-out/$SIM-score.wav"
  ffmpeg -loglevel error -y -i "$SILENT" -i "teardown-out/$SIM-score.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k \
    -shortest -movflags +faststart "$OUT"
else
  cp "$SILENT" "$OUT"
fi
ffmpeg -v error -i "$OUT" -f null -
ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames,width,height,r_frame_rate \
  -show_entries format=duration -of compact "$OUT"
echo "→ $OUT"
