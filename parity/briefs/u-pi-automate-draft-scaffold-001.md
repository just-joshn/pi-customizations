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
