#!/bin/sh
# Reruns the live probes against a seeded PI_CODING_AGENT_DIR and compares each result with its committed evidence file.
# The Cursor frames differ per run in timing and request ids, so only their kind, flags and notices are compared.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
evidence="$here/../evidence"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
run() { node --experimental-strip-types "$here/$1.mts" > "$out/$2"; }
for pair in cursor-catalog:cursor-catalog-ids.json grok-catalog:grok-catalog-ids.json billing-raw:billing-credits-raw.json; do
  run "${pair%%:*}" "${pair#*:}"
  if cmp -s "$out/${pair#*:}" "$evidence/${pair#*:}"; then echo "same  ${pair#*:}"; else echo "DIFF  ${pair#*:}"; fi
done
run cursor-native frames.json
python3 - "$out/frames.json" "$evidence/cursor-native-usage-limit-frames.json" <<'PY'
import json, sys
def shape(path):
    return [(f['kind'], f.get('flags'), [{k: v for k, v in n.items() if k != 'execField'} for n in f.get('notices', [])]) for f in json.load(open(path))]
print('same ' if shape(sys.argv[1]) == shape(sys.argv[2]) else 'DIFF ', 'cursor-native-usage-limit-frames.json (kind, flags, notices)')
PY
