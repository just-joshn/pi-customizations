# Report. u-pi-automate-draft-scaffold-001

**status.** Scaffold landed. Requirement stays unverified. Ledgers untouched.

## What shipped

Pi-native `AutomationDraft` store and creation tools, separate from webhook `Routine*`.

| Piece | Path |
| --- | --- |
| Domain | `extensions/pi-pstack/scripts/automation-domain.mjs` |
| Persistence | `extensions/pi-pstack/scripts/automation-client.mjs` (reuses `durableRecord` / `privateDirectory`) |
| Tools | `extensions/pi-pstack/src/automations.ts` |
| Skill | `extensions/pi-pstack/skills/automate/SKILL.md` |
| Tests | `extensions/pi-pstack/test/automations.test.ts` |
| Probe note | `parity/scripts/probe-setup-benny-creation-boundary-host.mjs` |
| Evidence | `parity/research/pi-automate-draft-scaffold-001/` |

Tools. `AutomationPrepare`, `AutomationInspect`, `AutomationOpenEditor`, `AutomationSave` (always `kind=disabled`), `AutomationEnable` (refuse-closed without thread-safety).

Persistence root. `{getAgentDir()}/pstack-automations/{ownerHash}/{automationId}/definition.json`.

## Design choices

| Option | Verdict |
| --- | --- |
| A Reuse `Routine*` for Benny Slack | Rejected (design pack). Wrong trigger. `RoutineEnable` starts a local receiver. |
| B Parallel `AutomationDraft` + `/automate` | Shipped. Matches Option B design pack. |
| C Confirm-only without editor | Rejected for journeys. This unit uses `ctx.ui.editor` as handoff stub and keeps the PTY editor probe flag false. |

Organizing structure. Typed `AutomationDraft` with a discriminated `trigger` union (`slack.top_level` | `webhook`). Kind is a receipt from absent `status.json`, not a mutable boolean on the definition.

## Throughput checkpoint

- Blocking first steps. Domain + client + output schemas before tools, skill, probe.
- Independent workstreams. n/a. Single owner. Shared `index.ts` registration serializes.
- Shared mutable state. Separate `pstack-automations` tree from `pstack-routines`. Sequential tool execution.
- Smallest safe decomposition. One inline owner. Brief forbade further subagents beyond how/architect.

## Verification

```bash
cd extensions/pi-pstack && bun run test test/automations.test.ts test/native-tool-metadata.test.ts
```

Result. 13 passed. Typecheck green.

Probe (measured after skill ship).

| Flag | Value |
| --- | --- |
| `piBuiltInAutomateSkillPresent` | `true` (skill file present; can flip) |
| `automationsEditorUiAvailableInPiPty` | `false` (real editor chrome not claimed) |

Save does not start ingress. Asserted by absent `status.json` after prepare/save and by enable refuse without `thread-safety.json`.

forbiddenSideEffects held. No Cursor Automations backend. No Slack posts. No draft-field URL or deep link. No enable before thread-safety. No `RoutineEnable` reuse for Benny.

## Non-verify statement

**Do not mark `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` verified.** This unit did not edit `parity/requirements.json`, `parity/mismatches.json`, or `parity/progress.md`. No paired Cursor+Pi creation-boundary journey was run. Requirement status remains unverified.

## Open decisions

- Real in-PTY Automations editor chrome (needed before flipping `automationsEditorUiAvailableInPiPty`).
- Thread-safety receipt writer + real `AutomationEnable` runtime (later unit).
- setup-benny Pi adapter text still points at Cursor `/automate` wording (design gap list item 6).
