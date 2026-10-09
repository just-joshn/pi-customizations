#!/usr/bin/env bash
# Regression: symlinked setup-pstack parent must be refused before write; outside bytes untouched.
set -euo pipefail
usage="usage: symlinked-output-parent.sh <cursor-plugins checkout> <parity dir with evidence/>"
reference_root=${1:?$usage}
parity_root=${2:?$usage}
live_acceptance=$(cd "$(dirname "$0")/../.." && pwd)
tool="$live_acceptance/tools/verify-acceptance.mjs"
repo_root=$(cd "$live_acceptance/../.." && pwd)
tree_root="${BRIDGE_ACC_FIXTURE:-$repo_root/parity/research/acceptance-live98-verifier-bridge-001/acc-fixture}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ ! -f "$tool" ]; then
	echo "RED bridged tool missing: $tool"
	exit 1
fi
if [ ! -d "$tree_root/setup-pstack" ]; then
	echo "RED historical fixture missing: $tree_root"
	exit 1
fi
cp -R "$tree_root" "$work/acc"
mv "$work/acc/setup-pstack" "$work/outside-setup"
ln -s "$work/outside-setup" "$work/acc/setup-pstack"
printf '\n' >> "$work/outside-setup/record-hashes.json"
before=$(shasum -a 256 "$work/outside-setup/record-hashes.json" | cut -d' ' -f1)

set +e
out=$(node "$tool" --reference-root "$reference_root" --parity-root "$parity_root" --acceptance-root "$work/acc" --write-hashes 2>&1)
code=$?
set -e
after=$(shasum -a 256 "$work/outside-setup/record-hashes.json" | cut -d' ' -f1)

if [ "$code" -eq 0 ]; then
	echo "RED symlinked-output-parent: verifier accepted a symlinked setup-pstack parent"
	printf '%s\n' "$out" | sed 's/^/  /'
	exit 1
fi
if ! grep -qF "path component setup-pstack is a symlink" <<<"$out"; then
	echo "RED symlinked-output-parent: non-zero but unexpected message"
	printf '%s\n' "$out" | sed 's/^/  /'
	exit 1
fi
if [ "$before" != "$after" ]; then
	echo "RED symlinked-output-parent: outside record-hashes was mutated"
	exit 1
fi
echo "ok symlinked-output-parent rejected (exit $code), outside unchanged"
printf '%s\n' "$out" | sed 's/^/  /'
