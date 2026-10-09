# u-journey-setup-benny-editor-title-001 report

**status.** Cursor editor-title half paid by re-verified same-frame PNG/OCR/AX. Live reopen blocked by screen lock. Pi half still env-blocked. Ledgers untouched. No Save. No Activate. No Slack.

throughput checkpoint: n/a, read-only investigation

## Merge recommendation

| Field | Value |
| --- | --- |
| Requirement | `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` |
| Verify | **no** |
| Cursor half enough to keep verify=no pending Pi | **yes** |
| Why | Same-frame Automations editor chrome titled `benny-triage` is witnessed (breadcrumb, Inactive, Add Trigger, Agent Instructions). Pi still has no Automations editor handoff in PTY (`cd378e36` / host-env probe). Paired verify is not earned. |

## Attempt IDs

| Label | ID | Result |
| --- | --- | --- |
| Primary oracle (collateral make-bot wrong-editor) | `475ab346-80a0-4d73-8ae1-d2b8042ee66f` | Editor open as `Automations > benny-triage`. Inactive + Add Trigger + Agent Instructions. Save/Activate not pressed by harness. |
| Re-verify package this unit | `2c525e93-3392-4253-81ef-dd965fde2e7d` | Fresh Vision OCR + AX oracle on copied `h04-final.png`. `editorTitleWitnessed=true`. |
| Live open-draft (blocked) | `fdd603d5-ab1e-4b75-89a1-fa8165b18b51` | `desktop-share-status` `ready=false` `screenLocked=true`. Zero draft-row hits. System Events AXPress false. No Save/Activate. |
| Prior Benny list presence | `e11d7225-4c8a-4c09-8f30-273e941a52d2` | Inactive `benny-triage` in Mine (kept). |
| Pi env note (keep) | `cd378e36-ef2e-4810-ae5d-74a5169f204c` | `automationsEditorUiAvailableInPiPty: false`. |

## Cursor oracle (PNG / OCR / AX)

Source screen. `475ab346` `h04-final.png` (also packaged under `2c525e93`).

| Marker | Evidence |
| --- | --- |
| Title breadcrumb | OCR `Automations > benny-triage` |
| Title field | AX static value `benny-triage`; OCR title `benny-triage` |
| Inactive | OCR + AX |
| Add Trigger | AX combo/static (OCR often missed under command-palette overlay) |
| Agent Instructions | OCR + AX heading; Benny triage-issue-reports body text |
| Untitled | absent on final editor frame |

Oracle artifact. `parity/evidence/setup-benny/creation-boundary/agents-window/2c525e93-3392-4253-81ef-dd965fde2e7d/editor-title-oracle.json`

## Live reopen

Helper reported screen locked before and during `open-draft benny-triage`. System Events saw `windows=0` on Cursor while locked. Discard of stuck Untitled was not required (Untitled editor chrome not present in the locked session dump). Prefer unlock, then rerun:

`python3 parity/scripts/capture-automations-desktop-agents-window.py open-draft benny-triage`

## Pi half

Honest keep of prior env note. Host probe still reports no Automations editor UI in Pi or cursor-agent PTY. No new Pi attempt fabricated.

Probe. `parity/evidence/setup-benny/creation-boundary/host-env-probe.json`

## Save / Activate / Slack

| Gate | Held |
| --- | --- |
| No Save pressed by this unit | yes |
| No Activate / enable | yes |
| No Slack posts | yes |
| No ledger edits | yes |
| No further subagents | yes |

Save appears as a chrome label on the editor frame. Harness disposition for `475ab346` records `savedByHarness: false`. This unit did not press it.

## Lever changes

`parity/scripts/capture-automations-desktop-agents-window.py`

- New mode `open-draft [draft-name]`
- Discard stuck Untitled via Escape / System Events Discard / narrow element_index (never Save)
- Draft-row click prefers element_index, then System Events AXPress (no helper xy)
- Editor-title oracle on OCR + AX

## Artifacts

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-journey-setup-benny-editor-title-001-report.md` |
| Disposition | `parity/research/setup-benny-editor-title-001/disposition.json` |
| Re-verify evidence | `parity/evidence/setup-benny/creation-boundary/agents-window/2c525e93-3392-4253-81ef-dd965fde2e7d/` |
| Live blocked evidence | `parity/evidence/setup-benny/creation-boundary/agents-window/fdd603d5-ab1e-4b75-89a1-fa8165b18b51/` |
| Source oracle screens | `parity/evidence/make-bot-ui/auth-header-probe/475ab346-80a0-4d73-8ae1-d2b8042ee66f/` |

## Operator notes

1. Unlock the Mac display before expecting Agent Helper frontmost clicks.
2. Discard Inactive `Untitled` drafts if they still block the list. Do not Save or Activate Benny drafts.
3. Keep Inactive `benny-triage` until thread-safety work is ready. Do not enable.

## Attention

reviewed by poteto-agent under brief (no further subagents)

- Cursor editor-title debt from `e11d7225` is closed by `475ab346` + this re-verify.
- Requirement stays unverified until Pi half (or freeze) lands.
