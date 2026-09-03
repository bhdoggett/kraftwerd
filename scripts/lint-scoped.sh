#!/usr/bin/env bash
#
# Lint the code this project actually maintains, and fail on a REGRESSION
# rather than on a count.
#
# Why this exists instead of `npm run lint`: that script is red on an untouched
# tree -- 58 errors, most of them `no-unnecessary-type-assertion` under src/,
# plus a parser error on vitest.config.ts that no source change can fix. A gate
# that is red before you start cannot tell you whether you broke something, so
# it gates nothing.
#
# The honest fix is to get `npm run lint` to zero and delete this file. Most of
# its errors are `--fix`-able. Until somebody does that, this is the gate: the
# three directories whose lint is actually clean-ish, held at a ceiling that
# may only ever go down.
#
# Lower CEILING whenever the real count drops. Never raise it to make a change
# pass -- that is the one move this file exists to prevent.
set -uo pipefail

CEILING=41

output=$(./node_modules/.bin/eslint shared convex scripts 2>&1) || true
echo "$output"

# eslint prints "✖ N problems (...)" only when there are any; no line means none.
count=$(printf '%s\n' "$output" | sed -n 's/^.*✖ \([0-9][0-9]*\) problems.*$/\1/p' | tail -1)
count=${count:-0}

if [ "$count" -gt "$CEILING" ]; then
  echo ""
  echo "FAIL: $count problems, ceiling is $CEILING. This change added $((count - CEILING))."
  exit 1
fi

if [ "$count" -lt "$CEILING" ]; then
  echo ""
  echo "$count problems, under the ceiling of $CEILING."
  echo "Lower CEILING in scripts/lint-scoped.sh to $count so the gain is locked in."
  exit 0
fi

echo ""
echo "$count problems, at the ceiling of $CEILING."
