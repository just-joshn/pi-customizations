GOAL
Replace the `ctx.ui.editor` stub in `AutomationOpenEditor` with a real Pi TUI Automations editor surface via `ctx.ui.custom` (pattern: `questions-panel.ts`). Operator-visible chrome must show automation **name as title**, **Inactive** state, instructions/trigger/tools fields, and Save without enable. Flip probe `automationsEditorUiAvailableInPiPty` only when the surface is real and journey-detectable. Do **not** mark `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` verified (paired Cursor+Pi still unpaid).

SCOPE
May edit `extensions/pi-pstack/` (automations editor component, tools, tests, skill wording), `parity/scripts/probe-setup-benny-creation-boundary-host.mjs`, write `parity/research/pi-automate-editor-chrome-001/` + `parity/briefs/reports/u-pi-automate-editor-chrome-001-report.md`.
Must not edit ledgers. Must not enable drafts. Must not Slack/Cursor backends.

CONTEXT
Scaffold: `src/automations.ts` uses `ctx.ui.editor(...)` stub; design Option B requires titled Inactive editor chrome. Probe hardcodes `automationsEditorUiAvailableInPiPty: false` until real chrome. Mirror `src/questions-panel.ts` / `ctx.ui.custom`. Standing prefs.md.

ACCEPTANCE
- Custom TUI editor shows name + Inactive + editable draft fields; Save → `AutomationSave` path / returns edited definition; Cancel leaves disabled.
- Tests cover open/save/cancel and refuse-enable.
- Probe can set `automationsEditorUiAvailableInPiPty: true` with honest detection (e.g. component export + skill path + test proof), not by lying.
- Typecheck + targeted tests green.
- Requirement stays unverified; no paired journey claim.

VERIFY
`bun run test` on automations (+ panel) tests; `bun run typecheck`; re-run host probe JSON for flag.

TIMEBOX
120 minutes.

FORBIDDEN
No ledger edits. No verify claim. No Slack. No further subagents beyond how/architect inline. No desktop Cursor capture required.

REPORT
parity/briefs/reports/u-pi-automate-editor-chrome-001-report.md

STANDING
Obey orch preferences.md.
