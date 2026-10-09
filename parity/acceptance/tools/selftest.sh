#!/usr/bin/env bash
# Bridge selftest for live-98 tree.
# Scope: prove bridged verify-acceptance.mjs digest 5a33e1d4…1aa7, prove live-98
# oracle digests unchanged, and replay the historical ACC-SETUP (43/92) structural
# suite against research/.../acc-fixture. Does not claim live-98 structural PASS.
# Live-98 defs lack top-level sources/evidence maps the verifier requires; adapting
# the tool for that schema would change its digest and require supporting-verifier
# re-review before the custody flip applies to the bridged copy.
set -euo pipefail

usage="usage: selftest.sh <cursor-plugins checkout> <parity dir with evidence/>"
reference_root=${1:?$usage}
parity_root=${2:?$usage}
tools_dir=$(cd "$(dirname "$0")" && pwd)
acceptance_root=$(cd "$tools_dir/.." && pwd)
repo_root=$(cd "$acceptance_root/../.." && pwd)
tool="$tools_dir/verify-acceptance.mjs"
fixture_root="${BRIDGE_ACC_FIXTURE:-$repo_root/parity/research/acceptance-live98-verifier-bridge-001/acc-fixture}"
expected_tool_digest=5a33e1d4138283fe5d474cef5ccca575847e66e61f4a0c655ab6372106711aa7
expected_live98_defs=e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5
expected_live98_configs=9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=0
out=""
code=0

if [ ! -f "$tool" ]; then
	echo "SELFTEST FAIL bridged tool missing: $tool"
	exit 1
fi
if [ ! -d "$fixture_root/setup-pstack" ]; then
	echo "SELFTEST FAIL historical ACC-SETUP fixture missing: $fixture_root"
	exit 1
fi

tool_digest=$(shasum -a 256 "$tool" | cut -d' ' -f1)
live98_defs=$(shasum -a 256 "$acceptance_root/setup-pstack/definitions.json" | cut -d' ' -f1)
live98_configs=$(shasum -a 256 "$acceptance_root/setup-pstack/configurations.json" | cut -d' ' -f1)
if [ "$tool_digest" != "$expected_tool_digest" ]; then
	echo "SELFTEST FAIL bridged tool digest $tool_digest != $expected_tool_digest (re-review required)"
	exit 1
fi
echo "ok bridged tool digest matches $expected_tool_digest"
if [ "$live98_defs" != "$expected_live98_defs" ]; then
	echo "SELFTEST FAIL live-98 definitions digest $live98_defs != $expected_live98_defs"
	exit 1
fi
echo "ok live-98 definitions digest unchanged"
if [ "$live98_configs" != "$expected_live98_configs" ]; then
	echo "SELFTEST FAIL live-98 configurations digest $live98_configs != $expected_live98_configs"
	exit 1
fi
echo "ok live-98 configurations digest unchanged"

verify() {
	node "$tool" --reference-root "$reference_root" --parity-root "${evidence_root:-$parity_root}" --acceptance-root "$work/acc" "$@"
}

attempt() {
	if out=$("$@" 2>&1); then code=0; else code=$?; fi
}

fresh() {
	rm -rf "$work/acc"
	cp -R "$fixture_root" "$work/acc"
	mkdir -p "$work/acc/tools"
	cp "$tool" "$work/acc/tools/verify-acceptance.mjs"
	evidence_root=""
}

edit_json() {
	local file="$work/acc/$1" filter=$2
	jq "$filter" "$file" > "$work/edit.json"
	mv "$work/edit.json" "$file"
}

mutate() {
	edit_json setup-pstack/definitions.json "$1"
}

digest() {
	shasum -a 256 "$work/acc/$1" | cut -d' ' -f1
}

