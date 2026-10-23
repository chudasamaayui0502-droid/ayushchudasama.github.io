#!/usr/bin/env bash
# Finishing pass: film grain + vignette (cheap here, expensive per-frame in the browser),
# then a high-quality YouTube master (H.264 High, 1080p30, ~16 Mbps VBR, AAC 320k).
#
# usage: tools/finish.sh video/out/render.mp4 video/out/upi_documentary_final.mp4
set -euo pipefail
in="${1:?input render}"
out="${2:?output file}"
ffmpeg -y -hide_banner -loglevel warning -stats -i "$in" \
  -vf "vignette=angle=PI/4.6:mode=forward,noise=c0s=4:c0f=t+u,format=yuv420p" \
  -c:v libx264 -preset slow -profile:v high -level 4.2 -crf 17 -maxrate 16M -bufsize 32M \
  -g 15 -bf 2 -movflags +faststart \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -c:a aac -b:a 320k -ar 48000 \
  "$out"
ffprobe -v error -show_entries format=duration,size,bit_rate -of default=nw=1 "$out"
