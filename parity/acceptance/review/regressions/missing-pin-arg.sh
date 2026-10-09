#!/usr/bin/env bash
# Regression: trailing --expect-manifest-sha256 with no value must non-zero exit.
set -euo pipefail
usage="usage: missing-pin-arg.sh <cursor-plugins checkout> <parity dir with evidence/>"
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

fail=0
run_case() {
	local name=$1
	shift
	set +e
	out=$(node "$tool" --reference-root "$reference_root" --parity-root "$parity_root" --acceptance-root "$work/acc" "$@" 2>&1)
	code=$?
	set -e
	if [ "$code" -eq 0 ]; then
		echo "RED $name: verifier accepted missing/empty/malformed pin"
		printf '%s\n' "$out" | sed 's/^/  /'
		fail=1
		return
	fi
	if ! grep -qiE 'expect-manifest-sha256|sha256 hex|pin' <<<"$out"; then
		echo "RED $name: non-zero but unexpected message"
		printf '%s\n' "$out" | sed 's/^/  /'
		fail=1
		return
	fi
	echo "ok $name rejected (exit $code)"
	printf '%s\n' "$out" | sed 's/^/  /'
}

run_case "missing-pin-value" --expect-manifest-sha256
run_case "empty-pin-value" --expect-manifest-sha256 ""
run_case "malformed-pin-value" --expect-manifest-sha256 "not-a-hash"

exit "$fail"
