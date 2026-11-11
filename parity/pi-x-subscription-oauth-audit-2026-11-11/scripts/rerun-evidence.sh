#!/bin/sh
# The billing and frames files also depend on account state: both stop matching once the weekly usage pool resets.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
evidence="$here/../evidence"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
check() {
  node --experimental-strip-types "$here/$1.mts" > "$out/$2"
  if cmp -s "$out/$2" "$evidence/$2"; then echo "same  $2"; else echo "DIFF  $2"; fi
}
check cursor-catalog cursor-catalog-ids.json
check grok-catalog grok-catalog-ids.json
check billing-raw billing-credits-raw.json
node --experimental-strip-types "$here/cursor-native.mts" > "$out/frames.json"
python3 - "$out/frames.json" "$evidence/cursor-native-usage-limit-frames.json" <<'PY'
import json, sys
def run_stable_fields(path):
    return [(f['kind'], f.get('flags'), [{k: v for k, v in n.items() if k != 'execField'} for n in f.get('notices', [])]) for f in json.load(open(path))]
print('same ' if run_stable_fields(sys.argv[1]) == run_stable_fields(sys.argv[2]) else 'DIFF ', 'cursor-native-usage-limit-frames.json (kind, flags, notices)')
PY
