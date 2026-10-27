# Throughput checkpoint, pi-pstack 0.15.35

## Blocking first steps
1. RED: move the pin and counts in test/resources.test.ts (575 locked, 513 none, 576 tracked).
2. GREEN: move SOURCE in scripts/sync-upstream.mjs to ab1f702c, run sync:upstream and check:upstream.
3. Host delta: name the parent model in pstack_subagents for arena's parent-family judge rule (host.e2e first).

## Independent workstreams
- Two read-only audits run in parallel after GREEN: the skill corpus against the host map, and Cursor CLI 2026.10.22 tool schemas against src/.
- The decision log is append-only.

## Shared mutable state
- extensions/pi-pstack/** and upstream.lock.json have one writer, the root chat. Auditors write only under /tmp.

## Smallest safe decomposition
One writer. The bump is one generator run plus one host line. Audits fan out because they only read.
