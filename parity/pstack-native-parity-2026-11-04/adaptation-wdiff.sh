#!/usr/bin/env bash
# Word diff of every reference file the package changed, from tree-diff.json. Usage: adaptation-wdiff.sh <plugins checkout> <pi-pstack dir>
set -euo pipefail
plugins="${1:?plugins checkout}"
pkg="${2:?pi-pstack dir}"
here="$(dirname "$0")"
node -e 'for (const m of require(process.argv[1]).modified) console.log(m.split(" ")[0])' "$here/tree-diff.json" | while read -r f; do
	t=$(printf '%s' "$f" | sed -E 's#^pstack/(skills|agents|automations|docs/guide|assets)/#\1/#; s#^cursor-team-kit/(skills|agents)/#\1/#; s#^pstack/README.md$#README.md#')
	printf '=== %s\n' "$f"
	git diff --no-index -U0 --word-diff=plain --word-diff-regex='[^[:space:]]+' "$plugins/$f" "$pkg/$t" | grep -vE '^(diff --git|index |--- |\+\+\+ |@@)' || true
done
