# Architect sketch. Automations editor chrome

## Grounding (how)

Scaffold already had `AutomationDraft` persistence and tools. `AutomationOpenEditor` used `ctx.ui.editor` with a JSON stub. Probe kept `automationsEditorUiAvailableInPiPty=false`. Pattern for real chrome is `questions-panel.ts` + `ctx.ui.custom` in TUI mode.

## Candidates

| Shape | Public surface | Verdict |
| --- | --- | --- |
| A Field-focused form reducer | `initial` / `reduce` / `render` / `result`; fields for description, instructions, trigger JSON, tools; Save/Cancel actions; title=name; State: Inactive | **Accept.** Matches questions-panel and Option B editor handoff |
| B Titled JSON document chrome | Custom wrapper around one multiline JSON buffer with Inactive header | Reject. Editable fields are weaker; harder to assert chrome semantics in unit tests |

## Chosen contract

- Marker `AUTOMATIONS_EDITOR_CHROME = 'pi-automations-editor-v1'`
- Save calls `saveAutomation` (same path as `AutomationSave`), returns edited definition, keeps `kind=disabled`
- Cancel returns `opened=false`, no write
- Non-TUI fails closed (custom components are TUI-only)
