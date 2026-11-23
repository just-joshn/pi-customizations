#!/bin/sh
set -eu

ROOT=$(git rev-parse --show-toplevel)
PKG="$ROOT/extensions/no-ceilings/pi-subagents"

command -v pi >/dev/null 2>&1 || { echo "DOCTOR FAIL: pi is not on PATH" >&2; exit 1; }
command -v bun >/dev/null 2>&1 || { echo "DOCTOR FAIL: bun is not on PATH" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "DOCTOR FAIL: node is not on PATH" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "DOCTOR FAIL: git is not on PATH" >&2; exit 1; }

test -f "$PKG/src/index.ts" || { echo "DOCTOR FAIL: missing $PKG/src/index.ts" >&2; exit 1; }
test -f "$PKG/test/e2e/verify-delegation-fake-model.mjs" || { echo "DOCTOR FAIL: missing fake-model e2e" >&2; exit 1; }

NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "DOCTOR FAIL: Node $NODE_MAJOR is older than 22" >&2
  exit 1
fi

cd "$PKG"
bun x tsc --noEmit -p tsconfig.json

printf 'DOCTOR OK: pi=%s node=%s package=%s\n' "$(command -v pi)" "$(node -p 'process.versions.node')" "$PKG"