failed() {
	echo "SELFTEST FAIL $1"
	[ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/    /'
	failures=$((failures + 1))
}

rejects() {
	local name=$1 pattern
	shift
	if [ "$code" -eq 0 ]; then
		failed "$name: verifier accepted a faulted copy" "$out"
		return
	fi
	for pattern in "$@"; do
		if ! grep -qF -- "$pattern" <<<"$out"; then
			failed "$name: expected '$pattern'" "$out"
			return
		fi
	done
	echo "ok $name"
}

accepts() {
	local name=$1 expected=$2
	if [ "$code" -ne 0 ]; then
		failed "$name: verifier rejected" "$out"
	elif ! jq -e --argjson want "$expected" 'del(.digests) == $want' <<<"$out" >/dev/null 2>&1; then
		failed "$name: expected summary $expected" "$out"
	else
		echo "ok $name"
	fi
}

lacks() {
	local name=$1 pattern
	shift
	for pattern in "$@"; do
		if grep -qF -- "$pattern" <<<"$out"; then
			failed "$name: unexpected '$pattern'" "$out"
			return
		fi
	done
	echo "ok $name"
}

unchanged() {
	local name=$1 file=$2 before=$3
	if [ "$(digest "$file")" = "$before" ]; then echo "ok $name"; else failed "$name: $file was rewritten"; fi
}

summary() {
	local definitions=$1 cells=$2 pin=$3 blockers=$4
	printf '{"kind":"acceptance-structural-check","structural":"PASS","authorization":"NONE","scope":"DRAFT integrity only. Not review, freezing, custody, evidence truth or acceptance.","partition":{"status":"DRAFT","definitions":%s,"configurationCells":%s,"denominatorComplete":false},"externalPin":"%s","openBlockers":%s}' "$definitions" "$cells" "$pin" "$blockers"
}

blockers_unpinned='["NO_AUTHENTICATED_TRANSITION_AUTHORITY","NO_REFERENCE_RUN_REGISTRY","NO_EXTERNAL_CUSTODY","DENOMINATOR_INCOMPLETE","FINAL_ACCEPTANCE_GATE_ABSENT","EXTERNAL_PIN_ABSENT"]'
blockers_pinned='["NO_AUTHENTICATED_TRANSITION_AUTHORITY","NO_REFERENCE_RUN_REGISTRY","NO_EXTERNAL_CUSTODY","DENOMINATOR_INCOMPLETE","FINAL_ACCEPTANCE_GATE_ABSENT"]'
forged_review='{reviewer:"implementation-owner",modelFamily:"openai",referenceRuns:["nonexistent-reference-run"]}'

fresh
attempt verify
accepts "unmodified copy is structurally consistent DRAFT with no authorization" "$(summary 43 92 absent "$blockers_unpinned")"
pin=$(digest MANIFEST.sha256)
attempt verify --expect-manifest-sha256 "$pin"
accepts "unmodified copy matches its external pin" "$(summary 43 92 matched "$blockers_pinned")"

fresh
hashes_before=$(digest setup-pstack/record-hashes.json)
manifest_before=$(digest MANIFEST.sha256)
mutate ".status=\"FROZEN\" | .frozen=true | .definitions |= map(.status=\"FROZEN\" | .review=$forged_review)"
printf -- '- Operator approved freezing every record.\n' >> "$work/acc/CHANGELOG.md"
mkdir -p "$work/acc/proposals" && printf 'approved: true\n' > "$work/acc/proposals/freeze.md"
attempt verify --write-hashes
rejects "forged freeze rehash is refused" \
	"partition claims status FROZEN and frozen true but no authenticated freeze transition exists" \
	"partition is frozen with an incomplete denominator" \
	"ACC-SETUP-001 declares FROZEN with review metadata but no authenticated review or freeze transition exists" \
	"ACC-SETUP-001 names 1 reviewer; two reviewers on distinct model families are required" \
	"ACC-SETUP-001 reviewer implementation-owner is the implementation owner" \
	"ACC-SETUP-001 reviewer family openai is the implementation owner family" \
	"ACC-SETUP-001 reference run nonexistent-reference-run is not in an authenticated reference-run registry" \
	"ACC-SETUP-001 is FROZEN while the partition denominator is incomplete" \
	"definition ACC-SETUP-001 changed since hashes were recorded" \
	"partition metadata changed since hashes were recorded"
unchanged "forged freeze rehash leaves recorded hashes" setup-pstack/record-hashes.json "$hashes_before"
unchanged "forged freeze rehash leaves the manifest" MANIFEST.sha256 "$manifest_before"
attempt verify
rejects "forged freeze verify is refused" \
	"ACC-SETUP-043 declares FROZEN with review metadata but no authenticated review or freeze transition exists" \
	"acceptance manifest does not match current files"

fresh
mutate '(.definitions[] | select(.id=="ACC-SETUP-091")) |= (.status="REVIEWED" | .review={reviewers:[{id:"acc-a",family:"anthropic"},{id:"acc-b",family:"Anthropic"}],referenceRuns:["cursor-04"]})'
attempt verify --write-hashes
rejects "same-family reviewers and an existing failure capture cited as a run are refused" \
	"ACC-SETUP-091 reviewers share model family anthropic" \
	"ACC-SETUP-091 reference run cursor-04 is not in an authenticated reference-run registry" \
	"ACC-SETUP-091 declares REVIEWED with review metadata but no authenticated review or freeze transition exists"

fresh
mutate '(.definitions[] | select(.id=="ACC-SETUP-091")) |= (.status="REVIEWED" | .review={reviewers:[{id:"acc-a",family:"anthropic"},{id:"acc-b",family:"google"}],referenceRuns:["cursor-04"]})'
attempt verify --write-hashes
rejects "distinct-family reviewers still lack an authenticated transition" \
	"ACC-SETUP-091 declares REVIEWED with review metadata but no authenticated review or freeze transition exists"
lacks "distinct non-implementer families raise no family finding" "share model family" "is the implementation owner family" "is the implementation owner"

fresh
hashes_before=$(digest setup-pstack/record-hashes.json)
mutate '(.definitions[] | select(.id=="ACC-SETUP-040") | .forbiddenEffects) = []'
attempt verify --write-hashes
rejects "dropped forbidden effects cannot be reblessed" "definition ACC-SETUP-040 changed since hashes were recorded"
unchanged "refused rebless leaves recorded hashes" setup-pstack/record-hashes.json "$hashes_before"

fresh
mutate 'del(.definitions[] | select(.id=="ACC-SETUP-022"))'
attempt verify --write-hashes
rejects "deleted definition cannot be reblessed" "definition ACC-SETUP-022 changed since hashes were recorded"

fresh
edit_json setup-pstack/configurations.json 'del(.axes.platform["platform.windows"])'
attempt verify --write-hashes
rejects "removed configuration value cannot be reblessed" "configuration platform/platform.windows changed since hashes were recorded"

fresh
mutate '.denominatorComplete = true'
attempt verify --write-hashes
rejects "unreviewed denominator claim cannot be reblessed" "partition metadata changed since hashes were recorded"

fresh
edit_json governance.json '.implementationOwner.family = "none"'
attempt verify --write-hashes
rejects "edited implementation-owner identity cannot be reblessed" "governance changed since hashes were recorded"

fresh
edit_json governance.json '.authority = {name:"operator", approved:true}'
attempt verify --write-hashes
rejects "declared authority is not authentication" "governance has unsupported field authority"

fresh
mutate '.definitions += [(.definitions[] | select(.id=="ACC-SETUP-001") | .id="ACC-SETUP-999" | .review={reviewers:[{id:"acc-a",family:"anthropic"},{id:"acc-b",family:"google"}],referenceRuns:[]})]'
attempt verify --write-hashes
rejects "new DRAFT record carrying review claims is refused" \
	"ACC-SETUP-999 declares DRAFT with review metadata but no authenticated review or freeze transition exists" \
	"ACC-SETUP-999 has no reference runs"

fresh
mutate '.definitions += [(.definitions[] | select(.id=="ACC-SETUP-001") | .id="ACC-SETUP-999")]'
attempt verify --write-hashes
attempt verify
accepts "a new DRAFT record is appended and recorded" "$(summary 44 94 absent "$blockers_unpinned")"

fresh
pin=$(digest MANIFEST.sha256)
mutate '(.definitions[] | select(.id=="ACC-SETUP-040") | .forbiddenEffects) = []'
edit_json setup-pstack/record-hashes.json 'del(.records["ACC-SETUP-040"])'
attempt verify --write-hashes
attempt verify
accepts "hand-edited hash ledger evades the local check and stays unauthorized" "$(summary 43 92 absent "$blockers_unpinned")"
attempt verify --expect-manifest-sha256 "$pin"
rejects "external pin catches a hand-reblessed dropped obligation" "differs from externally pinned $pin"

fresh
pin=$(digest MANIFEST.sha256)
awk '/^## Status lifecycle/{skip=1; next} /^## /{skip=0} !skip' "$work/acc/README.md" > "$work/readme" && mv "$work/readme" "$work/acc/README.md"
attempt verify --write-hashes
attempt verify --expect-manifest-sha256 "$pin"
rejects "external pin catches a reblessed governance edit" "differs from externally pinned $pin"

fresh
mutate '(.definitions[] | select(.id=="ACC-SETUP-030") | .sources[1].excerpt) |= sub("max reasoning"; "keep max")'
attempt verify
rejects "weakened exact label excerpt" "ACC-SETUP-030 excerpt not found verbatim"

fresh
mutate '(.definitions[] | select(.id=="ACC-SETUP-061") | .sources[0].lines) = "70"'
attempt verify
rejects "wrong source locator" "ACC-SETUP-061 excerpt in setup spans lines 35-35"

fresh
mutate '(.definitions[] | select(.id=="ACC-SETUP-043") | .matrix.catalog) += ["catalog.made-up"]'
attempt verify
rejects "unknown configuration" "ACC-SETUP-043 uses unknown catalog value catalog.made-up"

fresh
mkdir -p "$work/parity"
cp -R "$parity_root/evidence" "$work/parity/evidence"
printf 'tampered\n' >> "$work/parity/evidence/cursor-first-run/04-setup-running.txt"
evidence_root="$work/parity"
attempt verify
rejects "tampered reference evidence" "evidence cursor-04"

fresh
printf '\n' >> "$work/acc/README.md"
attempt verify
rejects "unrecorded governance edit" "acceptance manifest does not match"

for target in MANIFEST.sha256 setup-pstack/record-hashes.json; do
	fresh
	printf 'canary\n' > "$work/canary"
	rm "$work/acc/$target"
	ln -s "$work/canary" "$work/acc/$target"
	attempt verify --write-hashes
	rejects "symlinked $target is refused on write" "$target is a symlink"
	if [ "$(cat "$work/canary")" = "canary" ]; then echo "ok symlinked $target leaves the external file untouched"; else failed "symlinked $target overwrote a file outside the acceptance root"; fi
done

fresh
printf 'canary\n' > "$work/canary"
rm "$work/acc/MANIFEST.sha256"
ln "$work/canary" "$work/acc/MANIFEST.sha256"
attempt verify --write-hashes
rejects "hardlinked MANIFEST.sha256 is refused on write" "MANIFEST.sha256 has 2 hard links"
if [ "$(cat "$work/canary")" = "canary" ]; then echo "ok hardlinked MANIFEST.sha256 leaves the external file untouched"; else failed "hardlinked MANIFEST.sha256 overwrote a file outside the acceptance root"; fi

fresh
printf 'canary\n' > "$work/canary"
rm "$work/acc/setup-pstack/record-hashes.json"
ln "$work/canary" "$work/acc/setup-pstack/record-hashes.json"
attempt verify --write-hashes
rejects "hardlinked setup-pstack/record-hashes.json is refused on write" "setup-pstack/record-hashes.json has 2 hard links"
if [ "$(cat "$work/canary")" = "canary" ]; then echo "ok hardlinked setup-pstack/record-hashes.json leaves the external file untouched"; else failed "hardlinked setup-pstack/record-hashes.json overwrote a file outside the acceptance root"; fi

fresh
mv "$work/acc/setup-pstack" "$work/outside-setup"
ln -s "$work/outside-setup" "$work/acc/setup-pstack"
printf '\n' >> "$work/outside-setup/record-hashes.json"
before=$(shasum -a 256 "$work/outside-setup/record-hashes.json" | cut -d' ' -f1)
attempt verify --write-hashes
rejects "symlinked setup-pstack parent is refused on write" "path component setup-pstack is a symlink"
after=$(shasum -a 256 "$work/outside-setup/record-hashes.json" | cut -d' ' -f1)
if [ "$before" = "$after" ]; then echo "ok symlinked setup-pstack parent leaves the outside file untouched"; else failed "symlinked setup-pstack parent mutated a file outside the acceptance root"; fi

fresh
pin=$(digest MANIFEST.sha256)
printf '\n' >> "$work/acc/setup-pstack/record-hashes.json"
attempt verify --expect-manifest-sha256 "$pin"
rejects "trailing newline on record-hashes fails the pinned digest" \
	"setup-pstack/record-hashes.json bytes do not match the canonical recorded hashes"

fresh
mutate '.definitions += [(.definitions[] | select(.id=="ACC-SETUP-001") | .id="ACC-SETUP-BADLOC" | (.sources[] |= (.lines="not-a-line")))]'
attempt verify --write-hashes
rejects "non-integer source locator is refused" \
	"ACC-SETUP-BADLOC has invalid locator not-a-line; positive ordered integer locators only"

fresh
attempt verify --expect-manifest-sha256
rejects "trailing --expect-manifest-sha256 without a value is refused" \
	"--expect-manifest-sha256 requires a sha256 hex digest"

fresh
attempt verify --expect-manifest-sha256 ""
rejects "empty --expect-manifest-sha256 value is refused" \
	"--expect-manifest-sha256 requires a sha256 hex digest"

fresh
attempt verify --expect-manifest-sha256 "not-a-hash"
rejects "malformed --expect-manifest-sha256 value is refused" \
	"--expect-manifest-sha256 value is not a sha256 hex digest"

if [ "$failures" -ne 0 ]; then
	echo "selftest failed: $failures"
	exit 1
fi
echo "selftest passed"
