#!/usr/bin/env bash
# Render the 26 s film at 1920x1080 / 60 fps (4 chunks in parallel), score it and mux.
#   bash render.sh [WORKDIR]      run setup.sh first
# On a real GPU this takes minutes; on software WebGL (SwiftShader) budget about an hour.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$HERE/work}"
cd "$WORK/teardown"
OUT=teardown-out/full
mkdir -p "$OUT"

# Upstream waits 60 s for the page to be ready. Four browsers compiling shaders at once on
# software WebGL can take longer, so make that wait configurable and stagger the starts.
sed -i 's/{timeout: 60000}/{timeout: Number(process.env.READY_TIMEOUT || 60000)}/' sims/capture.mjs
export READY_TIMEOUT=600000

pids=()
for c in "0 6.5" "6.5 13" "13 19.5" "19.5 26"; do
  set -- $c
  part="$OUT/part_$1.mp4"
  [ ${#pids[@]} -gt 0 ] && sleep 45
  (
    for try in 1 2 3; do
      node sims/capture.mjs v8-post --size 1600x900 --dpr 1.2 --fps 60 --from "$1" --to "$2" --out "$part" \
        > "$OUT/log_$1.txt" 2>&1 && ffmpeg -v error -i "$part" -f null - && exit 0
    done
    exit 1
  ) &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done

: > "$OUT/list.txt"
for s in 0 6.5 13 19.5; do echo "file '$PWD/$OUT/part_$s.mp4'" >> "$OUT/list.txt"; done
ffmpeg -loglevel error -y -f concat -safe 0 -i "$OUT/list.txt" -c copy "$OUT/v8-silent.mp4"

python3 run_sfx.py sims/v8-shared/score_post.py
ffmpeg -loglevel error -y -i "$OUT/v8-silent.mp4" -i teardown-out/v8-post-score.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$OUT/v8-remake.mp4"
ffmpeg -v error -i "$OUT/v8-remake.mp4" -f null -
echo "→ $WORK/teardown/$OUT/v8-remake.mp4"
