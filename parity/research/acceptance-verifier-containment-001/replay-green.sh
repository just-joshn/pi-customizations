#!/usr/bin/env bash
# Post-fix containment replay. Expects refusal + untouched outside canaries.
set -euo pipefail

owner=${OWNER:-/private/tmp/pi-pstack-parity-acceptance-owner}
reference=${REFERENCE:-/Users/josh-desktop/src/experiments/plugins}
parity=${PARITY:-/Users/josh-desktop/src/personal/pi-pstack-parity-again/parity}
acceptance="$owner/parity/acceptance"
tool="$acceptance/tools/verify-acceptance.mjs"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

digest() {
	shasum -a 256 "$1" | cut -d' ' -f1
}

sh "$acceptance/tools/selftest.sh" "$reference" "$parity"
for regression in ledger-byte-drift invalid-locator missing-pin-arg hardlinked-output symlinked-output-parent; do
	sh "$acceptance/review/regressions/$regression.sh" "$reference" "$parity"
done

pin=$(digest "$acceptance/MANIFEST.sha256")
clean=$(node "$tool" \
	--reference-root "$reference" \
	--parity-root "$parity" \
	--expect-manifest-sha256 "$pin")
jq -e '.structural == "PASS" and .authorization == "NONE" and .externalPin == "matched"' <<<"$clean" >/dev/null
printf 'clean verify: %s\n' "$clean"

cp -R "$acceptance" "$work/final-link"
printf 'FINAL_CANARY\n' > "$work/final-canary"
before=$(digest "$work/final-canary")
rm "$work/final-link/MANIFEST.sha256"
ln -s "$work/final-canary" "$work/final-link/MANIFEST.sha256"
set +e
out=$(node "$tool" --reference-root "$reference" --parity-root "$parity" --acceptance-root "$work/final-link" --write-hashes 2>&1)
code=$?
set -e
after=$(digest "$work/final-canary")
test "$code" -ne 0
test "$before" = "$after"
printf 'final output symlink: rejected, exit=%s, canary_changed=no\n%s\n' "$code" "$out"

cp -R "$acceptance" "$work/hardlink"
printf 'HARDLINK_CANARY\n' > "$work/hardlink-canary"
before=$(digest "$work/hardlink-canary")
rm "$work/hardlink/MANIFEST.sha256"
ln "$work/hardlink-canary" "$work/hardlink/MANIFEST.sha256"
set +e
out=$(node "$tool" --reference-root "$reference" --parity-root "$parity" --acceptance-root "$work/hardlink" --write-hashes 2>&1)
code=$?
set -e
after=$(digest "$work/hardlink-canary")
test "$code" -ne 0
test "$before" = "$after"
printf 'hardlinked output: rejected, exit=%s, canary_changed=no\n%s\n' "$code" "$out"

cp -R "$acceptance" "$work/parent-link"
mv "$work/parent-link/setup-pstack" "$work/outside-setup"
ln -s "$work/outside-setup" "$work/parent-link/setup-pstack"
printf '\n' >> "$work/outside-setup/record-hashes.json"
before=$(digest "$work/outside-setup/record-hashes.json")
set +e
out=$(node "$tool" --reference-root "$reference" --parity-root "$parity" --acceptance-root "$work/parent-link" --write-hashes 2>&1)
code=$?
set -e
after=$(digest "$work/outside-setup/record-hashes.json")
test "$code" -ne 0
test "$before" = "$after"
printf 'symlinked output parent: rejected, exit=%s, outside_file_changed=no\n%s\n' "$code" "$out"
