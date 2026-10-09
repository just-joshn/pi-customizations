#!/usr/bin/env python3
"""Recompute quote and full-file hashes for slice-principles-001 proposals."""
import hashlib, json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[3] / "reference" / "cursor-plugins"
SLICE = pathlib.Path(__file__).resolve().parent
INV = {
    i["path"]: i["sha256"]
    for i in json.loads((SLICE.parents[2] / "inventory.json").read_text())["items"]
}
doc = json.loads((SLICE / "proposals.json").read_text())
fails = 0
covered = set()
for p in doc["proposals"]:
    path = p["source"]["file"]
    covered.add(path)
    data = (ROOT / path).read_bytes()
    full = hashlib.sha256(data).hexdigest()
    lines = data.decode().splitlines(keepends=True)
    quote = "".join(lines[p["source"]["lineStart"] - 1 : p["source"]["lineEnd"]])
    qh = hashlib.sha256(quote.encode()).hexdigest()
    ok = (
        full == p["source"]["fullFileSha256"] == p["inventoryItemSha256"] == INV[path]
        and qh == p["source"]["quoteSha256"]
        and quote == p["source"]["quote"]
        and "disable-model-invocation: true" in quote
    )
    print(("PASS" if ok else "FAIL"), p["id"])
    if not ok:
        fails += 1
        print("  full", full, p["source"]["fullFileSha256"])
        print("  quote", qh, p["source"]["quoteSha256"])

prior = json.loads(
    (
        SLICE.parent / "slice-commands-002" / "proposals.json"
    ).read_text()
)["deferredToLaterSlice"]
missing = [x for x in prior if x not in covered]
extra = sorted(covered - set(prior))
print(f"coverage prior={len(prior)} covered={len(covered)} missing={len(missing)} extra={len(extra)}")
for m in missing:
    print("MISSING", m)
    fails += 1
for e in extra:
    print("EXTRA", e)
    fails += 1

print(f'{len(doc["proposals"]) - fails}/{len(doc["proposals"])} PASS' if fails <= len(doc["proposals"]) else "coverage FAIL")
print(f"{len(doc['proposals'])} proposals; fails={fails}")
sys.exit(1 if fails else 0)
