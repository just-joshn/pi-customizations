GOAL
Capture a linked Cursor+Pi pair for PSTACK-SETUP-BENNY-NO-SECRET-001. Prefer closing adjacent SETUP-BENNY-* ids only when the same pair honestly proves them.

SCOPE
May write under `parity/evidence/setup-benny/`, capture scripts, and `parity/briefs/reports/u-journey-setup-benny-no-secret-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-benny-no-secret.json`.
Expected: secret values never appear in plugin files, prompts, or committed configuration during Benny setup/config writes.
Use a dummy/fake token fixture (e.g. `xoxb-TEST-NOT-A-REAL-TOKEN`) and prove it is not written into skill/plugin/committed paths; do not use real Slack credentials.
Prior: `parity/evidence/setup-benny/pair-setup-benny-not-slash-1.json` (not-slash only).
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations prove secrets boundary (or honest fail/mismatch).
- Do not overclaim sibling SETUP-BENNY ids.
- Report only.

VERIFY
Real PTY both sides. Diff/search generated files for the fixture secret string.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. No real secrets in evidence.

REPORT
parity/briefs/reports/u-journey-setup-benny-no-secret-report.md

STANDING
Obey orch preferences.md.
