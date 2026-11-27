#!/usr/bin/env bash
# Render stills of the remake at given times and pair them with the reference video.
# Prints blurred SSIM per pair and writes OUTDIR/pairs.png (left: reference, right: remake).
#   bash compare.sh REF.mp4 OUTDIR 0.5,6,13,21 [WORKDIR]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REF="$(realpath "$1")"; O="$(realpath -m "$2")"; TS="$3"; WORK="${4:-$HERE/work}"
cd "$WORK/teardown"
node sims/build.mjs v8-post >/dev/null
rm -rf "$O"; mkdir -p "$O"
node sims/capture.mjs v8-post --size 1600x900 --dpr 1.2 --stills "$TS" --cols 3 --out "$O/s.png" >/dev/null
i=0
for t in ${TS//,/ }; do
  n=$(printf %03d $i)
  ffmpeg -loglevel error -y -ss "$t" -i "$REF" -frames:v 1 "$O/ref_$n.png"
  ffmpeg -loglevel error -y -i "$O/ref_$n.png" -i "$O/s-frames/$n.png" \
    -filter_complex "[0]scale=960:540[a];[1]scale=960:540[b];[a][b]hstack" "$O/pair_$n.png"
  ss=$(ffmpeg -i "$O/ref_$n.png" -i "$O/s-frames/$n.png" -filter_complex "[0]gblur=4[a];[1]gblur=4[b];[a][b]ssim" -f null - 2>&1 | grep -o 'All:[0-9.]*' || true)
  echo "t=$t $ss"
  i=$((i+1))
done
ffmpeg -loglevel error -y -i "$O/pair_%03d.png" -vf tile=1x$i -frames:v 1 "$O/pairs.png"
echo "→ $O/pairs.png"
