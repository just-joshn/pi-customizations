GOAL
Capture a linked Cursor+Pi pair for PSTACK-SETUP-VERIFY-OFFER-001: after setup confirm, when the project has neither verify-* skill nor existing harness, offer once to generate via /create-verification-skill; on yes invoke; on no continue without pushing.

SCOPE
May write under `parity/evidence/setup-verify-offer/`, capture scripts under `parity/scripts/`, and `parity/briefs/reports/u-journey-setup-verify-offer-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-verify-offer.json`. Reuse setup-rerun / create-verify harness patterns. Prefer a clean temp project without verify-* skills. If concurrent with budget-apply captures, avoid racing `~/.cursor/rules/pstack-models.mdc` (serialize Cursor rule writes or use an isolated home/rule path).
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations cover offer-once and yes/no branch (at least one branch paired; note the other if not).
- Honest host deltas; no ledger edits.

VERIFY
Real PTY both sides. Re-read pair + screens.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-setup-verify-offer-report.md

STANDING
Obey orch preferences.md.
