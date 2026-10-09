#!/usr/bin/env bash
# Regression: hardlinked MANIFEST.sha256 must be refused before write; outside canary untouched.
set -euo pipefail
usage="usage: hardlinked-output.sh <cursor-plugins checkout> <parity dir with evidence/>"
reference_root=${1:?$usage}
parity_root=${2:?$usage}
acceptance_root=$(cd "$(dirname "$0")/../.." && pwd)
tool="$acceptance_root/tools/verify-acceptance.mjs"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp -R "$acceptance_root" "$work/acc"
printf 'HARDLINK_CANARY\n' > "$work/canary"
before=$(shasum -a 256 "$work/canary" | cut -d' ' -f1)
rm "$work/acc/MANIFEST.sha256"
ln "$work/canary" "$work/acc/MANIFEST.sha256"

set +e
out=$(node "$tool" --reference-root "$reference_root" --parity-root "$parity_root" --acceptance-root "$work/acc" --write-hashes 2>&1)
code=$?
set -e
after=$(shasum -a 256 "$work/canary" | cut -d' ' -f1)

if [ "$code" -eq 0 ]; then
	echo "RED hardlinked-output: verifier accepted a hardlinked MANIFEST.sha256"
	printf '%s\n' "$out" | sed 's/^/  /'
	exit 1
fi
if ! grep -qF "hard links" <<<"$out"; then
	echo "RED hardlinked-output: non-zero but unexpected message"
	printf '%s\n' "$out" | sed 's/^/  /'
	exit 1
fi
if [ "$before" != "$after" ]; then
	echo "RED hardlinked-output: outside canary was mutated"
	exit 1
fi
echo "ok hardlinked-output rejected (exit $code), canary unchanged"
printf '%s\n' "$out" | sed 's/^/  /'
