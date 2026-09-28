#!/usr/bin/env bash
# Compares package layouts by exporting the tracked tree to a scratch directory,
# turning it into a single Bun workspace, and installing there. Leaves the real
# checkout untouched. Run as:
#
#   bash .audit/bun-migration/probe-topology.sh                     # Bun's default linker
#   LINKER=hoisted bash .audit/bun-migration/probe-topology.sh       # explicit hoisted
#
# Output went to .audit/bun-migration/topology-probe-default.log and
# .audit/bun-migration/topology-probe-hoisted.log.
set -uo pipefail
SRC=${SRC:-$(cd "$(dirname "$0")/../.." && pwd)}
WORK=${WORK:-/tmp/bun-probe-${LINKER:-default}}
export PI_CODING_AGENT_DIR=/tmp/bun-probe-agent
rm -rf "$WORK"; mkdir -p "$WORK"

(cd "$SRC" && git ls-files -z | tar -cf - --null -T -) | tar -xf - -C "$WORK"
rm -f "$WORK"/extensions/*/package-lock.json

if [ -n "${LINKER:-}" ]; then
  printf "[install]\nlinker = \"%s\"\n" "$LINKER" > "$WORK/bunfig.toml"
fi

node -e '
const fs = require("node:fs");
const path = process.argv[1];
const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
pkg.workspaces = ["extensions/*"];
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
' "$WORK/package.json"

echo "=== bun install (linker=${LINKER:-default}) ==="
(cd "$WORK" && timeout 900 bun install 2>&1 | tail -25)
echo "EXIT=$?"

echo "=== lockfile ==="
ls -la "$WORK" | grep -i lock
echo "=== per-package node_modules presence ==="
for d in extensions/pi-anthropic-oauth extensions/pi-antigravity-oauth extensions/pi-one-dark-pro-theme extensions/pi-pstack extensions/pi-tui-parity; do
  if [ -d "$WORK/$d/node_modules" ]; then echo "PRESENT $d/node_modules"; else echo "ABSENT  $d/node_modules"; fi
done
echo "=== resolution probes ==="
for p in \
  "node_modules/@earendil-works/pi-coding-agent" \
  "node_modules/@earendil-works/pi-ai" \
  "node_modules/@earendil-works/pi-tui" \
  "node_modules/typebox" \
  "node_modules/vitest" \
  "node_modules/typescript" \
  "node_modules/@google/genai" \
  "extensions/pi-pstack/node_modules/@earendil-works/pi-coding-agent" \
  "extensions/pi-antigravity-oauth/node_modules/@earendil-works/pi-ai" \
  "extensions/pi-antigravity-oauth/node_modules/@google/genai" \
  "extensions/pi-tui-parity/node_modules" \
  "extensions/pi-pstack/node_modules/.bin/vitest" \
  "extensions/pi-tui-parity/node_modules/.bin/tsc" \
  "extensions/pi-pstack/node_modules/.bin/tsc" ; do
  if [ -e "$WORK/$p" ]; then echo "PRESENT $p"; else echo "ABSENT  $p"; fi
done
echo "=== tsc version seen from each extension ==="
for d in extensions/pi-anthropic-oauth extensions/pi-antigravity-oauth extensions/pi-one-dark-pro-theme extensions/pi-pstack extensions/pi-tui-parity; do
  printf "%-42s " "$d"; (cd "$WORK/$d" && timeout 120 bun run typecheck >/dev/null 2>&1 && echo "typecheck OK" || echo "typecheck FAIL")
done
echo "=== hoisted tsc version ==="
(cd "$WORK" && bunx tsc --version 2>&1 | tail -1)
