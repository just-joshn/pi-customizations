#!/bin/sh
set -eu

ROOT=$(git rev-parse --show-toplevel)
PKG="$ROOT/extensions/no-ceilings/pi-subagents"
cd "$PKG"

case "${1:-}" in
  delegation)
    exec node test/e2e/verify-delegation-fake-model.mjs
    ;;
  custom)
    exec node test/e2e/verify-subagents.mjs
    ;;
  background)
    node test/e2e/verify-delegation-fake-model.mjs
    node test/e2e/verify-subagents.mjs
    ;;
  security)
    node test/e2e/verify-git-helpers.mjs
    node test/e2e/verify-crafted-tools.mjs
    ;;
  growth)
    exec node test/e2e/verify-state-growth.mjs 12 50
    ;;
  *)
    echo "Usage: $0 {delegation|custom|background|security|growth}" >&2
    exit 2
    ;;
esac
