# Throughput checkpoint — pi-pstack 0.15.34

## Blocking first steps
1. Derive ExpectedCounts (done: 579 / none 517 / frontmatter 61 / patch 1 / skills 62 / hidden 57).
2. RED: update resources.test.ts + package.e2e + host.e2e pins; run until fail.
3. Move SOURCE to tip; sync:upstream; check:upstream GREEN.
4. No parallel writes to extensions/pi-pstack until GREEN lands.

## Independent workstreams
- After GREEN: SCRIPT-001 rewrite and docs/package.json can proceed in one owner (same tree).
- Parity evidence logging (decisions.tsv / evidence/) is append-only and can run alongside.
- No fan-out across multiple writers on skills/ or upstream.lock.json.

## Shared mutable state
- `extensions/pi-pstack/**` and `upstream.lock.json` are single-writer.
- Split avoided: one implementer owns the bump. Per separate-before-serializing-shared-state, do not parallelize sync + host edits.

## Smallest safe decomposition
One worker is best. The bump is one mechanical SOURCE+lock story with sequential RED→GREEN→SCRIPT→docs. Fan-out would fight over the lock.
