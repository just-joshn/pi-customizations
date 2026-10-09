#!/bin/sh

set -eu

package_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/acceptance-freeze-prep-002.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT HUP INT TERM

node "$package_root/verify-freeze-prep.mjs"

node -e '
const fs = require("node:fs");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
fs.writeFileSync(
  process.argv[2],
  `${JSON.stringify({ ...input, decision: "READY" }, null, 2)}\n`,
);
' "$package_root/freeze-prep.json" "$fixture_dir/forged-ready.json"

if node "$package_root/verify-freeze-prep.mjs" \
  --manifest "$fixture_dir/forged-ready.json" >"$fixture_dir/stdout" 2>"$fixture_dir/stderr"
then
  printf '%s\n' "FAIL: forged READY decision passed verification" >&2
  exit 1
fi

if ! rg -q "decision READY is invalid while custody checks fail" "$fixture_dir/stderr"
then
  cat "$fixture_dir/stderr" >&2
  printf '%s\n' "FAIL: forged READY decision failed for the wrong reason" >&2
  exit 1
fi

printf '%s\n' "PASS: forged READY decision was rejected."
