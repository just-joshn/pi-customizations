#!/bin/sh
# Re-hash every artifact listed in evidence-index.json and require exact sha256 match.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)"
INDEX="$ROOT/parity/research/acceptance-creation-boundary-freeze-prep-001/evidence-index.json"
cd "$ROOT"
fail=0
python3 - "$INDEX" <<'PY'
import hashlib, json, sys
from pathlib import Path
index = json.loads(Path(sys.argv[1]).read_text())
root = Path(".")
failed = 0
for art in index["artifacts"]:
    path = root / art["path"]
    if not path.is_file():
        print(f"MISSING {art['path']}")
        failed += 1
        continue
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    expected = art["sha256"]
    if digest != expected:
        print(f"MISMATCH {art['path']}")
        print(f"  expected {expected}")
        print(f"  actual   {digest}")
        failed += 1
    else:
        print(f"OK {digest}  {art['path']}")
if failed:
    print(f"FAIL: {failed} digest check(s) failed")
    sys.exit(1)
print(f"PASS: {len(index['artifacts'])} digests match on-disk files")
PY
