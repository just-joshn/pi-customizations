# u-dep-live-integrations-002 report

Status: complete (proposal published, ledgers untouched)

throughput checkpoint: n/a, read-only investigation

## Summary

Reclassified the 416-item live-integrations inventory against Automations and webhook progress already on disk. Create/open of the Automations editor is now class c for four create-path rows. Webhook create is witnessed once. `SETUP-BENNY-CREATION-BOUNDARY-ENV` is removed from `blockerMismatchIds` (`closed-env-resolved`). 115 environment-bound rows remain. `canCloseUnresolvedReference` is false. No Slack posts, Generate auth, or `update_state` were invented. Console stayed locked. Ledgers were not edited. `completeDependencyClosure` stays false.

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Inventory sha256 `63ef7f8f…13b867d4` | Passed (`verify.json`) |
| Per-item disposition for all 416 rows | Passed |
| Class a / b / c counts | 275 / 115 / 26 (was 275 / 119 / 22) |
| `SETUP-BENNY-CREATION-BOUNDARY-ENV` absent from blockers | Passed |
| Merge close vs narrow | Narrow only. `canClose=false` |
| No fabricated Slack / Generate / auth | Passed. `behavioralExerciseClaim=false` |
| No ledger edits by this unit | Passed. Writes only under `dep-live-integrations-002/` and this report |

## Counts

| Class | Meaning | Count | Delta vs 001 |
| --- | --- | --- | --- |
| a_custody_complete | custody-complete without live exercise | 275 | 0 |
| b_environment_bound | environment-bound needing operator grant | 115 | -4 |
| c_already_evidenced | already evidenced by an existing parity pair | 26 | +4 |
| Total | | 416 | |

### Reason counts

| Reason | Class | Count |
| --- | --- | --- |
| inventory_or_doc_custody_without_live_exercise | a | 275 |
| live_slack_needs_operator_grant | b | 44 |
| third_party_live_install_needs_operator_grant | b | 39 |
| webhook_routine_or_secret_live_needs_operator_grant | b | 20 |
| webhook_create_witnessed_generate_auth_unpaid | b | 9 |
| automations_editor_save_or_activate_needs_operator_grant | b | 3 |
| models_pricing_paired_via_setup_grok_xhigh_cap | c | 22 |
| automations_editor_create_handoff_evidenced | c | 4 |

## Overview

Unit 001 split custody vs environment-bound vs already-paired. Since then, Cursor Automations editor create/open paid via direct URL and `/automate`, Benny Inactive list plus same-frame editor title paid, creation-boundary ENV closed, and one webhook Automations create witnessed. This unit overlays those attempt IDs onto the 001 table without new desktop capture.

## Key concepts

- Create/open paid is not Save/Activate paid. Four create-path rows move to class c. Share / billing / source-control-trigger fragments stay class b under thread-safety.
- Webhook create witnessed (`c345b7ed`) is not Generate auth + key store + probe. Nine webhook rows keep class b under a narrowed reason. Secrets/routines stay unpaid.
- `closed-env-resolved` removes CREATION-BOUNDARY from live-integrations blockers. `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` stays unverified because Pi Automations editor is absent (`f4c7eec5`).
- CU cloud and enterprise remain host-edge unpaid. They stay named in the narrowed reference text even though they are not inventory-row blockers.

## How it works

`refresh_dispositions.py` loads `dep-live-integrations-001/dispositions.json`, checks inventory sha256, applies index and reason overlays, strips CREATION-BOUNDARY from blockers, and writes `dispositions.json`, `summary.json`, `merge-proposal.json`, `reclassification-log.json`, and `verify.json`.

## Where things live

| Artifact | Path |
| --- | --- |
| Lever | `parity/research/dep-live-integrations-002/refresh_dispositions.py` |
| Dispositions | `parity/research/dep-live-integrations-002/dispositions.json` |
| Summary | `parity/research/dep-live-integrations-002/summary.json` |
| Merge proposal | `parity/research/dep-live-integrations-002/merge-proposal.json` |
| Reclass log | `parity/research/dep-live-integrations-002/reclassification-log.json` |
| Verify | `parity/research/dep-live-integrations-002/verify.json` |
| Worker report | `parity/briefs/reports/u-dep-live-integrations-002-report.md` |

