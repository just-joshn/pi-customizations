# u-journey-setup-benny-creation-handoff-001 report

**status.** Cursor half partial. Pi half still env-blocked for Automations editor. Ledgers untouched. No Save. No Activate. No Slack posts.

throughput checkpoint: n/a (evidence capture)

## Merge recommendation

| Field | Value |
| --- | --- |
| Requirement | `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` |
| Verify | **no** |
| Why | Benny-named Inactive draft reached via `/automate` on Cursor Desktop. Same-frame editor chrome titled `benny-triage` was not captured. Pi still has no Automations editor handoff in PTY. Paired verify is not earned. |

## Attempt IDs

| Label | ID | Result |
| --- | --- | --- |
| False-positive early exit | `372ec24f-7684-4553-b8f0-5019b4e4f1fa` | Meta claimed editor. Screens showed agent still running. Rejected. |
| Untitled editor chrome (OCR/PNG) | `62051488-83b6-4e50-b50b-1175df5d506b` | Inactive + Add Trigger + Agent Instructions. Title Untitled. Typing missed composer. |
| Wrong finish name | `aa48ff47-b7e1-4f0d-9a3a-70a23a95ca96` | `/automate` ran. Agent finished `parity-webhook-witness`. Concurrent chats polluted yes-gates. |
| Primary Benny triage | `e11d7225-4c8a-4c09-8f30-273e941a52d2` | Benny prompt + token sent. Draft approved. Automations Mine list shows `benny-triage` × Inactive. |
| List reopen miss | `e49fe741-2634-4f95-999c-32ab5643da9b` | Palette Open Automations failed (no results). No extra Save/Activate. |
| Prior non-Benny witness | `b60a705b-e2ea-40c4-adeb-7014fde433b4` | Env handoff only. Not Benny-shaped. |
| Pi (prior env note) | `cd378e36-ef2e-4810-ae5d-74a5169f204c` | Keep. `host-env-probe.json` still `automationsEditorUiAvailableInPiPty: false`. |

## Cursor evidence (primary)

| Step | Evidence |
| --- | --- |
| `/automate` Benny triage prompt | `e11d7225` `screen-06-prompt-ready.png` (`PARITY_TOKEN=benny-triage-handoff-001`, Name exactly `benny-triage`) |
| Draft approved, no Slack, stop before Save | `e11d7225` `screen-07-poll-10.png` / `screen-08-final.png` |
| Benny-named Inactive in Automations list | `e11d7225` `screen-07-poll-28.png` + `.ocr.txt` rows `benny-triage` / `× Inactive` |
| Untitled editor chrome (earlier in unit) | `62051488` `screen-07-poll-20.png` (Inactive, Add Trigger, Agent Instructions, Save not pressed) |

## Save / Activate policy

Prefer stop before Save. This unit did not press Save or Activate.

Inactive drafts can appear under Automations Mine after `/automate` handoff without a Save click. Save was not required to prove that finish path for list presence. Editor title chrome for `benny-triage` remains unpaid.

## Pi half

Honest keep of prior env note. Host probe still reports no Automations editor UI in Pi or cursor-agent PTY. No new Pi attempt fabricated.

Probe. `parity/evidence/setup-benny/creation-boundary/host-env-probe.json`

## Forbidden checks

| Gate | Held |
| --- | --- |
| No ledger edits | yes |
| No Activate / enable | yes |
| No Slack posts | yes |
| No further subagents | yes |
| No deep-link / draft-field URL as the claimed finish path | yes (path was `/automate`) |

## Lever changes

`parity/scripts/capture-automations-desktop-agents-window.py automate-handoff`

- Profiles `benny-triage`, `benny-reproduce`, `webhook-witness`, `witness`
- Composer focus, Cursor activate, permission-sheet dismiss
- Strong AX + Vision OCR oracle for webview editor chrome
- Session token yes-gate to avoid confirming concurrent chats

## Artifacts

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-journey-setup-benny-creation-handoff-001-report.md` |
| Disposition | `parity/research/setup-benny-creation-handoff-001/disposition.json` |
| Visual review | `parity/research/setup-benny-creation-handoff-001/visual-review-e11d7225.json` |
| Decision trail | `parity/research/setup-benny-creation-handoff-001/decisions.tsv` |
| Primary evidence | `parity/evidence/setup-benny/creation-boundary/agents-window/e11d7225-4c8a-4c09-8f30-273e941a52d2/` |

## Operator discard guidance

Do not Save or Activate these Inactive drafts if unwanted.

1. `benny-triage`
2. `Untitled`
3. `parity-webhook-witness`
4. Prior `parity-witness-draft` from `b60a705b` if still present

## Attention

reviewed by poteto-agent under brief (no further subagents)

- Requirement stays unverified. Cursor Benny list presence is progress. Paired editor-title finish + Pi half still open.
