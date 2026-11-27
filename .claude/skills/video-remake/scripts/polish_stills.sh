#!/usr/bin/env bash
# One pass of the polish loop: render key stills, then one 2x2 sheet per panel to critique.
# usage: polish_stills.sh PROJECT_DIR OUT_DIR [PANEL ...]     PANEL = name:x:y:w:h (crop of the composed frame)
#   env TIMES="0.5,2.5,5.5,13.5"  four moments: wide, orbit, zoom, close-up (pick ones from your own camera path)
#   env QUERY="ss=1"              extra page query passed to render.mjs --query
# Read every sheet_<panel>.png, write the problems down, fix the worst few, run again with a new OUT_DIR.
set -euo pipefail
PROJ=$1; OUT=$2; shift 2
TIMES=${TIMES:-0.5,2.5,5.5,13.5}
( cd "$PROJ" && node render.mjs --stills "$TIMES" ${QUERY:+--query "$QUERY"} --out "$OUT" >/dev/null )
IFS=, read -r -a T <<<"$TIMES"
[ ${#T[@]} -eq 4 ] || { echo "sheets need exactly 4 TIMES; stills are in $OUT"; exit 0; }
PANELS=("$@"); [ ${#PANELS[@]} -eq 0 ] && PANELS=("all:0:0:iw:ih")
for P in "${PANELS[@]}"; do
  IFS=: read -r NAME X Y W H <<<"$P"
  c="crop=$W:$H:$X:$Y"
  ffmpeg -v error -y -i "$OUT/still_${T[0]}.png" -i "$OUT/still_${T[1]}.png" -i "$OUT/still_${T[2]}.png" -i "$OUT/still_${T[3]}.png" \
    -filter_complex "[0]$c[a];[1]$c[b];[2]$c[c];[3]$c[d];[a][b]hstack[t];[c][d]hstack[u];[t][u]vstack,scale=1920:-2" "$OUT/sheet_$NAME.png"
  echo "$OUT/sheet_$NAME.png"
done
# To inspect a detail: ffmpeg -i still_T.png -vf "crop=W:H:X:Y,scale=iw*3:-1:flags=neighbor" zoom.png
# (sheet pixel -> still pixel: divide by the sheet scale, 1920 / (2 * panel width), then add the panel's y offset)
