# Cursor `/automate` → Pi step map

Cross-check. `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` expectedObservation and forbiddenSideEffects.

| # | Cursor `/automate` step (setup-benny §7) | Pi native today | Gap | Proposed Pi piece |
| --- | --- | --- | --- | --- |
| 1 | User explicitly asks to create | Agent reads setup-benny; no create without ask | none for policy | Keep policy in `/automate` + setup-benny Pi adapter text |
| 2 | Read built-in `automate` skill | Missing. Probe `piBuiltInAutomateSkillPresent=false`. Path checked. `skills/automate/SKILL.md` | missing skill | Add `extensions/pi-pstack/skills/automate/SKILL.md` (creation-only) |
| 3 | Discover Slack channels, repo, integrations | No automate discovery tools. Slack MCP may be absent | discovery helpers optional | Skill may ask operator / read committed config. Do not invent live Slack |
| 4 | Confirm pack + config files committed | Agent can run git checks | none | Skill step. Fail closed if not committed |
| 5 | Show draft table | Chat table only | no structured draft review UI | `AutomationPrepare` returns draft; skill prints table; `ctx.ui.confirm` for approval |
| 6 | Obtain approval | Chat yes | weak | `ctx.ui.confirm('Approve automation draft?', revision JSON)` |
| 7 | Ask readiness | Chat | weak | `ctx.ui.confirm('Open Automations editor for this draft?', name+revision)` |
| 8 | Open Automations editor | **Absent.** `automationsEditorUiAvailableInPiPty=false` | editor UI | `AutomationOpenEditor` via `ctx.ui.custom` (or structured `ctx.ui` editor) showing name, trigger, instructions, tools, Inactive |
| 9 | Editor save (Inactive / disabled) | N/A | save | `AutomationSave` writes `definition.json`, `kind=disabled`. No ingress start |
| 10 | Do not enable before thread-safety | `RoutineEnable` exists for **webhook** only and starts worker | wrong domain for Benny | Separate `AutomationEnable` gated on `thread-safety.json`. Creation unit never calls it |
| 11 | No direct automation backend | Held when agent stops at env-blocked | risk if someone adds HTTP create | Forbid network create tools. Persist only local draft files |
| 12 | No draft-field URL / deep link | N/A on Pi | keep ban | Skill + tests forbid URL finish |

## Exists vs missing (summary)

**Exists (webhook routines only).** `RoutinePrepare`, `RoutineInspect`, `RoutineEnable` (`ui.confirm`), `RoutineDisable`. Persist under `getAgentDir()/pstack-routines/<owner>/`. Trigger hard-coded `{ type: 'webhook' }`. Used by `/make-bot-ui`.

**Missing for Benny creation-boundary.** Built-in `/automate` skill. Slack (or general) automation draft model. List/editor chrome readable in Pi PTY. Disabled save that is not webhook enable. Thread-safety gate file before enable.

**Unrelated.** `automate-me` personal mode skill. Do not overload it.

## ForbiddenSideEffects cross-check

| Forbidden | Design response |
| --- | --- |
| Calling a direct automation backend | No cloud create API. Local filesystem draft only |
| Opening a draft-field browser URL or protocol deep link to finish creation | Finish is `AutomationOpenEditor` + `AutomationSave` in Pi TUI/RPC UI |
