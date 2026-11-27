#!/usr/bin/env bash
# Score a remake against its reference and make side-by-side sheets to look at.
# usage: compare_videos.sh REF MINE OUT_DIR [PANEL ...]     PANEL = name:x:y:w:h (default: whole frame)
#   env TIMES="0.5 5.5 13.5"  also writes cmp_<t>.png (reference left, remake right) at exact times
# SSIM is computed on blurred, downscaled frames (structure and framing, not fine texture):
# about 0.7+ means the same shot, under 0.5 means the camera or layout is off.
set -euo pipefail
REF=$1; MINE=$2; OUT=$3; shift 3
mkdir -p "$OUT"
IFS=, read -r W H < <(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 "$REF")
PANELS=("$@"); [ ${#PANELS[@]} -eq 0 ] && PANELS=("all:0:0:$W:$H")
for P in "${PANELS[@]}"; do
  IFS=: read -r NAME X Y PW PH <<<"$P"
  s=$(ffmpeg -i "$REF" -i "$MINE" -filter_complex \
    "[0]fps=10,crop=$PW:$PH:$X:$Y,scale=320:-2,gblur=sigma=2[a];[1]fps=10,scale=$W:$H,crop=$PW:$PH:$X:$Y,scale=320:-2,gblur=sigma=2[b];[a][b]ssim" \
    -f null - 2>&1 | grep -o 'All:[0-9.]*' | cut -d: -f2)
  echo "panel=$NAME ssim=$s"
done | tee "$OUT/ssim.txt"
ffmpeg -v error -y -i "$REF" -i "$MINE" -filter_complex \
  "[0]fps=1,scale=320:-2[a];[1]fps=1,scale=$W:$H,scale=320:-2[b];[a][b]hstack,tile=6x3" -frames:v 1 "$OUT/sheet.png"
for t in ${TIMES:-}; do
  ffmpeg -v error -y -ss "$t" -i "$REF" -ss "$t" -i "$MINE" -filter_complex \
    "[0]scale=640:-2[a];[1]scale=$W:$H,scale=640:-2[b];[a][b]hstack" -frames:v 1 "$OUT/cmp_$t.png"
done
echo "sheet: $OUT/sheet.png"
