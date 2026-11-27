#!/usr/bin/env bash
# Side-by-side reference vs render at given times, plus per-panel SSIM.
# usage: ./compare.sh REF.mov OUT_DIR "0.5 5.5 13.5"
# Expects OUT_DIR/still_<t>.png from `node render.mjs --stills ...` (1280x1632).
set -euo pipefail
REF=$1; OUT=$2; TIMES=$3
for t in $TIMES; do
  ffmpeg -v error -y -ss "$t" -i "$REF" -frames:v 1 "$OUT/ref_$t.png"
  ffmpeg -v error -y -i "$OUT/ref_$t.png" -i "$OUT/still_$t.png" \
    -filter_complex "[0]scale=640:-1[a];[1]scale=640:-1[b];[a][b]hstack" "$OUT/cmp_$t.png"
  for p in "A 96" "B 912"; do set -- $p
    s=$(ffmpeg -i "$OUT/ref_$t.png" -i "$OUT/still_$t.png" -filter_complex \
      "[0]crop=1280:720:0:$2,scale=320:180,gblur=sigma=2[a];[1]crop=1280:720:0:$2,scale=320:180,gblur=sigma=2[b];[a][b]ssim" \
      -f null - 2>&1 | grep -o 'All:[0-9.]*' | cut -d: -f2)
    echo "t=$t panel=$1 ssim=$s"
  done
done
