#!/usr/bin/env bash
# Commit the data files this run regenerated and push them to main.
#
# If main moved on meanwhile (a code change was merged, or the weekly
# re-test finished first), put just the files this run changed on top of
# the new main and try again, so nothing newer is ever undone.
set -euo pipefail

paths=(stocks/data screener/nifty100_fallback.csv screener/nifty500_fallback.csv)
msg="Update stock signals for $(TZ=Asia/Kolkata date +%Y-%m-%d)"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add -A -- "${paths[@]}"
mapfile -t changed < <(git diff --cached --name-only --diff-filter=AM)
if [ "${#changed[@]}" -eq 0 ]; then
  echo "No changes to publish"
  exit 0
fi
echo "Publishing: ${changed[*]}"
saved="$(mktemp -d)"
for f in "${changed[@]}"; do
  mkdir -p "$saved/$(dirname "$f")"
  cp "$f" "$saved/$f"
done

for attempt in 1 2 3 4 5; do
  git commit -q -m "$msg"
  if git push -q origin HEAD:main; then
    echo "Published"
    exit 0
  fi
  echo "main moved on; retrying on top of it (attempt $attempt)"
  sleep $((attempt * 3))
  git fetch -q --depth=1 origin main
  git reset -q --hard FETCH_HEAD
  for f in "${changed[@]}"; do
    mkdir -p "$(dirname "$f")"
    cp "$saved/$f" "$f"
  done
  git add -- "${changed[@]}"
  if git diff --cached --quiet; then
    echo "main already has this data"
    exit 0
  fi
done
echo "Could not publish after 5 attempts" >&2
exit 1
