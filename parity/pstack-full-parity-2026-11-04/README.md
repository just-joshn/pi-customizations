# Full pstack parity audit

## Verdict

`NOT VERIFIED`. The requested goal is 100% behavioral and functional parity with Cursor pstack and its reachable dependencies. This run establishes and fixes a shell-monitor unit. The dependency graph, behavioral inventory, original workflow coverage, and native implementation remain incomplete.

The work-alone constraint was also breached by one mistaken `cursor agent status` probe. The command launched another LLM. Its response is excluded from evidence and review.

## Deliverables

| File | Content |
| --- | --- |
| `report.md` | Handoff, changes, verification results, material gaps, and verdict. |
| `baseline.json` | Pinned reference, inspected Pi API identities, dependency identities, counts, and incomplete-status flags. |
| `source-inventory.jsonl` | Captured reference files and hashes. File capture is not semantic review. |
| `dependency-candidates.jsonl` | Stable candidate-reference IDs with file, line, column, target, and pending disposition. Not a closed dependency graph. |
| `host-modules.jsonl` | Captured Cursor factory identities and evidence locations. |
| `specification.md` | Stable behavior IDs, established monitor contracts, evidence classes, and unfinished requirements. |
| `architecture.md` | Data ownership, serial design comparison, dependency handling, and verification boundaries. |
| `verify.md` | Separate verification pass through real native entry points. |
| `confirm.md` | Separate seeded comparison against the original observer. |
| `fact-check.md` | Separate artifact and claim review. |
| `decisions.tsv` | Decision trail, including the process-constraint breach. |
| `notes.md` | Run framing, baseline choice, workflow, and investigation notes. |

The three review passes are by the same assistant with separate deterministic checks. They are not independent external reviews.

## Replay prerequisites

The raw evidence is in `.audit/pstack-full-parity-2026-11-04/`. It includes the pinned plugin archive, installed CLI factory captures, the published `re2js` archive, original-component results, native test logs, and CLI drive artifacts.

The capture scripts require the pinned Cursor CLI files and the inspected Pi 1.5.0 installation at the recorded local paths. They never need a Cursor prompt invocation. The reference archive and package hashes are in `baseline.json`. Reacquiring a different archive or host version requires an explicit new baseline, not updating an assertion until it passes.

## Replay commands

Run these commands from the repository root after installing workspace dependencies. The existing captured inputs must remain at the evidence paths.

```sh
EVIDENCE=.audit/pstack-full-parity-2026-11-04/reference
AUDIT=parity/pstack-full-parity-2026-11-04

node "$AUDIT/capture-reference.mjs" \
  "$EVIDENCE/plugins-bb68f2365eceafa0cb2d253112f675acf5f144cc" "$EVIDENCE"
node "$AUDIT/build-inventory.mjs" "$EVIDENCE" "$AUDIT"
node "$AUDIT/reference-shell-monitor.mjs" "$EVIDENCE" \
  .audit/pstack-full-parity-2026-11-04/regenerated-monitor.json
node "$AUDIT/confirm-shell-monitor.mjs" "$EVIDENCE" \
  .audit/pstack-full-parity-2026-11-04/confirm
node "$AUDIT/fact-check.mjs" "$EVIDENCE" \
  .audit/pstack-full-parity-2026-11-04/fact-check.json

./.pi/skills/verify-pi-customizations/bin/control-pi doctor
PSTACK_E2E_PI=/Users/josh-desktop/.pi/agent/bin/pi \
  bun run --filter @justjoshn/pi-pstack test \
  test/e2e/background-shell.e2e.test.ts test/e2e/package.e2e.test.ts
bun run --filter @justjoshn/pi-pstack typecheck
bun run --filter @justjoshn/pi-pstack test:coverage
```

`probe-pi-lifecycle.mjs <installed-pi-executable> <output-directory>` records signal availability at actual installed-Pi lifecycle events. It uses the offline scripted test model. It does not reproduce or fix a cancellation hang.

The root `make verify` includes other packages. On this host the default Node 24.13.1 lacks the SQLite API that pi-rea requires. The supported-runtime gate uses a command-scoped Node 26.13.0 path. The handoff report records both outcomes.
