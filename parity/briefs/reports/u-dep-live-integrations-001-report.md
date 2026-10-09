# u-dep-live-integrations-001 report

Status: complete (proposal published, ledgers untouched)

## Summary

All 416 live-integrations inventory items have an honest a/b/c disposition. 275 are custody-complete without live exercise. 119 remain environment-bound and need an operator grant. 22 model/pricing rows are already covered by the setup-grok-xhigh-cap pair. Merge cannot close the live unresolvedReference. Merge can narrow it to the classed blocker set. No Slack posts, Automations editor saves, or webhook routines were fabricated. Ledgers were not edited. `completeDependencyClosure` stays false.

throughput checkpoint: n/a, read-only investigation

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Inventory sha256 `63ef7f8f4c35e3918556e787f22eb308666e5e8d0b444b41584524ce13b867d4` | Passed. `verify_inventory_sha256.py` and classifier both matched |
| Per-item disposition for all 416 rows | Passed. `dispositions.json` has 416 rows |
| Class a / b / c counts | Passed. 275 / 119 / 22 |
| Merge payload for close or narrow | Passed. Narrow only. `canClose=false`, `canNarrow=true` |
| No fabricated Slack / Automations / webhook live exercise | Passed. `behavioralExerciseClaim=false`, `fabricatedLiveEvidence=false` |
| No ledger edits | Passed. Writes only under owned research/report paths |

## Counts

| Class | Meaning | Count |
| --- | --- | --- |
| a_custody_complete | custody-complete without live exercise | 275 |
| b_environment_bound | environment-bound needing operator grant | 119 |
| c_already_evidenced | already evidenced by an existing parity pair | 22 |
| Total | | 416 |

### Reason counts

| Reason | Class | Count |
| --- | --- | --- |
| inventory_or_doc_custody_without_live_exercise | a | 275 |
| live_slack_needs_operator_grant | b | 44 |
| third_party_live_install_needs_operator_grant | b | 39 |
| webhook_routine_or_secret_live_needs_operator_grant | b | 29 |
| automations_editor_runtime_needs_operator_grant | b | 7 |
| models_pricing_paired_via_setup_grok_xhigh_cap | c | 22 |

## Overview

Wave-007 finished inventory custody for required live integrations, cloud/automation/MCP/model contracts, and left `liveExerciseStatus: open`. This unit does not invent liveness. It splits each inventoried row into custody-complete, environment-bound, or already-paired so the coordinator can narrow the open reference without claiming Slack, Automations editor, or webhook exercise.

## Key concepts

- a_custody_complete means the inventory row is satisfied by queue/proposal/doc custody. It does not authorize a live post or editor save.
- b_environment_bound means live configuration or an operator grant is still required. Open mismatches name the Benny/Slack, Automations editor, and make-bot webhook blockers.
- c_already_evidenced means an existing verified pair already covers that inventory topic. Here that is models/pricing via setup-grok-xhigh-cap only.
- Narrowing the unresolvedReference replaces the vague 416-item open line with counts and named blockers. It does not set `completeDependencyClosure` true.

## How it works

`classify_items.py` loads `parity/research/dep-closure-wave-007/live/integrations-inventory.json`, checks sha256 against the brief, and applies an ordered topic registry. First match wins. Evidence paths on each row point at mismatches, pairs, retrieval files, or the inventory itself. The script writes `dispositions.json`, `summary.json`, `merge-proposal.json`, and `verify-inventory-sha256.json`.

## Where things live

| Artifact | Path |
| --- | --- |
| Lever | `parity/research/dep-live-integrations-001/classify_items.py` |
| Full disposition table | `parity/research/dep-live-integrations-001/dispositions.json` |
| Summary | `parity/research/dep-live-integrations-001/summary.json` |
| Merge proposal | `parity/research/dep-live-integrations-001/merge-proposal.json` |
| Inventory sha verify | `parity/research/dep-live-integrations-001/verify_inventory_sha256.py` |
| Source inventory | `parity/research/dep-closure-wave-007/live/integrations-inventory.json` |
| Worker report | `parity/briefs/reports/u-dep-live-integrations-001-report.md` |

