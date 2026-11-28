#!/usr/bin/env bash
# Score a split-screen remake against its reference.
#   stills: bash scripts/compare.sh stills SIM_DIR REF.mp4 OUTDIR 0.5,5,9.5
#           builds the sim, renders those times, writes OUTDIR/pairs.png (each row: reference | remake)
#           and prints blurred SSIM for the whole frame and for each panel.
#   video:  bash scripts/compare.sh video REF.mp4 REMAKE.mp4 OUTDIR
#           per-second SSIM (whole frame and per panel), all-frame SSIM, and OUTDIR/side-by-side.mp4.
# Panels default to the 1876x1030 layout: PANELS="A:900:900:30:100 B:900:900:946:100" (name:w:h:x:y).
# Score = SSIM after scaling (whole frame to 960 wide, panels to 450) and a Gaussian blur, so encoder noise
# and 1 px offsets do not count.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TEARDOWN="${TEARDOWN:-$HERE/../teardown}"
PANELS="${PANELS:-A:900:900:30:100 B:900:900:946:100}"
SIZE="${SIZE:-1876x1030}"
mode="$1"; shift

ssim() { # ref remake [crop]
  local crop="${3:-}"; local f
  if [ -n "$crop" ]; then IFS=: read -r _ w h x y <<< "$crop"; f="crop=$w:$h:$x:$y,scale=450:450,gblur=2";
  else f="scale=960:-2,gblur=4"; fi
  ffmpeg -i "$1" -i "$2" -filter_complex "[0:v]$f[a];[1:v]$f[b];[a][b]ssim" -f null - 2>&1 | grep -o 'All:[0-9.]*' | cut -d: -f2
}

if [ "$mode" = stills ]; then
  SIMDIR="$(realpath "$1")"; REF="$(realpath "$2")"; O="$(realpath -m "$3")"; TS="$4"
  SIM="$(basename "$SIMDIR")"
  node "$TEARDOWN/sims/build.mjs" "$SIMDIR" >/dev/null
  rm -rf "$O"; mkdir -p "$O"
  READY_TIMEOUT="${READY_TIMEOUT:-600000}" node "$TEARDOWN/sims/capture.mjs" "$SIM" --size "$SIZE" --dpr 1 --stills "$TS" --cols 1 --out "$O/s.png" >/dev/null
  i=0
  for t in ${TS//,/ }; do
    n=$(printf %03d $i)
    ffmpeg -loglevel error -y -ss "$t" -i "$REF" -frames:v 1 "$O/ref_$n.png"
    line="t=$t all=$(ssim "$O/ref_$n.png" "$O/s-frames/$n.png")"
    for p in $PANELS; do line="$line ${p%%:*}=$(ssim "$O/ref_$n.png" "$O/s-frames/$n.png" "$p")"; done
    echo "$line"
    ffmpeg -loglevel error -y -i "$O/ref_$n.png" -i "$O/s-frames/$n.png" -filter_complex "[0]scale=938:-2[a];[1]scale=938:-2[b];[a][b]hstack" "$O/pair_$n.png"
    i=$((i+1))
  done
  ffmpeg -loglevel error -y -i "$O/pair_%03d.png" -vf tile=1x$i -frames:v 1 "$O/pairs.png"
  echo "→ $O/pairs.png"
elif [ "$mode" = video ]; then
  REF="$1"; M="$2"; O="$3"; mkdir -p "$O"
  run() { # filter-label crop
    local f
    if [ -n "${2:-}" ]; then IFS=: read -r _ w h x y <<< "$2"; f="crop=$w:$h:$x:$y,scale=450:450,gblur=2"; else f="scale=960:-2,gblur=4"; fi
    ffmpeg -i "$REF" -i "$M" -filter_complex "[0:v]fps=1,$f[a];[1:v]fps=1,$f[b];[a][b]ssim=stats_file=$O/ssim_$1.log" -f null - 2>/dev/null
    echo "$1 per second: $(grep -o 'All:[0-9.]*' "$O/ssim_$1.log" | cut -d: -f2 | awk '{printf "%.3f ", $1}')"
    echo "$1 all frames: $(ffmpeg -i "$REF" -i "$M" -filter_complex "[0:v]$f[a];[1:v]$f[b];[a][b]ssim" -f null - 2>&1 | grep -o 'All:[0-9.]*' | cut -d: -f2)"
  }
  run frame
  for p in $PANELS; do run "${p%%:*}" "$p"; done
  lab() { echo "scale=938:-2,drawtext=text='$1':x=12:y=12:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=5"; }
  ffmpeg -loglevel error -y -i "$REF" -i "$M" -filter_complex "[0:v]$(lab ORIGINAL)[a];[1:v]$(lab REMAKE)[b];[a][b]vstack" \
    -map 1:a? -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "$O/side-by-side.mp4"
  echo "→ $O/side-by-side.mp4"
else
  echo "usage: compare.sh stills SIM_DIR REF.mp4 OUTDIR T1,T2,...  |  compare.sh video REF.mp4 REMAKE.mp4 OUTDIR" >&2; exit 2
fi
