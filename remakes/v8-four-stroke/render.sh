#!/usr/bin/env bash
# Render the 26 s film at 1920x1080 / 60 fps in four chunks, score it and mux.
#   bash render.sh [WORKDIR]      run setup.sh first
# Chunks render one after another: software WebGL (SwiftShader) already uses every core, and
# parallel browsers starve each other (about 23 s/frame each vs 7 s/frame alone on 4 CPUs).
# Budget about 3 h on SwiftShader; minutes on a real GPU. Re-run to resume: finished chunks are kept.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$HERE/work}"
cd "$WORK/teardown"
OUT=teardown-out/full
mkdir -p "$OUT"

# Upstream waits 60 s for the page to be ready; shader warm-up on software WebGL can take longer.
sed -i 's/{timeout: 60000}/{timeout: Number(process.env.READY_TIMEOUT || 60000)}/' sims/capture.mjs
export READY_TIMEOUT=600000

frames() { ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "$1"; }

for c in "0 6.5" "6.5 13" "13 19.5" "19.5 26"; do
  set -- $c
  part="$OUT/part_$1.mp4"
  if [ -s "$part" ] && ffmpeg -v error -i "$part" -f null - && [ "$(frames "$part")" = 390 ]; then
    echo "keep $part"; continue
  fi
  ok=0
  for try in 1 2 3; do
    node sims/capture.mjs v8-post --size 1600x900 --dpr 1.2 --fps 60 --from "$1" --to "$2" --out "$part" \
      > "$OUT/log_$1.txt" 2>&1 && ffmpeg -v error -i "$part" -f null - && { ok=1; break; }
  done
  [ "$ok" = 1 ] || { echo "chunk $1-$2 failed, see $OUT/log_$1.txt" >&2; exit 1; }
done

: > "$OUT/list.txt"
for s in 0 6.5 13 19.5; do echo "file '$PWD/$OUT/part_$s.mp4'" >> "$OUT/list.txt"; done
ffmpeg -loglevel error -y -f concat -safe 0 -i "$OUT/list.txt" -c copy "$OUT/v8-silent.mp4"

python3 run_sfx.py sims/v8-shared/score_post.py
ffmpeg -loglevel error -y -i "$OUT/v8-silent.mp4" -i teardown-out/v8-post-score.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$OUT/v8-remake.mp4"
ffmpeg -v error -i "$OUT/v8-remake.mp4" -f null -
echo "→ $WORK/teardown/$OUT/v8-remake.mp4"
