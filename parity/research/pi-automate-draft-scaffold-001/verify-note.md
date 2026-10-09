# Scaffold verify note

Targeted tests.

```bash
cd extensions/pi-pstack && bun run test test/automations.test.ts test/native-tool-metadata.test.ts
```

Result. 13 passed (7 automation + 6 metadata family cases including `pstack_automations`).

Behavior covered.

- `AutomationPrepare` writes `definition.json` under `getAgentDir()/pstack-automations/{owner}/{id}/` with no `status.json` (kind=disabled).
- `AutomationOpenEditor` uses `ctx.ui.editor` titled `Automations: {name} (Inactive)` and does not enable.
- `AutomationSave` re-persists `kind=disabled` and never starts ingress.
- `AutomationEnable` returns `enabled=false`, `refused=true` without `thread-safety.json`.

Probe.

- `piBuiltInAutomateSkillPresent` is true when `skills/automate/SKILL.md` exists (measured true after this unit).
- `automationsEditorUiAvailableInPiPty` remains false.

Non-verify.

`PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` stays unverified. Ledgers were not edited. No Slack, no Cursor Automations backend, no draft enable.
