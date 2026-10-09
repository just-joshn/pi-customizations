#!/usr/bin/env bash
set -euo pipefail

owner=${OWNER:-/private/tmp/pi-pstack-parity-acceptance-owner}
reference=${REFERENCE:-/Users/josh-desktop/src/experiments/plugins}
parity=${PARITY:-/Users/josh-desktop/src/personal/pi-pstack-parity-again/parity}
research=${RESEARCH:-/Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/research/acceptance-verifier-rereview-002}
acceptance="$owner/parity/acceptance"
tool="$acceptance/tools/verify-acceptance.mjs"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$research"
printf 'attack\texit\tbefore\tafter\tchanged\tverdict\n' > "$research/attack-results.tsv"

digest() {
	shasum -a 256 "$1" | cut -d' ' -f1
}

run_verifier() {
	local root=$1 output=$2
	set +e
	node "$tool" \
		--reference-root "$reference" \
		--parity-root "$parity" \
		--acceptance-root "$root" \
		--write-hashes > "$output" 2>&1
	code=$?
	set -e
}

record() {
	local name=$1 code=$2 before=$3 after=$4 verdict=$5 changed=no
	if [ "$before" != "$after" ]; then changed=yes; fi
	printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$code" "$before" "$after" "$changed" "$verdict" >> "$research/attack-results.tsv"
}

shasum -a 256 \
	"$tool" \
	"$acceptance/tools/selftest.sh" \
	"$acceptance/MANIFEST.sha256" \
	"$acceptance/setup-pstack/definitions.json" \
	"$acceptance/setup-pstack/configurations.json" \
	"$acceptance/setup-pstack/record-hashes.json" > "$research/artifact-sha256.txt"

set +e
sh "$acceptance/tools/selftest.sh" "$reference" "$parity" > "$research/full-selftest.txt" 2>&1
selftest_code=$?
set -e
printf '%s\n' "$selftest_code" > "$research/full-selftest.exit"
test "$selftest_code" -eq 0

set +e
sh "$parity/research/acceptance-verifier-containment-001/replay-green.sh" > "$research/green-harness.txt" 2>&1
green_code=$?
set -e
printf '%s\n' "$green_code" > "$research/green-harness.exit"
test "$green_code" -eq 0

pin=$(digest "$acceptance/MANIFEST.sha256")
set +e
node "$tool" \
	--reference-root "$reference" \
	--parity-root "$parity" \
	--expect-manifest-sha256 "$pin" > "$research/clean-verify.json" 2> "$research/clean-verify.stderr"
clean_code=$?
set -e
printf '%s\n' "$clean_code" > "$research/clean-verify.exit"
test "$clean_code" -eq 0
jq -e '.structural == "PASS" and .authorization == "NONE" and .externalPin == "matched"' "$research/clean-verify.json" >/dev/null

cp -R "$acceptance" "$work/parent-link"
mv "$work/parent-link/setup-pstack" "$work/outside-setup"
ln -s "$work/outside-setup" "$work/parent-link/setup-pstack"
printf '\n' >> "$work/outside-setup/record-hashes.json"
before=$(digest "$work/outside-setup/record-hashes.json")
run_verifier "$work/parent-link" "$research/attack-symlinked-output-parent.txt"
after=$(digest "$work/outside-setup/record-hashes.json")
test "$code" -ne 0
test "$before" = "$after"
record symlinked-output-parent "$code" "$before" "$after" refused

cp -R "$acceptance" "$work/hardlink"
printf 'HARDLINK_CANARY\n' > "$work/hardlink-canary"
rm "$work/hardlink/MANIFEST.sha256"
ln "$work/hardlink-canary" "$work/hardlink/MANIFEST.sha256"
before=$(digest "$work/hardlink-canary")
run_verifier "$work/hardlink" "$research/attack-hardlinked-manifest.txt"
after=$(digest "$work/hardlink-canary")
test "$code" -ne 0
test "$before" = "$after"
record hardlinked-manifest "$code" "$before" "$after" refused

for target in MANIFEST.sha256 setup-pstack/record-hashes.json; do
	name=$(printf '%s' "$target" | tr '/' '-')
	cp -R "$acceptance" "$work/final-$name"
	printf 'FINAL_CANARY_%s\n' "$name" > "$work/final-canary-$name"
	rm "$work/final-$name/$target"
	ln -s "$work/final-canary-$name" "$work/final-$name/$target"
	before=$(digest "$work/final-canary-$name")
	run_verifier "$work/final-$name" "$research/attack-final-symlink-$name.txt"
	after=$(digest "$work/final-canary-$name")
	test "$code" -ne 0
	test "$before" = "$after"
	record "final-symlink-$name" "$code" "$before" "$after" refused
done

cp -R "$acceptance" "$work/traversal"
mkdir "$work/outside-traversal"
printf 'TRAVERSAL_CANARY\n' > "$work/outside-traversal/canary"
ln -s "$work/outside-traversal" "$work/traversal/traversal-link"
before=$(digest "$work/outside-traversal/canary")
manifest_before=$(digest "$work/traversal/MANIFEST.sha256")
records_before=$(digest "$work/traversal/setup-pstack/record-hashes.json")
run_verifier "$work/traversal" "$research/attack-directory-symlink-traversal.txt"
after=$(digest "$work/outside-traversal/canary")
test "$code" -ne 0
test "$before" = "$after"
test "$manifest_before" = "$(digest "$work/traversal/MANIFEST.sha256")"
test "$records_before" = "$(digest "$work/traversal/setup-pstack/record-hashes.json")"
record directory-symlink-traversal "$code" "$before" "$after" refused

cp -R "$acceptance" "$work/outside-root"
printf 'ROOT_SYMLINK_CANARY\n' > "$work/outside-root/MANIFEST.sha256"
ln -s "$work/outside-root" "$work/root-link"
before=$(digest "$work/outside-root/MANIFEST.sha256")
run_verifier "$work/root-link" "$research/attack-symlinked-acceptance-root.txt"
after=$(digest "$work/outside-root/MANIFEST.sha256")
test "$code" -eq 0
test "$before" != "$after"
record symlinked-acceptance-root "$code" "$before" "$after" escaped

mkdir "$work/outside-parent"
cp -R "$acceptance" "$work/outside-parent/acceptance"
printf 'ROOT_ANCESTOR_CANARY\n' > "$work/outside-parent/acceptance/MANIFEST.sha256"
ln -s "$work/outside-parent" "$work/parent-alias"
before=$(digest "$work/outside-parent/acceptance/MANIFEST.sha256")
run_verifier "$work/parent-alias/acceptance" "$research/attack-symlinked-root-ancestor.txt"
after=$(digest "$work/outside-parent/acceptance/MANIFEST.sha256")
test "$code" -eq 0
test "$before" != "$after"
record symlinked-root-ancestor "$code" "$before" "$after" escaped

printf 'selftest_exit=%s\ngreen_harness_exit=%s\nclean_verify_exit=%s\nmanifest_pin=%s\n' \
	"$selftest_code" "$green_code" "$clean_code" "$pin" > "$research/summary.txt"
cat "$research/attack-results.tsv"
