#!/usr/bin/env bash
# Rebuilds this run's comparison and inventory from a cursor/plugins checkout at the pinned revision.
# Usage: parity/pstack-parity-2026-11-05/rebuild.sh <cursor-plugins-checkout>
# Get the checkout with:
#   curl -sSL -o plugins.tar.gz https://codeload.github.com/cursor/plugins/tar.gz/bb68f2365eceafa0cb2d253112f675acf5f144cc
#   tar xzf plugins.tar.gz
set -euo pipefail
reference=${1:?usage: rebuild.sh <cursor-plugins-checkout>}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
audit="$repo/.audit/pstack-parity-2026-11-05"
mkdir -p "$audit"
cd "$repo"
node "$here/tree-diff.mjs" "$reference" extensions/pi-pstack "$audit/tree-diff.json"
node "$here/host-references.mjs" "$reference" "$here/host-references.json"
node "$here/classify-adaptations.mjs" "$reference" extensions/pi-pstack "$audit/tree-diff.json" "$audit/adaptation-hunks.json"
node "$here/review-verdicts.mjs" "$audit/adaptation-hunks.json" "$here/review-verdicts.tsv"
node "$here/build-inventory.mjs" "$reference" extensions/pi-pstack "$audit" "$here"
npx biome format --write "$here" >/dev/null
