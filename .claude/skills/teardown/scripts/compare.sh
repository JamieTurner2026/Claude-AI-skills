#!/usr/bin/env bash
# Remake loop helper. Two modes:
#   stills:  bash scripts/compare.sh stills SIM REF.mp4 OUTDIR 0.5,6,13,21
#            renders those times, pairs each with the reference (left: reference, right: remake),
#            prints blurred SSIM per pair and writes OUTDIR/pairs.png. Read the PNG every pass.
#   video:   bash scripts/compare.sh video REF.mp4 REMAKE.mp4 OUTDIR
#            per-second and all-frame blurred SSIM, plus OUTDIR/side-by-side.mp4 to send the user.
# Score = SSIM after scaling to 960x540 and gblur=4 (ignores encoder noise and 1 px offsets).
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mode="$1"; shift
SC="[0:v]scale=960:540,gblur=4[a];[1:v]scale=960:540,gblur=4[b];[a][b]"

if [ "$mode" = stills ]; then
  SIM="$1"; REF="$(realpath "$2")"; O="$(realpath -m "$3")"; TS="$4"
  node "$SKILL_DIR/sims/build.mjs" "$SIM" >/dev/null
  rm -rf "$O"; mkdir -p "$O"
  node "$SKILL_DIR/sims/capture.mjs" "$SIM" --size 1600x900 --dpr 1.2 --stills "$TS" --cols 3 --out "$O/s.png" >/dev/null
  i=0
  for t in ${TS//,/ }; do
    n=$(printf %03d $i)
    ffmpeg -loglevel error -y -ss "$t" -i "$REF" -frames:v 1 "$O/ref_$n.png"
    ffmpeg -loglevel error -y -i "$O/ref_$n.png" -i "$O/s-frames/$n.png" \
      -filter_complex "[0]scale=960:540[a];[1]scale=960:540[b];[a][b]hstack" "$O/pair_$n.png"
    ss=$(ffmpeg -i "$O/ref_$n.png" -i "$O/s-frames/$n.png" -filter_complex "${SC}ssim" -f null - 2>&1 | grep -o 'All:[0-9.]*' || true)
    echo "t=$t $ss"
    i=$((i+1))
  done
  ffmpeg -loglevel error -y -i "$O/pair_%03d.png" -vf tile=1x$i -frames:v 1 "$O/pairs.png"
  echo "→ $O/pairs.png"
elif [ "$mode" = video ]; then
  REF="$1"; M="$2"; O="$3"; mkdir -p "$O"
  ffmpeg -i "$REF" -i "$M" -filter_complex "[0:v]fps=1,scale=960:540,gblur=4[a];[1:v]fps=1,scale=960:540,gblur=4[b];[a][b]ssim=stats_file=$O/ssim_per_second.log" -f null - 2>/dev/null
  awk '{split($5,a,":"); printf "t=%-3d %s\n", NR-1, a[2]}' "$O/ssim_per_second.log" | paste - - - -
  echo "all frames: $(ffmpeg -i "$REF" -i "$M" -filter_complex "${SC}ssim" -f null - 2>&1 | grep -o 'All:[0-9.]*')"
  lab() { echo "scale=960:540,drawtext=text='$1':x=16:y=16:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6"; }
  ffmpeg -loglevel error -y -i "$REF" -i "$M" -filter_complex "[0:v]$(lab ORIGINAL)[a];[1:v]$(lab REMAKE)[b];[a][b]hstack" \
    -map 1:a? -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "$O/side-by-side.mp4"
  echo "→ $O/side-by-side.mp4"
else
  echo "usage: compare.sh stills SIM REF.mp4 OUTDIR T1,T2,...  |  compare.sh video REF.mp4 REMAKE.mp4 OUTDIR" >&2; exit 2
fi
