#!/bin/sh
# Run from the integration worktree after every merge. Exits non-zero on any type error or failing test.
set -eu
cd "$(git rev-parse --show-toplevel)/extensions/pi-pstack"
npx tsc --noEmit -p tsconfig.json
log=$(mktemp)
status=0
npx vitest run --reporter=dot >"$log" 2>&1 || status=$?
tail -6 "$log"
grep -E "FAIL|×" "$log" | head -20 || true
rm -f "$log"
exit "$status"
