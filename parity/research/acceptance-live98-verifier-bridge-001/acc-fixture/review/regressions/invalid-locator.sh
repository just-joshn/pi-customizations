#!/usr/bin/env bash
# Regression: locators like not-a-line must be rejected (positive ordered integer locators only).
set -euo pipefail
usage="usage: invalid-locator.sh <cursor-plugins checkout> <parity dir with evidence/>"
reference_root=${1:?$usage}
parity_root=${2:?$usage}
acceptance_root=$(cd "$(dirname "$0")/../.." && pwd)
tool="$acceptance_root/tools/verify-acceptance.mjs"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp -R "$acceptance_root" "$work/acc"
python3 - "$work/acc" <<'PY'
import json, pathlib, sys
acc = pathlib.Path(sys.argv[1])
defs = json.loads((acc / "setup-pstack" / "definitions.json").read_text())
base = next(d for d in defs["definitions"] if d["id"] == "ACC-SETUP-001")
clone = json.loads(json.dumps(base))
clone["id"] = "ACC-SETUP-BADLOC"
for source in clone["sources"]:
	source["lines"] = "not-a-line"
defs["definitions"].append(clone)
(acc / "setup-pstack" / "definitions.json").write_text(json.dumps(defs, indent=2) + "\n")
PY

set +e
out=$(node "$tool" --reference-root "$reference_root" --parity-root "$parity_root" --acceptance-root "$work/acc" --write-hashes 2>&1)
code=$?
set -e

if [ "$code" -eq 0 ]; then
	echo "RED invalid-locator: verifier accepted not-a-line locators"
	printf '%s\n' "$out" | sed 's/^/  /'
	exit 1
fi
if ! grep -qF "not-a-line" <<<"$out"; then
	echo "RED invalid-locator: non-zero but did not mention not-a-line"
	printf '%s\n' "$out" | sed 's/^/  /'
	exit 1
fi
echo "ok invalid-locator rejected (exit $code)"
printf '%s\n' "$out" | sed 's/^/  /'
