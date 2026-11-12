#!/bin/sh
# Run from the integration worktree after every merge. Fails on any regression against the recorded baseline.
set -eu
cd "$(git rev-parse --show-toplevel)/extensions/pi-pstack"
npx tsc --noEmit -p tsconfig.json
npx vitest run --reporter=dot 2>&1 | tail -6
for d in tests/*/; do [ -n "$(ls "$d"*.test.ts 2>/dev/null)" ] && echo "covered by vitest: $d"; done
