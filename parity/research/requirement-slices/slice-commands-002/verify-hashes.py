#!/usr/bin/env python3
"""Recompute quote and full-file hashes for slice-commands-002 proposals."""
import hashlib, json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[3] / 'reference' / 'cursor-plugins'
# parents: slice dir -> requirement-slices -> research -> parity
SLICE = pathlib.Path(__file__).resolve().parent
INV = {i['path']: i['sha256'] for i in json.loads((SLICE.parents[2] / 'inventory.json').read_text())['items']}
doc = json.loads((SLICE / 'proposals.json').read_text())
fails = 0
for p in doc['proposals']:
    path = p['source']['file']
    data = (ROOT / path).read_bytes()
    full = hashlib.sha256(data).hexdigest()
    lines = data.decode().splitlines(keepends=True)
    quote = ''.join(lines[p['source']['lineStart']-1:p['source']['lineEnd']])
    qh = hashlib.sha256(quote.encode()).hexdigest()
    ok = (
        full == p['source']['fullFileSha256'] == p['inventoryItemSha256'] == INV[path]
        and qh == p['source']['quoteSha256']
        and quote == p['source']['quote']
    )
    print(('PASS' if ok else 'FAIL'), p['id'])
    if not ok:
        fails += 1
        print('  full', full, p['source']['fullFileSha256'])
        print('  quote', qh, p['source']['quoteSha256'])
print(f'{len(doc["proposals"]) - fails}/{len(doc["proposals"])} PASS')
sys.exit(1 if fails else 0)
