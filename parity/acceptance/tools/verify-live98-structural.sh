#!/usr/bin/env bash
# Structural verify path for live-98 DRAFT oracles without mutating them and
# without editing byte-identical verify-acceptance.mjs (digest 5a33e1d4…1aa7).
#
# 1) Assert oracle digests unchanged.
# 2) Project live-98 into a disposable ACC-SETUP-shaped package.
# 3) Write hashes and run the reviewed verifier against that package.
# Authorization remains NONE. No freeze.
set -euo pipefail

usage="usage: verify-live98-structural.sh <cursor-plugins checkout> <parity dir with evidence/>"
reference_root=${1:?$usage}
parity_root=${2:?$usage}
tools_dir=$(cd "$(dirname "$0")" && pwd)
acceptance_root=$(cd "$tools_dir/.." && pwd)
repo_root=$(cd "$acceptance_root/../.." && pwd)
research="$repo_root/parity/research/acceptance-live98-schema-001"
tool="$tools_dir/verify-acceptance.mjs"
projector="$tools_dir/project-live98-for-verify.mjs"
projected="$research/projected-acc"
parity_out="$research/parity-root"
expected_tool_digest=5a33e1d4138283fe5d474cef5ccca575847e66e61f4a0c655ab6372106711aa7
expected_live98_defs=e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5
expected_live98_configs=9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e

tool_digest=$(shasum -a 256 "$tool" | cut -d' ' -f1)
live98_defs=$(shasum -a 256 "$acceptance_root/setup-pstack/definitions.json" | cut -d' ' -f1)
live98_configs=$(shasum -a 256 "$acceptance_root/setup-pstack/configurations.json" | cut -d' ' -f1)
if [ "$tool_digest" != "$expected_tool_digest" ]; then
	echo "VERIFY-LIVE98 FAIL tool digest $tool_digest != $expected_tool_digest (re-review required)"
	exit 1
fi
if [ "$live98_defs" != "$expected_live98_defs" ]; then
	echo "VERIFY-LIVE98 FAIL definitions digest $live98_defs != $expected_live98_defs"
	exit 1
fi
if [ "$live98_configs" != "$expected_live98_configs" ]; then
	echo "VERIFY-LIVE98 FAIL configurations digest $live98_configs != $expected_live98_configs"
	exit 1
fi

mkdir -p "$research"
node "$projector" \
	--reference-root "$reference_root" \
	--parity-root "$parity_root" \
	--out "$projected" \
	--parity-out "$parity_out" \
	--gap-out "$research/schema-gap.json"

# Hash files must exist as regular unlinked files before write mode.
printf '' >"$projected/MANIFEST.sha256"
printf '%s\n' '{"records":{},"metadata":{}}' >"$projected/setup-pstack/record-hashes.json"

node "$tool" \
	--reference-root "$reference_root" \
	--parity-root "$parity_out" \
	--acceptance-root "$projected" \
	--write-hashes

summary=$(node "$tool" \
	--reference-root "$reference_root" \
	--parity-root "$parity_out" \
	--acceptance-root "$projected")

echo "$summary" | tee "$research/live98-structural-verify.json"
auth=$(echo "$summary" | jq -r .authorization)
structural=$(echo "$summary" | jq -r .structural)
if [ "$auth" != "NONE" ]; then
	echo "VERIFY-LIVE98 FAIL authorization $auth != NONE"
	exit 1
fi
if [ "$structural" != "PASS" ]; then
	echo "VERIFY-LIVE98 FAIL structural $structural"
	exit 1
fi

# Re-check oracles were not rewritten by projection or verify.
live98_defs_after=$(shasum -a 256 "$acceptance_root/setup-pstack/definitions.json" | cut -d' ' -f1)
live98_configs_after=$(shasum -a 256 "$acceptance_root/setup-pstack/configurations.json" | cut -d' ' -f1)
tool_after=$(shasum -a 256 "$tool" | cut -d' ' -f1)
if [ "$live98_defs_after" != "$expected_live98_defs" ] || [ "$live98_configs_after" != "$expected_live98_configs" ]; then
	echo "VERIFY-LIVE98 FAIL oracle digests changed during verify path"
	exit 1
fi
if [ "$tool_after" != "$expected_tool_digest" ]; then
	echo "VERIFY-LIVE98 FAIL tool digest changed during verify path"
	exit 1
fi

echo "ok live-98 structural verify PASS authorization=NONE"
echo "ok oracle digests unchanged"
echo "ok tool digest unchanged $expected_tool_digest"
