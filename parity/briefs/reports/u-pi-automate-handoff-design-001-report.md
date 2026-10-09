# u-pi-automate-handoff-design-001 report

**status.** Design only. Mergeable. Ledgers untouched. Creation-boundary stays unverified. No desktop capture. No spike.

throughput checkpoint: n/a, read-only investigation

## Design verdict

**Option B.** Add a Pi-native `AutomationDraft` store and built-in `/automate` skill with a TUI Automations editor handoff. Save always leaves the draft disabled. Do not reuse webhook `RoutineEnable` as the Benny finish path. Do not invent Cursor Automations backends.

Requirement `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` stays unverified. Freeze-prep Option A (keep-unverified) unchanged.

## Persistence path proposal

```text
{getAgentDir()}/pstack-automations/{ownerHash}/{automationId}/
  definition.json
  status.json            # absent ⇒ disabled
  thread-safety.json     # later unit only
```

`ownerHash = sha256(cwd + "\0" + sessionId)`. Directory mode `0700`. Durable writes mirror `extensions/pi-pstack/scripts/routine-client.mjs`.

Draft fields. `name`, `description`, `instructions`, optional `operationalPath`, `trigger` (`slack.top_level` | `webhook`), `tools[]`, `kind: "disabled"`, `revision` (sha256).

Disabled until thread-safety. `AutomationEnable` (future) refuses unless `thread-safety.json` matches the revision. Creation path never enables.

## Cursor → Pi step map summary

| Cursor step | Pi today | Proposed |
| --- | --- | --- |
| Built-in `/automate` skill | missing (`automate-me` only) | `skills/automate/SKILL.md` |
| Discover integrations | none for automate | config / operator; no fabricated Slack |
| Confirm pack committed | git checks possible | skill fail-closed |
| Draft table + approval | none | `AutomationPrepare` + `ui.confirm` |
| Readiness + open editor | **absent** (probe false) | `AutomationOpenEditor` via `ctx.ui` |
| Editor save Inactive | absent | `AutomationSave` → `kind=disabled` |
| Enable after thread-safety | webhook `RoutineEnable` only | separate gated enable (not this design’s ship) |

Full table. `parity/research/pi-automate-handoff-design-001/step-map.md`

## Options (tradeoffs)

| Option | Meaning | Fits prefs / oracle |
| --- | --- | --- |
| A Reuse `Routine*` | Map Benny into webhook routines | no (wrong trigger; enable starts receiver) |
| B Local drafts + TUI editor | New store + `/automate` + editor save disabled | **yes** |
| C Confirm-only | No editor chrome | no (probe/journeys need editor surface) |

## Overview

Cursor paid list + editor title for `benny-triage` (`e11d7225`, `475ab346` / `2c525e93`). Pi `f4c7eec5` env-blocked. No `/automate`, no editor UI. Existing Pi pieces cover webhook draft/enable only (`routines.ts`). Creation-boundary expectedObservation demands a built-in automate reviewed editor handoff with no backend/URL finish and no enable before thread-safety.

## Key concepts

Creation boundary. Reviewed editor handoff only.
AutomationDraft. Disabled revisioned local definition.
Editor handoff. Operator-visible Pi UI titled with the automation name, Inactive, then Save without enable.
Webhook routines. Parallel product for `/make-bot-ui`. Keep separate until an explicit migrate.

## How it works

Operator asks to create. `/automate` (new) builds a draft, shows a table, gets approval and readiness via `ui.confirm`, opens the editor, saves disabled. Enable is a later gated tool. Forbidden finish paths stay banned by skill text and by having no backend create tool.

## Where things live

| Kind | Path |
| --- | --- |
| Design | `parity/research/pi-automate-handoff-design-001/design.md` |
| Data model | `parity/research/pi-automate-handoff-design-001/data-model.json` |
| Step map | `parity/research/pi-automate-handoff-design-001/step-map.md` |
| Disposition | `parity/research/pi-automate-handoff-design-001/disposition.json` |
| Next brief | `parity/research/pi-automate-handoff-design-001/next-unit-brief.md` |
| Webhook reference | `extensions/pi-pstack/src/routines.ts` |
| Creation-boundary oracle | `parity/requirements.json` → `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` |
| Probe | `parity/evidence/setup-benny/creation-boundary/host-env-probe.json` |
| This report | `parity/briefs/reports/u-pi-automate-handoff-design-001-report.md` |

