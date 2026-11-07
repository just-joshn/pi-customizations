#!/bin/sh
# Usage: stage.sh <dir>. Copies the probes and the sandbox module from main (before) and from this worktree, or $AFTER,
# (after).
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
mkdir -p "$1/before" "$1/after"
cp "$here/check.ts" "$here/syscalls.py" "$here/checks.sh" "$here/guest-init.sh" "$1/"
git -C "$repo" show 0bb0d452:extensions/pi-pstack/src/linux-readonly-sandbox.ts > "$1/before/linux-readonly-sandbox.ts"
cp "${AFTER:-$repo/extensions/pi-pstack/src/linux-readonly-sandbox.ts}" "$1/after/linux-readonly-sandbox.ts"
