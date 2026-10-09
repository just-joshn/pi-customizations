# Report. u-pi-automate-editor-chrome-001

**status.** Editor chrome shipped. Requirement stays unverified. Ledgers untouched.

## What shipped

Real Pi TUI Automations editor via `ctx.ui.custom`, replacing the `ctx.ui.editor` stub.

| Piece | Path |
| --- | --- |
| Editor panel | `extensions/pi-pstack/src/automations-editor.ts` |
| Tool wire | `extensions/pi-pstack/src/automations.ts` (`AutomationOpenEditor`) |
| Output schema | `extensions/pi-pstack/src/automation-output-schemas.ts` |
| Skill | `extensions/pi-pstack/skills/automate/SKILL.md` |
| Panel tests | `extensions/pi-pstack/test/automations-editor.test.ts` |
| Tool tests | `extensions/pi-pstack/test/automations.test.ts` |
| Probe detection | `parity/scripts/probe-setup-benny-creation-boundary-host.mjs` |
| Evidence | `parity/research/pi-automate-editor-chrome-001/` |

Chrome shows automation **name as title**, **State: Inactive**, editable description/instructions/trigger/tools, Save (disabled persist) and Cancel. Marker `pi-automations-editor-v1`.

## Design choices

| Option | Verdict |
| --- | --- |
| A Field-focused form (`questions-panel` pattern) | Shipped |
| B Titled JSON buffer in custom chrome | Rejected. Weaker field chrome and weaker tests |

Save in the editor calls `saveAutomation` (AutomationSave path) and returns the edited definition with `kind=disabled`. Cancel leaves the draft disabled without writing editor edits. Enable still refuses without thread-safety.

## Throughput checkpoint

- Blocking first steps. Panel types + reducer before tool wire and probe flip.
- Independent workstreams. n/a. Single owner. Shared `automations.ts` serializes.
- Shared mutable state. None beyond sequential tool execution on the draft directory.
- Smallest safe decomposition. One inline owner. Brief forbade further subagents beyond how/architect.

## Verification

```bash
cd extensions/pi-pstack && bun run test test/automations.test.ts test/automations-editor.test.ts
cd extensions/pi-pstack && bun run typecheck
node parity/scripts/probe-setup-benny-creation-boundary-host.mjs
```

Results (measured).

| Check | Result |
| --- | --- |
| automations + editor tests | 15 passed |
| typecheck | green |
| `automationsEditorUiAvailableInPiPty` | **true** |
| `piBuiltInAutomateSkillPresent` | true |

### How detection works

Probe `detectPiAutomationsEditorChrome()` requires all of:

1. `src/automations-editor.ts` exports `AUTOMATIONS_EDITOR_CHROME = 'pi-automations-editor-v1'` plus `renderAutomationsEditor` / `reduceAutomationsEditor`, and renders Inactive state.
2. `src/automations.ts` imports the editor module, opens via `ui.custom`, does not call `ui.editor(`, and stamps the chrome marker.
3. `skills/automate/SKILL.md` exists.
4. `test/automations-editor.test.ts` covers Inactive chrome plus save and cancel dispositions.

## Non-verify statement

**Do not mark `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` verified.** This unit did not edit `parity/requirements.json`, `parity/mismatches.json`, or `parity/progress.md`. No paired Cursor+Pi creation-boundary journey was run. Editor chrome presence is necessary and not sufficient for verify. Requirement status remains unverified.

## Open decisions

- Thread-safety receipt writer + real `AutomationEnable` runtime (later unit).
- setup-benny Pi adapter text still points at Cursor `/automate` wording (design gap list item 6).
- Live PTY journey exercising the custom component end to end (unit tests + probe detection only in this unit).
