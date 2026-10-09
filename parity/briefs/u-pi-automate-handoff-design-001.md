GOAL
Design (and spike only if cheap) a Pi-native equivalent of Cursor's built-in `/automate` → reviewed Automations editor handoff, sufficient for `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` Pi half. Produce a mergeable design + gap list. Do **not** claim the requirement verified. Do **not** invent Cursor Automations backend calls.

SCOPE
May write `parity/research/pi-automate-handoff-design-001/`, `parity/briefs/reports/u-pi-automate-handoff-design-001-report.md`.
May sketch types under `extensions/pi-pstack/` only if the design names a minimal spike and tests stay green — prefer design-only if spike exceeds timebox.
Must not edit ledgers. Must not set requirement verified.

CONTEXT
Cursor half paid (list + editor title). Pi `f4c7eec5` env-blocked: no `/automate`, no Automations editor UI. Freeze-prep Option A keep-unverified until Pi editor exists. Existing Pi pieces: `RoutinePrepare` / `RoutineEnable` / `ui.confirm` for webhook routines; `automate-me` is unrelated (personal mode skill). Reference finish path: setup-benny SKILL “only finish path is built-in automate skill's reviewed Automations editor handoff.”
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Named data model for a Pi automation draft (fields, persistence path, disabled-until-thread-safety).
- Mapped Cursor `/automate` steps → Pi native tools/UI (what exists vs missing).
- Explicit non-goals (no deep-link finish; no fabricated Slack).
- Recommended next implementation unit brief text (copy-paste ready).
- Ledgers untouched; requirement stays unverified.

VERIFY
Cross-check against setup-benny creation-boundary expectedObservation and forbiddenSideEffects.

TIMEBOX
75 minutes.

FORBIDDEN
No ledger edits. No freeze. No claiming creation-boundary closed. No further subagents beyond how/architect if playbook requires (prefer inline). No desktop Automations capture (console may be locked).

REPORT
parity/briefs/reports/u-pi-automate-handoff-design-001-report.md

STANDING
Obey orch preferences.md.
