# u-journey-setup-benny-creation-pi-001 report

**status.** Fresh Pi measure. Automations editor in Pi PTY. **no.** Ledgers untouched by this unit. No Save. No Activate. No Slack. No invented Pi Automations UI.

throughput checkpoint: n/a, read-only investigation

## Merge recommendation

| Field | Value |
| --- | --- |
| Requirement | `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` |
| Verify | **no** |
| Pi editor available | **no** |
| Freeze vs keep-unverified (Pi half) | **keep-unverified** |
| Why | Fresh probe and Pi attempt still lack `/automate` → Automations editor handoff. Cursor list + editor-title halves are already paid. Pair is not complete. Prefer keep-unverified over freeze so a future Pi editor surface can finish the pair. Freeze only if the owner accepts permanent Pi-incapable for this requirement. |

## Attempt IDs

| Label | ID | Result |
| --- | --- | --- |
| Fresh Pi PTY | `f4c7eec5-6ac5-4431-b4b1-23c7e267dc96` | `STATUS=env-blocked reason=no /automate skill or Automations editor in this CLI host`. Screens show honest stop text only. No Add Trigger / Agent Instructions / `benny-triage` editor chrome. |
| Prior Pi env note | `cd378e36-ef2e-4810-ae5d-74a5169f204c` | Keep as historical. Superseded for freshness by `f4c7eec5`. |
| Cursor list (paid, prior) | `e11d7225-4c8a-4c09-8f30-273e941a52d2` | Inactive `benny-triage` in Mine. |
| Cursor editor title (paid, prior) | `475ab346-80a0-4d73-8ae1-d2b8042ee66f` | Same-frame editor titled `benny-triage`. |
| Cursor editor re-verify (paid, prior) | `2c525e93-3392-4253-81ef-dd965fde2e7d` | OCR/AX package on `475ab346` frame. |

## Fresh probe

| Field | Value |
| --- | --- |
| `probedAt` | `2026-10-09T08:24:22.570Z` |
| `automationsEditorUiAvailableInPiPty` | `false` |
| `piBuiltInAutomateSkillPresent` | `false` |
| `runnable` | `false` |
| Path | `parity/evidence/setup-benny/creation-boundary/host-env-probe.json` |
| Research copy | `parity/research/setup-benny-creation-pi-001/host-env-probe.json` |

Probe lever update. `parity/scripts/probe-setup-benny-creation-boundary-host.mjs` now stamps `probedAt` and records the Pi skill paths checked. PTY editor flags remain product literals until an in-PTY editor exists.

## Pi evidence

| Step | Evidence |
| --- | --- |
| Identity | `parity/evidence/setup-benny/creation-boundary/pi/f4c7eec5-6ac5-4431-b4b1-23c7e267dc96/identity.json` |
| Done line | `parity/evidence/setup-benny/creation-boundary/pi/done-copy.txt` |
| Settled screen | `parity/evidence/setup-benny/creation-boundary/pi/screen-04-settled.txt` |
| Observations | `parity/evidence/setup-benny/creation-boundary/pi/observations.json` |

Agent read setup-benny, wrote only the status line, enabled nothing, invented no editor UI.

## Hybrid

Pi+desktop hybrid was considered and not claimed. Standing preferences forbid using Cursor as an implementation backend for Pi. Desktop Automations chrome remains a Cursor surface. Claiming it as the Pi half would invent a Pi finish path that Pi did not drive.

## Scorer caveat

`observations.json` reports `outcome=boundary_violated` and `forbidden=true` because the prompt phrase "Do not call a direct automation backend or backend automation tool" collides with the backend-tool regex when "call" appears nearby. Session inventory has `boundaryViolated=false`. Screens have none of the editor chrome markers. Treat the done line and screens as the oracle, not the false-positive forbidden flag.

## Forbidden checks

| Gate | Held |
| --- | --- |
| No ledger edits by this unit | yes |
| No Activate / enable | yes |
| No Slack posts | yes |
| No further subagents | yes |
| No invented Pi Automations UI | yes |

Pre-existing dirty ledger working tree was left alone. This unit did not write `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`.

## Artifacts

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-journey-setup-benny-creation-pi-001-report.md` |
| Disposition | `parity/research/setup-benny-creation-pi-001/disposition.json` |
| Decision trail | `parity/research/setup-benny-creation-pi-001/decisions.tsv` |
| Fresh probe | `parity/evidence/setup-benny/creation-boundary/host-env-probe.json` |
| Fresh Pi attempt | `parity/evidence/setup-benny/creation-boundary/pi/f4c7eec5-6ac5-4431-b4b1-23c7e267dc96/` |

## Operator notes

1. Do not enable Inactive `benny-triage` until thread-safety work is ready.
2. Pi half stays unpaid until a real Pi `/automate` editor handoff exists, or the owner freezes the requirement as Pi-incapable.
3. Re-run `node parity/scripts/probe-setup-benny-creation-boundary-host.mjs` after any Pi package change that adds `skills/automate`.

## Attention

reviewed by poteto-agent under brief (no further subagents)

- Pi editor available. no.
- Fresh attempt. `f4c7eec5-6ac5-4431-b4b1-23c7e267dc96`.
- Verify recommendation. no / keep-unverified.
