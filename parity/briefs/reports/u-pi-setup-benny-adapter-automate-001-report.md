# Report. u-pi-setup-benny-adapter-automate-001

## Status

MERGED (package + probe). Design gap 6 closed. No ledger claim that the three unpaid env mismatches are resolved.

## What changed

| Surface | Change |
| --- | --- |
| `host/adapters/benny/SKILL.md` | First-time Slack Benny creation routes through host `/automate` → `AutomationPrepare` / `AutomationOpenEditor` / disabled Save. Refuses webhook `Routine*` finish. Thread-safety → `AutomationRecordThreadSafety`; `AutomationEnable` stays refuse-closed. |
| `scripts/resource-rows/60-help.mjs` | poteto-help lists `/automate` among host skills. |
| `test/catalog.test.ts` | Host skill census includes `automate`. |
| `test/benny.test.ts` / `test/benny-parity.test.ts` | Assert AutomationPrepare path; forbid Call `RoutinePrepare`/`RoutineEnable`. |
| `parity/scripts/probe-setup-benny-creation-boundary-host.mjs` | New check `piSetupBennyAdapterUsesAutomatePath`. |

## Probe

Re-ran `probe-setup-benny-creation-boundary-host.mjs` after the adapter edit:

- `piBuiltInAutomateSkillPresent=true`
- `automationsEditorUiAvailableInPiPty=true`
- `piThreadSafetyReceiptToolPresent=true`
- `piSetupBennyAdapterUsesAutomatePath=true`
- Verdict remains `blocker` on Cursor-PTY / docs harness limits only (unchanged).

## Package verify

`npm test` in `extensions/pi-pstack`: 220 files passed, 2275 tests passed (1 skipped).

## Non-claims

- Does not close `BENNY-TRIAGE-VALID-CONFIG-ENV`, `MAKE-BOT-UI-KEY-SERVER-HOST`, or `SETUP-BENNY-THREAD-SAFETY-ENV`.
- Does not claim live Slack seven-checks or make-bot Generate.
- Does not set `completeDependencyClosure` or freeze acceptance.
- Console still `IOConsoleLocked=Yes` at probe time; wait-unlock continues.

## Design gap refresh

`parity/research/pi-automate-handoff-design-001/design.md` gap list updated: 1–3 and 6 closed; 4 open; 5 receipt paid / live enable unpaid.
