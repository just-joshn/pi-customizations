#!/bin/sh
# Regenerate every derived artifact after merging rule or source changes: compiled skills, manifests, helper bundles.
set -eu
cd "$(git rev-parse --show-toplevel)/extensions/pi-pstack"
node scripts/compile-skills.mjs
node scripts/check-dependencies.mjs >/dev/null
node scripts/check-parity.mjs
bun scripts/build-helpers.mjs >/dev/null
bun scripts/build-helpers.mjs --check
