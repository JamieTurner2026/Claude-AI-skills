#!/usr/bin/env bash
# Render a film sim to a finished MP4: chunks one after another (resumable), concat, score, mux, verify.
#   bash scripts/render_film.sh SIM SCORE.py [CHUNK_SECONDS]
#   e.g. bash "$SKILL_DIR/scripts/render_film.sh" v8-post "$SKILL_DIR/sims/v8-shared/score_post.py"
# Run from the folder that should hold teardown-out/. The duration comes from sims/SIM/timeline.json.
# On software WebGL (SwiftShader, no GPU) budget ~7 s per 1080p frame: 26 s at 60 fps took about 3 h.
# Never run chunks in parallel there: browsers starve each other (~23 s/frame each on 4 CPUs).
# Re-run after a crash: chunks that decode with the right frame count are kept.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIM="$1"; SCORE="$2"; STEP="${3:-6.5}"
SIZE="${SIZE:-1600x900}"; DPR="${DPR:-1.2}"; FPS="${FPS:-60}"
export READY_TIMEOUT="${READY_TIMEOUT:-600000}"   # shader warm-up on software WebGL can pass the 60 s default
OUT=teardown-out/full/$SIM
mkdir -p "$OUT"

DUR=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['duration'])" "$SKILL_DIR/sims/$SIM/timeline.json")
node "$SKILL_DIR/sims/build.mjs" "$SIM" >/dev/null
frames() { ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "$1"; }

starts=()
a=0
while python3 -c "import sys;sys.exit(0 if float(sys.argv[1])<float(sys.argv[2])-1e-9 else 1)" "$a" "$DUR"; do
  b=$(python3 -c "import sys;print(min(float(sys.argv[1])+float(sys.argv[2]),float(sys.argv[3])))" "$a" "$STEP" "$DUR")
  part="$OUT/part_$a.mp4"
  want=$(python3 -c "import sys;print(round((float(sys.argv[2])-float(sys.argv[1]))*float(sys.argv[3])))" "$a" "$b" "$FPS")
  starts+=("$a")
  if [ -s "$part" ] && ffmpeg -v error -i "$part" -f null - && [ "$(frames "$part")" = "$want" ]; then
    echo "keep $part"
  else
    ok=0
    for try in 1 2 3; do
      node "$SKILL_DIR/sims/capture.mjs" "$SIM" --size "$SIZE" --dpr "$DPR" --fps "$FPS" --from "$a" --to "$b" --out "$part" \
        > "$OUT/log_$a.txt" 2>&1 && ffmpeg -v error -i "$part" -f null - && { ok=1; break; }
    done
    [ "$ok" = 1 ] || { echo "chunk $a-$b failed, see $OUT/log_$a.txt" >&2; exit 1; }
    echo "done $part"
  fi
  a=$b
done

: > "$OUT/list.txt"
for s in "${starts[@]}"; do echo "file '$PWD/$OUT/part_$s.mp4'" >> "$OUT/list.txt"; done
ffmpeg -loglevel error -y -f concat -safe 0 -i "$OUT/list.txt" -c copy "$OUT/silent.mp4"

python3 "$SKILL_DIR/run_sfx.py" "$SCORE"
WAV=$(ls -t teardown-out/*.wav | head -1)
ffmpeg -loglevel error -y -i "$OUT/silent.mp4" -i "$WAV" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k \
  -shortest -movflags +faststart "teardown-out/$SIM.mp4"
ffmpeg -v error -i "teardown-out/$SIM.mp4" -f null -
ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames,width,height,r_frame_rate \
  -show_entries format=duration -of compact "teardown-out/$SIM.mp4"
echo "→ teardown-out/$SIM.mp4 (audio: $WAV)"
