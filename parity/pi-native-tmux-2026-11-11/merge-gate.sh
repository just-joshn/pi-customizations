#!/bin/sh
# Run from the integration worktree after every merge. Exits non-zero on any type error or failing test.
set -eu
cd "$(git rev-parse --show-toplevel)/extensions/pi-pstack"
# Container e2e tests isolate HOME, which hides a docker *context* (OrbStack, Colima). Pin the active endpoint.
if [ -z "${DOCKER_HOST:-}" ] && command -v docker >/dev/null 2>&1; then
  endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)
  [ -n "$endpoint" ] && export DOCKER_HOST="$endpoint"
fi
npx tsc --noEmit -p tsconfig.json
# Tests run dist/worker-host.js and other bundles; a stale bundle would test old code.
bun scripts/build-helpers.mjs --check >/dev/null
log=$(mktemp)
status=0
npx vitest run --reporter=dot >"$log" 2>&1 || status=$?
tail -6 "$log"
grep -E "FAIL|×" "$log" || true
cp "$log" "${TMPDIR:-/tmp}/merge-gate-last.log"
rm -f "$log"
echo "full log: ${TMPDIR:-/tmp}/merge-gate-last.log"
exit "$status"