## Gotchas

`automate-me` is not `/automate`. Do not overload it.
`RoutineEnable` is not the Benny editor handoff.
Do not flip `automationsEditorUiAvailableInPiPty` until a real in-PTY editor exists.
Scorer false positive on “call … backend” phrasing remains known. Screens and done line are the oracle.
Console lock blocks Cursor desktop capture. It does not block this design or a Pi-only scaffold unit.

## Explicit non-goals

- No deep-link finish
- No fabricated Slack
- No Cursor Automations backend calls
- No creation-boundary verified claim
- No ledger edits
- No thread-safety seven-checks in the next scaffold unit

## Oracle cross-check

| Clause | Design |
| --- | --- |
| expectedObservation. finish via built-in automate reviewed editor handoff | Option B skill + editor + save |
| expectedObservation. neither enabled until thread-safety after editor save | save `kind=disabled`; enable gated later |
| forbiddenSideEffects. direct automation backend | local filesystem only |
| forbiddenSideEffects. draft-field URL / deep link | TUI/RPC UI finish only |

## Next-unit brief (copy-paste)

Path. `parity/research/pi-automate-handoff-design-001/next-unit-brief.md`

```text
GOAL
Implement the Pi-native `/automate` creation path scaffold from `parity/research/pi-automate-handoff-design-001/`: `AutomationDraft` persistence under `getAgentDir()/pstack-automations/`, `AutomationPrepare` / `AutomationInspect` / `AutomationOpenEditor` / `AutomationSave` (always disabled), and `skills/automate/SKILL.md`. Prove a disabled named draft (e.g. `benny-triage`) can be prepared, editor-opened, and saved without enable. Do **not** mark `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` verified. Do **not** implement Slack ingress or `AutomationEnable` beyond a refuse-closed stub if needed.

SCOPE
May edit `extensions/pi-pstack/` (domain, tools, skill, tests) and write evidence/research under `parity/research/pi-automate-draft-scaffold-001/` plus report `parity/briefs/reports/u-pi-automate-draft-scaffold-001-report.md`.
Must not edit ledgers. Must not call Cursor backends. Must not post Slack. Must not enable drafts.

CONTEXT
Design verdict Option B. Persistence path and step map in `parity/research/pi-automate-handoff-design-001/`. Webhook `Routine*` stays separate. Host probe currently expects `skills/automate/SKILL.md`. Standing preferences.md. Console may stay locked. No desktop Cursor capture required for this unit.

ACCEPTANCE
- `AutomationDraft` typed model + durable disabled prepare/save under proposed path.
- `/automate` skill present and creation-only (points at reviewed editor handoff).
- Editor open + save path exercisable in Pi TUI or test double; draft remains `kind=disabled`.
- Unit tests green for prepare/save/refuse-enable-without-thread-safety.
- Probe script updated so `piBuiltInAutomateSkillPresent` can become true when skill ships; editor flag flips only when editor UI is real.
- Ledgers untouched; requirement stays unverified.

VERIFY
Targeted `extensions/pi-pstack` tests for automation draft tools. Manual or harness note that Save does not start ingress. Cross-check forbiddenSideEffects still held.

TIMEBOX
120 minutes.

FORBIDDEN
No ledger edits. No verify claim on creation-boundary. No Slack. No Cursor Automations backend. No deep-link finish. No further subagents beyond how/architect if required (prefer inline).

REPORT
parity/briefs/reports/u-pi-automate-draft-scaffold-001-report.md

STANDING
Obey orch preferences.md.
```

## Ledger safety

This unit did not edit `parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, or other ledgers. Measured intent. Requirement status remains `unverified`.

## Attention

reviewed by poteto-agent under brief (how inline; no further subagents)

- Design verdict. Option B.
- Persistence. `getAgentDir()/pstack-automations/{ownerHash}/{automationId}/`.
- Next brief. `parity/research/pi-automate-handoff-design-001/next-unit-brief.md`.
- Report. this file.
