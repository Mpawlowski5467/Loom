#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
trailer_dir="$project_root/docs/trailer"
build_dir="$(mktemp -d /tmp/loom-trailer-build.XXXXXX)"
demo="$trailer_dir/loom-dynamic-demo.webm"

cleanup() {
  rm -rf "$build_dir"
}
trap cleanup EXIT

if [[ ! -f "$demo" ]]; then
  echo "Missing $demo. Run record_dynamic_demo.mjs against the live app first." >&2
  exit 1
fi

node "$trailer_dir/synthesize_music.mjs" "$build_dir/music.wav" 31
node "$trailer_dir/render_header_cards.mjs" "$build_dir/headers"

ffmpeg -y -framerate 50 -loop 1 -t 2.5 -i "$trailer_dir/title-card.png" \
  -vf "scale=1280:720,setsar=1,fps=50,format=yuv420p" -an "$build_dir/01-title.mp4"

ffmpeg -y -framerate 50 -loop 1 -t 3.4 -i "$build_dir/headers/00-intro.png" \
  -vf "scale=1280:720,setsar=1,fps=50,format=yuv420p" -an "$build_dir/02-intro.mp4"

# The capture is native 1280x720. Doubling its native 25 fps cadence to 50 fps
# avoids the uneven 25→30 frame duplication that made the old cut feel laggy.
ffmpeg -y -ss 2.8 -t 22.5 -i "$demo" \
  -i "$build_dir/headers/01-memory.png" \
  -i "$build_dir/headers/02-local.png" \
  -i "$build_dir/headers/03-connections.png" \
  -i "$build_dir/headers/04-agents.png" \
  -i "$build_dir/headers/05-control.png" \
  -filter_complex "
    [0:v]scale=1280:720,setsar=1,fps=50[base];
    [base][1:v]overlay=0:0:enable='between(t,0.8,4.6)'[h1];
    [h1][2:v]overlay=0:0:enable='between(t,4.9,8.2)'[h2];
    [h2][3:v]overlay=0:0:enable='between(t,8.5,12.5)'[h3];
    [h3][4:v]overlay=0:0:enable='between(t,12.8,17.5)'[h4];
    [h4][5:v]overlay=0:0:enable='between(t,17.8,22.5)',format=yuv420p[out]
  " \
  -map "[out]" \
  -an -c:v libx264 -preset medium -crf 19 "$build_dir/03-live.mp4"

ffmpeg -y -framerate 50 -loop 1 -t 2.8 -i "$trailer_dir/end-card.png" \
  -vf "scale=1280:720,setsar=1,fps=50,format=yuv420p" -an "$build_dir/04-end.mp4"

ffmpeg -y \
  -i "$build_dir/01-title.mp4" \
  -i "$build_dir/02-intro.mp4" \
  -i "$build_dir/03-live.mp4" \
  -i "$build_dir/04-end.mp4" \
  -filter_complex "
    [0:v][1:v]xfade=transition=fade:duration=0.4:offset=2.1[v1];
    [v1][2:v]xfade=transition=fade:duration=0.4:offset=5.1[v2];
    [v2][3:v]xfade=transition=fade:duration=0.4:offset=27.2[vout]
  " \
  -map "[vout]" -an -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p \
  "$build_dir/picture.mp4"

ffmpeg -y \
  -i "$build_dir/picture.mp4" \
  -i "$build_dir/music.wav" \
  -filter_complex "
    [1:a]atrim=0:30,afade=t=in:st=0:d=0.8,afade=t=out:st=28:d=2,volume=0.78,loudnorm=I=-17:LRA=9:TP=-1.5[aout]
  " \
  -map 0:v -map "[aout]" \
  -c:v copy -c:a aac -b:a 160k -ar 48000 -movflags +faststart \
  -t 30 "$trailer_dir/loom-trailer.mp4"
