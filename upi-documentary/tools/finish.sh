#!/usr/bin/env bash
# Finishing pass: film grain + vignette (cheap here, expensive per-frame in the browser),
# then a high-quality YouTube master (H.264 High, 1080p30, ~16 Mbps VBR, AAC 320k).
#
# usage: tools/finish.sh video/out/render.mp4 video/out/upi_documentary_final.mp4 [patch.mp4@START_FRAME ...]
#
# Optional patches are re-rendered stretches (e.g. `npx remotion render Main out/p.mp4 --frames=5040-5505 --muted`)
# laid frame-exactly over the full render, so a fix never needs a full re-render.
set -euo pipefail
in="${1:?input render}"
out="${2:?output file}"
shift 2
inputs=(-i "$in")
graph=""
last="0:v"
i=1
for p in "$@"; do
  file="${p%@*}"
  start="${p##*@}"
  n=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$file")
  end=$((start + n - 1))
  inputs+=(-i "$file")
  graph+="[$i:v]setpts=PTS-STARTPTS+${start}/30/TB[p$i];[$last][p$i]overlay=eof_action=pass:enable='between(n,${start},${end})'[v$i];"
  last="v$i"
  echo "patch $file -> frames $start-$end"
  i=$((i + 1))
done
graph+="[$last]vignette=angle=PI/4.6:mode=forward,noise=c0s=4:c0f=t+u,format=yuv420p[vout]"
ffmpeg -y -hide_banner -loglevel warning -stats "${inputs[@]}" \
  -filter_complex "$graph" -map "[vout]" -map 0:a \
  -c:v libx264 -preset slow -profile:v high -level 4.2 -crf 17 -maxrate 16M -bufsize 32M \
  -g 15 -bf 2 -movflags +faststart \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -c:a aac -b:a 320k -ar 48000 \
  "$out"
ffprobe -v error -show_entries format=duration,size,bit_rate -of default=nw=1 "$out"
