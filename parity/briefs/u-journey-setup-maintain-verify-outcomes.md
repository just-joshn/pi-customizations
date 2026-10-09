GOAL
Capture a linked Cursor+Pi pair for PSTACK-SETUP-MAINTAIN-VERIFY-OUTCOMES-001. Prefer also closing SHIP-001 when the same pair honestly proves PR-or-no-PR rules. Do not overclaim SOURCE-WAVE or LIVE-PASS.

SCOPE
May write under `parity/evidence/maintain-verify/`, capture scripts, and `parity/briefs/reports/u-journey-setup-maintain-verify-outcomes-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-maintain-verify-outcomes.json` (and ship sibling if covered).
Prior pair `parity/evidence/create-verify/pair-create-verify-maintain-1.json` already closed CMD outcomes + EDIT-SCOPE; Pi `changed` without PR so SETUP-OUTCOMES/SHIP stayed open — do not reuse that pair to overclaim SETUP-OUTCOMES.
SETUP oracle: clean (full coverage, nothing to ship, no branch/PR), changed (one PR of proven corrections), or blocked (blocker stated).
Reuse locate fixture patterns under `parity/evidence/maintain-verify/`. Avoid racing `pstack-models.mdc`.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Named outcome matches SETUP definitions (if changed, a real PR path must be evidenced; else use clean or blocked).
- Report only.

VERIFY
Real PTY both sides. Outcome marker + PR/no-PR evidence.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-setup-maintain-verify-outcomes-report.md

STANDING
Obey orch preferences.md.
