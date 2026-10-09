GOAL
Capture a linked Cursor+Pi pair for PSTACK-SETUP-BENNY-EXISTING-NO-AUTOMATE-001.

SCOPE
May write under `parity/evidence/setup-benny/`, capture scripts, and `parity/briefs/reports/u-journey-setup-benny-existing-no-automate-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-benny-existing-no-automate.json`.
Expected: when updating existing Benny automations, built-in automate skill is not used to search/inspect/update; user gets an editor checklist and updates each automation in its Automations editor without creating replacements/duplicates.
Seed existing automation stubs in a dedicated fixture. If Automations editor is unavailable in PTY, publish honest blocker (do not fabricate editor UI).
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs (or blocker JSON).
- No-automate + checklist evidenced (or honest env blocker).
- Report only.

VERIFY
Real PTY both sides.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. No real secrets. Do not spawn further subagents.

REPORT
parity/briefs/reports/u-journey-setup-benny-existing-no-automate-report.md

STANDING
Obey orch preferences.md.