## Gotchas

- Parent retrieval files for Automations help/docs can be class a while create-automation children stay class b. Doc bytes on disk are not an editor save.
- Slack doc custody exists under `parity/research/cursor-host/services/retrievals/docs_integrations_slack.md`, but live Slack remains class b.
- Benny fail-closed pairs do not move Slack inventory rows to class c. Those pairs prove incomplete-config stop behavior, not a granted Slack workspace.
- make-bot key-server has a pair file, but the requirement is unverified and Cursor is host_blocked. Webhook/routine rows stay class b.
- Standing prefs forbid fabricating customer/thread posts and broad authorization changes.

## Per-item disposition table

Full 416-row table with evidence paths: `parity/research/dep-live-integrations-001/dispositions.json`.

Class rollup with representative evidence:

| Class | Count | Representative evidence |
| --- | --- | --- |
| a | 275 | `parity/research/dep-closure-wave-007/live/integrations-inventory.json`; retrieval paths when present |
| b Slack | 44 | `parity/mismatches.json#BENNY-TRIAGE-VALID-CONFIG-ENV`, `SETUP-BENNY-THREAD-SAFETY-ENV` |
| b third-party | 39 | inventory + live-integrations node (Linear/Notion/GitHub/GitLab/Teams) |
| b webhook/secrets | 29 | `parity/mismatches.json#MAKE-BOT-UI-KEY-SERVER-HOST`, make-bot pair/blocker |
| b Automations editor | 7 | `SETUP-BENNY-CREATION-BOUNDARY-ENV`, `SETUP-BENNY-THREAD-SAFETY-ENV` |
| c models/pricing | 22 | `parity/evidence/setup-grok-xhigh-cap/pair-setup-grok-xhigh-cap-1.json` |

## Open operator-grant blockers (keep reference open)

| Blocker | Note |
| --- | --- |
| BENNY-TRIAGE-VALID-CONFIG-ENV | Valid Benny+Slack config and one granted test-thread reply unpaid |
| SETUP-BENNY-THREAD-SAFETY-ENV | Automations editor save + Slack seven-checks unpaid |
| SETUP-BENNY-CREATION-BOUNDARY-ENV | `/automate` Automations editor handoff unpaid |
| MAKE-BOT-UI-KEY-SERVER-HOST | Webhook routine create + secret-request path unpaid on Cursor host |
| third-party-live-installs | Linear/Notion/GitHub/GitLab/Teams live installs not exercised |

## Verification

Run from the repository root:

```bash
python3 parity/research/dep-live-integrations-001/verify_inventory_sha256.py
python3 parity/research/dep-live-integrations-001/classify_items.py
```

Observed: inventory sha verified. Counts 275 / 119 / 22. `canClose=false`.

## Can merge close or narrow the live unresolvedReference?

Close: no. 119 environment-bound rows remain, including Slack, Automations editor, webhook/secrets, and third-party installs.

Narrow: yes. Coordinator should replace the current live-integrations unresolvedReference text with `merge-proposal.json`'s `proposedUnresolvedReferenceText`, attach `dispositions.json` as evidence, keep the four open env mismatches, and leave `completeDependencyClosure` false.

## Merge payload

Coordinator-only apply target. Worker did not edit ledgers.

Path: `parity/research/dep-live-integrations-001/merge-proposal.json`

```json
{
  "canCloseLiveIntegrationsUnresolvedReference": false,
  "canNarrowLiveIntegrationsUnresolvedReference": true,
  "behavioralExerciseClaim": false,
  "counts": {
    "a_custody_complete": 275,
    "b_environment_bound": 119,
    "c_already_evidenced": 22
  }
}
```

Explicit: no fabricated live exercise.
