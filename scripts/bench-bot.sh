#!/usr/bin/env bash
#
# Drive bot games on the development deployment and print what a turn costs.
#
#   ./scripts/bench-bot.sh <tag> [games]
#
# `tag` names the sweep row -- it is written to each game so the figures can be
# read back afterwards. Change a knob in convex/bots.ts, push, run this, and
# compare rows.
#
# What it reports:
#   THINK        how long the search took, before the pause absorbs it. This is
#                the number that matters: see THINKING_MS in convex/bots.ts.
#                `over1600` counts the turns a person actually waited on.
#   squares/game 3x3-and-larger blocks completed per game -- what the widening
#                is for. Noisy: read a difference of one a game as noise unless
#                you have run thirty games or more.
#
# Requires DEV_TOOLS=1 on the deployment, and reads the log stream live --
# `convex logs --history` comes back stale and silently gives nothing.
set -euo pipefail

cd "$(dirname "$0")/.."
TAG=${1:?usage: bench-bot.sh <tag> [games]}
GAMES=${2:-28}
CONVEX=./node_modules/.bin/convex
LOG=$(mktemp -t kraftwerd-bench)

# The stream has to be open before the turns are driven, or their lines are
# simply not in it.
"$CONVEX" logs --jsonl > "$LOG" 2>/dev/null &
STREAM=$!
trap 'kill $STREAM 2>/dev/null || true' EXIT
sleep 2

MARK=$(python3 -c 'import time; print(time.time())')
"$CONVEX" run --no-push bench:wholeGame "{\"games\": $GAMES, \"tag\": \"$TAG\"}" >/dev/null

# Games finish when the log stops growing, which beats guessing at a duration:
# a game is about 26 turns and every turn holds the 1.6s pause.
prev=-1; same=0
while [ $same -lt 3 ]; do
  sleep 10
  n=$(grep -c 'bots:takeTurn' "$LOG" || true)
  if [ "$n" = "$prev" ]; then same=$((same + 1)); else same=0; fi
  prev=$n
done

echo "=== $TAG ($GAMES games) ==="
python3 scripts/bench-report.py "$LOG" "$MARK"
"$CONVEX" run --no-push bench:squares "{\"tag\": \"$TAG\"}"
