#!/usr/bin/env bash
# Study a reference video before remaking it.
# usage: analyze_reference.sh REF.mov OUT_DIR [PANEL ...]
#   PANEL = name:x:y:w:h   crop of one region (e.g. one half of a stacked comparison video)
#   env STEP=0.25 (seconds between dense frames), T0/T1 (time window, default whole video)
# Writes: probe.txt, contact.png (1 fps, whole frame), full_<t>.png stills,
#         and per panel dense_<name>_<k>.png sheets (24 frames each, timestamped).
# Dense frames use exact seeks (-ss): the fps filter's labels can be ~0.25 s off.
set -euo pipefail
REF=$1; OUT=$2; shift 2
mkdir -p "$OUT"
FONT=$(fc-match -f '%{file}' sans 2>/dev/null || echo /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf)
ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,sample_rate,channels -of compact "$REF" | tee "$OUT/probe.txt"
ffmpeg -i "$REF" -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume" | tee -a "$OUT/probe.txt" || true
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$REF")
ffmpeg -v error -y -i "$REF" -vf "fps=1,scale=320:-1,tile=6x3" -frames:v 1 "$OUT/contact.png"
for t in 0.5 $(python3 -c "print(round($DUR/2,2), round($DUR-1,2))"); do
  ffmpeg -v error -y -ss "$t" -i "$REF" -frames:v 1 "$OUT/full_$t.png"
done
STEP=${STEP:-0.25}; T0=${T0:-0}; T1=${T1:-$DUR}
for P in "$@"; do
  IFS=: read -r NAME X Y W H <<<"$P"
  i=0; tmp="$OUT/.dense_$NAME"; mkdir -p "$tmp"; rm -f "$tmp"/*.png
  for t in $(seq "$T0" "$STEP" "$T1"); do
    ffmpeg -v error -y -ss "$t" -i "$REF" -frames:v 1 \
      -vf "crop=$W:$H:$X:$Y,scale=240:-1,drawtext=fontfile=$FONT:text='$t':fontcolor=yellow:fontsize=16:x=4:y=4" \
      "$(printf '%s/%04d.png' "$tmp" $i)"; i=$((i+1))
  done
  ffmpeg -v error -y -i "$tmp/%04d.png" -vf tile=6x4 "$OUT/dense_${NAME}_%02d.png"
  rm -rf "$tmp"
done
ls "$OUT"
