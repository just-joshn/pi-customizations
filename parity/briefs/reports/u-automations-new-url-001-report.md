# u-automations-new-url-001 report

**status.** Editor chrome via `/automations/new` confirmed. `/automate` Agents Window handoff into Automations editor chrome witnessed. Save/Activate not pressed. Ledgers untouched.

throughput checkpoint: n/a, read-only investigation

## Verdict

| Field | Value |
| --- | --- |
| editorChromeWitnessed | **yes** |
| automateHandoffWitnessed | **yes** |
| SETUP-BENNY-CREATION-BOUNDARY-ENV merge | **close-env** (host + `/automate` handoff proven). Keep Save/Benny enable on THREAD-SAFETY / operator grant. |

## Attempt IDs

| Label | ID | Result |
| --- | --- | --- |
| URL `/automations/new` (coordinator, reused) | `f6e29fb7-5878-4c8c-841e-1538b39d1cf7` | Editor chrome yes. Landed `…/automations/8ddd3f0f-c3b0-11f1-ac31-5e2d0494121f`. Untitled / Inactive / Add Trigger / Agent Instructions / Save+Test. Save not pressed. |
| `/automate` slash-only (negative) | `8ab451a4-1988-4e55-bcfc-1d3f9359b277` | Slash select without Agents Window finish path. No editor chrome. |
| `/automate` handoff (positive) | `b60a705b-e2ea-40c4-adeb-7014fde433b4` | Agents Window Open → `/automate` → agent drafted → editor chrome `parity-witness-draft` Inactive. Save not pressed. |

## Editor chrome (URL)

Measured prior in coordinator probe. Re-read this unit.

| Marker | Seen |
| --- | --- |
| Untitled | yes |
| Inactive | yes |
| + Add Trigger | yes |
| Agent Instructions | yes |
| Save / Test | yes (Save not clicked) |
| Screen | `parity/evidence/setup-benny/creation-boundary/web/f6e29fb7-5878-4c8c-841e-1538b39d1cf7/01-after-open.png` |

## `/automate` handoff

Skill `~/.cursor/skills-cursor/automate/SKILL.md` finish path is Agents Window `open_automation` after draft approval. This unit drove that path with a non-Benny, no-Slack cron draft named `parity-witness-draft`, instructions `reply with ok`, explicit do-not-Save.

| Step | Evidence |
| --- | --- |
| Agents Window chat running `/automate` | `b60a705b` `screen-07-poll-4.png` ("Checking finish-path availability…") |
| Editor chrome after handoff | `b60a705b` `screen-07-poll-5.png` / `screen-08-final.png` |
| Agent finish note | `b60a705b` `screen-09-editor-clean.png` ("Automations editor is open with this draft. Stopped before Save or Activate.") |
| Markers | Inactive, Add Trigger, Agent Instructions, Save, Test, Memories, parity-witness-draft |
| Save / Activate | not pressed (Save appears disabled/grey; toggle Inactive) |

Harness note. Early palette text leaked into a search overlay on some frames. Poll-5/8 still show editor chrome behind it. Lever updated for reruns: `parity/scripts/capture-automations-desktop-agents-window.py automate-handoff`.

## Draft discard guidance (operator)

Do not Save either draft.

1. Inactive Untitled `8ddd3f0f-c3b0-11f1-ac31-5e2d0494121f` from opening `/automations/new`. Discard in Automations UI if unwanted.
2. Inactive `parity-witness-draft` from handoff attempt `b60a705b`. Discard in Automations UI if unwanted.

## Forbidden checks

| Gate | Held |
| --- | --- |
| No Save | yes |
| No Activate | yes |
| No Slack | yes |
| No Benny enable | yes |
| No ledger edits | yes |
| No further subagents | yes |

## Artifacts

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-automations-new-url-001-report.md` |
| Disposition | `parity/research/automations-new-url-001/disposition.json` |
| URL evidence | `parity/evidence/setup-benny/creation-boundary/web/f6e29fb7-5878-4c8c-841e-1538b39d1cf7/` |
| Handoff evidence | `parity/evidence/setup-benny/creation-boundary/agents-window/b60a705b-e2ea-40c4-adeb-7014fde433b4/` |
| Negative slash-only | `parity/evidence/setup-benny/creation-boundary/agents-window/8ab451a4-1988-4e55-bcfc-1d3f9359b277/` |
| Lever | `parity/scripts/capture-automations-desktop-agents-window.py` (`automate-handoff`) |

## Merge payload (for coordinator)

| Field | Value |
| --- | --- |
| editorChromeWitnessed | yes (`f6e29fb7`) |
| automateHandoffWitnessed | yes (`b60a705b`) |
| Recommended ledger action | **close** SETUP-BENNY-CREATION-BOUNDARY-ENV. Record handoff attempt `b60a705b` and URL attempt `f6e29fb7`. Leave Benny Save/enable unpaid under SETUP-BENNY-THREAD-SAFETY-ENV + operator grant. |
| New Automation button | still exhaustive-negative; not required once `/automate` handoff works |
| Ledger edits by this unit | none |

## Gotchas

- Slash-select `/automate` alone does not open the editor. Agents Window skill run through finish handoff does.
- Opening `/automations/new` auto-creates an Inactive Untitled draft server-side.
- Helper `get_app_state` can screenshot the IDE window instead of Agents Window when both are open. Prefer palette `Open Agents Window` before typing.
- Escape dismisses Automations host. Do not Escape after Open Automations list probes.

## Attention

reviewed by poteto-agent under brief (no further subagents)

- Handoff proven for a witness draft, not a Benny triage/repro save. Creation-boundary *env* reachability is paid. Benny-reviewed save remains operator-gated.
