#!/usr/bin/env bash
# Regression: trailing newline / byte drift on record-hashes must fail against a pinned manifest.
set -euo pipefail
usage="usage: ledger-byte-drift.sh <cursor-plugins checkout> <parity dir with evidence/>"
reference_root=${1:?$usage}
parity_root=${2:?$usage}
acceptance_root=$(cd "$(dirname "$0")/../.." && pwd)
tool="$acceptance_root/tools/verify-acceptance.mjs"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp -R "$acceptance_root" "$work/acc"
pin=$(shasum -a 256 "$work/acc/MANIFEST.sha256" | cut -d' ' -f1)
printf '\n' >> "$work/acc/setup-pstack/record-hashes.json"

set +e
out=$(node "$tool" --reference-root "$reference_root" --parity-root "$parity_root" --acceptance-root "$work/acc" --expect-manifest-sha256 "$pin" 2>&1)
code=$?
set -e

if [ "$code" -eq 0 ]; then
	echo "RED ledger-byte-drift: verifier accepted drifted record-hashes against pin"
	printf '%s\n' "$out" | sed 's/^/  /'
	exit 1
fi
if ! grep -qF "setup-pstack/record-hashes.json" <<<"$out" && ! grep -qiE 'record-hashes|bytes do not match|byte' <<<"$out"; then
	echo "RED ledger-byte-drift: non-zero but unexpected message"
	printf '%s\n' "$out" | sed 's/^/  /'
	exit 1
fi
echo "ok ledger-byte-drift rejected (exit $code)"
printf '%s\n' "$out" | sed 's/^/  /'
