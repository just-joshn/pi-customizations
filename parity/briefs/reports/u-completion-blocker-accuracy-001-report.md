# u-completion-blocker-accuracy-001 report

Status: complete (audit only; ledgers untouched; no freeze)

throughput checkpoint: n/a, read-only investigation

## Summary

Re-ran `node parity/scripts/check-completion.mjs`. Verdict stays `BLOCKED` with **13** blockers. Codes and locators match on-disk `parity/completion.json`. None of the 13 are stale false-opens. Desktop console remains locked (`IOConsoleLocked=Yes`). Wait-unlock (G10) is still the first grant.

## Overview

`completion.json` is the completion gate snapshot. `check-completion.mjs` rebuilds it from live ledgers. This unit checked each of the 13 reported blockers against `source-lock.json`, `dependencies.json`, `requirements.json`, and `mismatches.json`. The question was whether any blocker still fires after the underlying condition cleared. None did.

Creation-boundary ENV is already `closed-env-resolved` and is not among the 13. The creation-boundary **requirement** stays `unverified` under Option A. That is intentional, not a stale open.

## Key concepts

- A blocker is still-valid when the ledger field the gate reads is still unsatisfied.
- A stale false-open would be a completion code whose ledger fact is already closed or verified-pass-paired.
- Operator grants G1–G11 live in `parity/research/operator-gates-refresh-002/grant-checklist.json`. This audit does not invent grants or live evidence.

## How it works

1. Gate evaluation reads source lock status and closure, unresolved dependency references and edges, acceptance freeze flag, requirement statuses, and open mismatches.
2. Each of the 13 codes maps 1:1 to a live unsatisfied field (table below).
3. Open mismatches are exactly three. `SETUP-BENNY-CREATION-BOUNDARY-ENV` is closed and correctly absent from completion blockers.
4. Console lock blocks only the make-bot Generate path. It does not invent a reason to drop other blockers.

## Blocker accuracy table

| # | Code | Locator / id | Still-valid? | Next evidence / grant |
| --- | --- | --- | --- | --- |
| 1 | `SOURCE_LOCK_INCOMPLETE` | `status` = incomplete | yes | Finalize after G1 + G2 + live-int reference close |
| 2 | `SOURCE_CLOSURE_INCOMPLETE` | `completeDependencyClosure` = false | yes | Same dependency closures as #1 (`G1`, `G2`, `G11`) |
| 3 | `DEPENDENCY_REFERENCE_UNRESOLVED` | `unresolvedReferences[0]` (live-int; b=115) | yes | Pay class-b via `G4`–`G11`, then coordinator narrow/close |
| 4 | `DEPENDENCY_EDGE_UNRESOLVED` | edges[0] CU cloud | yes | Cloud claim attempt IDs (`G1`) |
| 5 | `DEPENDENCY_EDGE_UNRESOLVED` | edges[1] enterprise | yes | Enterprise read-only observation (`G2`) |
| 6 | `ACCEPTANCE_DEFINITIONS_UNFROZEN` | `acceptanceDefinitionsFrozen` = false | yes | Independent owner + custody + freeze auth (`G3`); no freeze here |
| 7 | `REQUIREMENT_UNVERIFIED` | `PSTACK-CMD-BENNY-TRIAGE-THREAD-ONLY-001` | yes | Valid-config Cursor+Pi pair after `G4`–`G8` |
| 8 | `REQUIREMENT_UNVERIFIED` | `PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001` | yes | Unlock → Discard Untitled → Generate + store + probe (`G10`) |
| 9 | `REQUIREMENT_UNVERIFIED` | `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` | yes | Pi Automations editor or owner Option B (`G9` remainder); ENV already closed |
| 10 | `REQUIREMENT_UNVERIFIED` | `PSTACK-SETUP-BENNY-THREAD-SAFETY-001` | yes | Save witness + seven-checks (`G4`–`G8` then `G9`) |
| 11 | `BEHAVIOR_MISMATCH_OPEN` | `BENNY-TRIAGE-VALID-CONFIG-ENV` = open | yes | Same as #7 |
| 12 | `BEHAVIOR_MISMATCH_OPEN` | `MAKE-BOT-UI-KEY-SERVER-HOST` = open | yes | Same as #8 (`G10`; console locked) |
| 13 | `BEHAVIOR_MISMATCH_OPEN` | `SETUP-BENNY-THREAD-SAFETY-ENV` = open | yes | Same as #10 |

### Stale blockers for check-completion to ignore

None. Proof: every row’s ledger fact is still unsatisfied on this re-run (`evaluatedAt` `2026-10-09T09:03:20.288Z`). Codes matched the written `completion.json`.

## Where things live

| Artifact | Path |
| --- | --- |
| Machine table | `parity/research/completion-blocker-accuracy-001/blocker-accuracy.json` |
| Gate code dump | `parity/research/completion-blocker-accuracy-001/check-completion-codes.json` |
| Prior grant checklist | `parity/research/operator-gates-refresh-002/grant-checklist.json` |
| This report | `parity/briefs/reports/u-completion-blocker-accuracy-001-report.md` |

## Gotchas

- Do not treat creation-boundary ENV close as requirement close. Requirement #9 stays unpaid under Option A.
- Do not drop source-lock or closure blockers while edges[0], edges[1], or the live-int reference remain open. They are derived, not separate grants.
- `check-completion.mjs` rewrites `completion.json`. That is the VERIFY step. This unit did not edit `requirements.json`, `mismatches.json`, `progress.md`, `source-lock.json`, or `dependencies.json`.
- Console is locked. No Discard/Generate was attempted.

## Ordered next grants

1. **G10.** Unlock console → Discard Untitled → Generate (make-bot + webhook Generate class-b).
2. **G4–G8.** Benny YAML, bot token env, Slack MCP auth, test channel posts, harness Slack actions.
3. **G9 remaining.** Automations Save witness (then seven-checks). Keep creation-boundary on Option A.
4. **G1** and **G2.** CU cloud claim and enterprise observation (parallel host grants).
5. **G11.** Third-party live installs as needed for live-int remainder.
6. **G3.** Acceptance freeze only with real independent custody.

## Verification

```bash
node parity/scripts/check-completion.mjs
```

Observed: `verdict=BLOCKED`, blockerCount=13, codes match table, `IOConsoleLocked=Yes`.
