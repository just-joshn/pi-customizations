# u-write-card-verify report

**status.** done  
**write-card-v1.** pass  
**acceptanceVerdict on mismatch row.** unchanged (this worker did not edit `parity/mismatches.json`)

## Fresh comparator run

Command (repo root):

```text
node parity/scripts/compare-write-card.mjs \
  parity/evidence/setup-success/cursor/screen-02-write-card.txt \
  parity/evidence/setup-success/pi/screen-02-write-card.txt \
  parity/evidence/setup-success/write-card-verify-rerun.json
```

| Field | Value |
| --- | --- |
| exit code | 0 |
| `pass` | `true` |
| `failures` | `[]` |
| comparator | `write-card-v1` |
| cursor screen | `parity/evidence/setup-success/cursor/screen-02-write-card.txt` |
| pi screen | `parity/evidence/setup-success/pi/screen-02-write-card.txt` |
| output | `parity/evidence/setup-success/write-card-verify-rerun.json` |
| vs prior linked report | byte-identical to `write-card-parity-linked.json` (`cmp` equal) |

Both sides passed all five checks (`edited-title`, `no-wrote-form`, `diff-removed-budget`, `diff-added-budget`, `diff-context-role`).

## Linked pair on disk

Source: `parity/evidence/setup-success/pair-setup-success-write-card-2.json`

| Field | Value |
| --- | --- |
| pairId | `setup-success-write-card-2` |
| cursor attemptId | `de231068-bb59-4872-a415-cfac64ddfdfe` |
| pi attemptId | `0d269402-43a6-48fd-bb62-c8ca90306a5c` |
| pair verdict | `pass-structured` |
| identity files | present under each attempt dir |

Standing order 13 asks for a linked Cursor+Pi pair with attempt IDs. That pair file exists and names both attempt IDs. Structured parity still passes on those screens.

## Blockers for full close

Measured facts only. Coordinator owns ledger close.

1. **Missing commit hash for write-card product diff.**  
   `git status --short` at HEAD `33c349380771ac1d843c124959b1dcdc563d0b7b` shows:
   - `M extensions/pi-pstack/src/tool-cards.ts` (+lines in uncommitted diff; `git diff --stat` reports 54 lines changed in that file with `setup-tool.ts`)
   - `M extensions/pi-pstack/src/setup-tool.ts`
   - also present in the tree (same working tree, not required for this verify): `M extensions/pi-pstack/src/index.ts`, `?? extensions/pi-pstack/src/how-spawn-gate.ts`  
   Mismatch row still records `candidateRevision: "uncommitted-write-card-diff"` and `acceptanceVerdict: "pass-structured-pending-commit"`. Standing order 13 forbids closing SETUP-WRITE-CARD without a commit hash when product code changed. No commit was made (FORBIDDEN).

2. **Pair linking is sequential, not one `recordPair()` call.**  
   Pair file caveat (verbatim sense): sequential same-scenario captures under setup-success, not one `recordPair()` invocation. Mismatch `nextAction` already labels a fresh `recordPair()` run as optional stricter linking. This does not fail write-card-v1. It remains a documented gap vs the strictest pairing path.

3. **Nothing else blocked structured re-verify.**  
   Screens exist. Attempt dirs and identities exist. Comparator pass reproduces. This report does not set `acceptanceVerdict` to `pass-paired`.

## Evidence paths

- `parity/evidence/setup-success/write-card-verify-rerun.json`
- `parity/evidence/setup-success/write-card-parity-linked.json` (prior; identical content)
- `parity/evidence/setup-success/pair-setup-success-write-card-2.json`
- `parity/evidence/setup-success/cursor/screen-02-write-card.txt`
- `parity/evidence/setup-success/pi/screen-02-write-card.txt`
- `parity/evidence/setup-success/cursor/de231068-bb59-4872-a415-cfac64ddfdfe/identity.json`
- `parity/evidence/setup-success/pi/0d269402-43a6-48fd-bb62-c8ca90306a5c/identity.json`
- this report: `parity/briefs/reports/u-write-card-verify-report.md`