## Gotchas

- Do not treat CREATION-BOUNDARY close as requirement close. Pi half `f4c7eec5` is env-blocked.
- Do not treat `c345b7ed` as make-bot complete. Generate auth remains unpaid while `IOConsoleLocked=Yes`.
- Benny editor title `475ab346` pays Cursor chrome for Inactive `benny-triage`. It does not pay Slack valid-config or thread-safety.
- Host edges (CU cloud, enterprise) are outside the inventory a/b/c table but still bar `completeDependencyClosure`.

## Attempt IDs cited

| Role | Attempt |
| --- | --- |
| Automations URL editor | `f6e29fb7-5878-4c8c-841e-1538b39d1cf7` |
| `/automate` handoff | `b60a705b-e2ea-40c4-adeb-7014fde433b4` |
| Webhook create | `c345b7ed-5c24-424c-86c3-55211b7bf0c8` |
| Benny editor title | `475ab346-80a0-4d73-8ae1-d2b8042ee66f` |
| Benny Inactive list | `e11d7225-4c8a-4c09-8f30-273e941a52d2` |
| Pi creation blocked | `f4c7eec5-6ac5-4431-b4b1-23c7e267dc96` |

## Open blockers (keep reference open)

| Blocker | Note |
| --- | --- |
| BENNY-TRIAGE-VALID-CONFIG-ENV | Valid Benny+Slack config + granted test-thread reply unpaid |
| SETUP-BENNY-THREAD-SAFETY-ENV | Automations Save/Activate + Slack seven-checks unpaid |
| MAKE-BOT-UI-KEY-SERVER-HOST | Create witnessed; Generate auth + key store + probe unpaid |
| third-party-live-installs | Linear/Notion/GitHub/GitLab/Teams not exercised |
| cursor-self-hosted-computer-use | CU cloud helper live exercise unpaid (host edge) |
| cursor-enterprise-integration-policy | Enterprise policy observation unpaid (host edge) |

Removed from inventory blockers: `SETUP-BENNY-CREATION-BOUNDARY-ENV` (`closed-env-resolved`).

## Verification

```bash
python3 parity/research/dep-live-integrations-002/refresh_dispositions.py
```

Observed: inventory sha verified. Counts 275 / 115 / 26. `canClose=false`. CREATION-BOUNDARY absent from blockers.

## Can merge close or narrow?

Close: no. 115 environment-bound rows remain, plus CU/enterprise host edges.

Narrow: yes. Replace the live-integrations `unresolvedReferences` entry with the merge proposal text. Attach 002 dispositions. Leave `completeDependencyClosure` false.

## Merge payload (coordinator)

```json
{
  "action": "replace-matching",
  "matchContains": "Live integrations live-exercise",
  "newText": "Live integrations live-exercise remains open after u-dep-live-integrations-002 disposition at parity/research/dep-live-integrations-002/dispositions.json (inventory sha256 63ef7f8f4c35e3918556e787f22eb308666e5e8d0b444b41584524ce13b867d4; a_custody_complete=275, b_environment_bound=115, c_already_evidenced=26). Progress: Automations editor create/open paid (url f6e29fb7, /automate b60a705b, Benny Inactive+title e11d7225/475ab346); SETUP-BENNY-CREATION-BOUNDARY-ENV closed-env-resolved; webhook create witnessed (c345b7ed). Still unpaid: Benny/Slack valid-config + thread-safety; make-bot Generate auth + key store + probe; third-party live installs (Linear/Notion/GitHub/GitLab/Teams); CU cloud helper live exercise; enterprise policy observation. Pi Automations editor absent (f4c7eec5). No fabricated Slack posts, Generate auth, or invented update_state. completeDependencyClosure stays false.",
  "completeDependencyClosure": false,
  "apply": false
}
```

Full proposal: `parity/research/dep-live-integrations-002/merge-proposal.json`.
