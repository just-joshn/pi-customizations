# u-journey-setup-benny-creation-pi-002 report

**status.** Fresh Pi Method A capture. Outcome `editor_saved_disabled`. Requirement stays unverified. Ledgers untouched by this unit.

throughput checkpoint: n/a, read-only investigation

## Merge recommendation

| Field | Value |
| --- | --- |
| Requirement | `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` |
| Verify | **no** |
| Pi outcome | `editor_saved_disabled` |
| Pi half | pair-ready |
| Freeze vs keep-unverified | **keep-unverified** until coordinator merges with paid Cursor half |
| Why | Pi now finishes Prepare → Inactive titled editor → disabled Save. Cursor list + editor-title halves are already paid. Only the coordinator may link the pair and change requirement status. |

## Attempt IDs

| Label | ID | Result |
| --- | --- | --- |
| Fresh Pi Method A | `4d40a1d5-ea54-4ce2-922b-bf82e78b6577` | `STATUS=editor-saved-disabled`. `AutomationPrepare(benny-triage)` + `AutomationOpenEditor`. Session `editorSavedDisabled=true`, `enabledCalled=false`. Operator Save drive once. |
| Prior Pi env-blocked | `f4c7eec5-6ac5-4431-b4b1-23c7e267dc96` | Historical. Superseded. |
| Cursor list (paid) | `e11d7225-4c8a-4c09-8f30-273e941a52d2` | Inactive `benny-triage` in Mine. |
| Cursor editor title (paid) | `475ab346-80a0-4d73-8ae1-d2b8042ee66f` | Same-frame editor titled `benny-triage`. |
| Cursor editor re-verify (paid) | `2c525e93-3392-4253-81ef-dd965fde2e7d` | OCR/AX package on `475ab346` frame. |

## How (Method A path)

**Overview.** Pi creation-boundary finish is the built-in `/automate` skill plus `AutomationPrepare` → `AutomationOpenEditor` → operator Save that keeps `kind=disabled`.

**Key concepts.** Draft store under `getAgentDir()/pstack-automations/`. Editor chrome marker `pi-automations-editor-v1`. Title is the automation name. State is Inactive. Save never enables.

**How it works.** Capture harness prompts Pi for `benny-triage` only, polls for the real panel (box + chrome marker), drives ↓×4 + Enter onto Save, then scores session tool results.

**Where things live.** Harness `parity/scripts/capture-setup-benny-creation-boundary.mjs`. Skill `extensions/pi-pstack/skills/automate/SKILL.md`. Tools `extensions/pi-pstack/src/automations.ts`. Panel `extensions/pi-pstack/src/automations-editor.ts`.

**Gotchas.** Prompt text and assistant “did not call AutomationEnable” used to false-positive the scorer. Real panel detection now requires a box border. `forbidEnable` also covers “did not call”.

## Evidence

| Step | Path |
| --- | --- |
| Identity | `parity/evidence/setup-benny/creation-boundary/pi/4d40a1d5-ea54-4ce2-922b-bf82e78b6577/identity.json` |
| Events | `parity/evidence/setup-benny/creation-boundary/pi/4d40a1d5-ea54-4ce2-922b-bf82e78b6577/events.jsonl` |
| Inactive editor + Save focus | `parity/evidence/setup-benny/creation-boundary/pi/screen-03-editor-save-1.txt` |
| Settled + STATUS line | `parity/evidence/setup-benny/creation-boundary/pi/screen-04-settled.txt` |
| Done line | `parity/evidence/setup-benny/creation-boundary/pi/done-copy.txt` |
| Observations (rescored) | `parity/evidence/setup-benny/creation-boundary/pi/observations.json` |
| Rescore note | `parity/research/setup-benny-creation-pi-002/rescore-4d40a1d5.json` |
| Host probe | `parity/evidence/setup-benny/creation-boundary/host-env-probe.json` (`piBuiltInAutomateSkillPresent=true`, `automationsEditorUiAvailableInPiPty=true`) |
| Capture results | `parity/evidence/setup-benny/creation-boundary/capture-results.json` |

Draft revision witnessed on screen and on disk under `/tmp/pi-ref-agent/pstack-automations/.../definition.json` for `benny-triage` with trigger `slack.top_level` / `C-FIXTURE-TEST-CHANNEL`.

## Scorer note

Live capture initially printed `outcome=boundary_violated` because settled text said “I did not call AutomationEnable”. Rescore after extending `forbidEnable` yields `editor_saved_disabled` with `contractHeld=true` for the Pi half only. That is not a requirement verify.

## Forbidden checks

| Gate | Held |
| --- | --- |
| No ledger edits by this unit | yes |
| No Enable / Activate | yes (`enabledCalled=false`) |
| No Slack posts | yes |
| No Cursor desktop | yes |
| No deep link / backend URL finish | yes |
| No further subagents | yes |

Pre-existing dirty ledger working tree was left alone.

## Artifacts

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-journey-setup-benny-creation-pi-002-report.md` |
| Disposition | `parity/research/setup-benny-creation-pi-002/disposition.json` |
| Decision trail | `parity/research/setup-benny-creation-pi-002/decisions.tsv` |
