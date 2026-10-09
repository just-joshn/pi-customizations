GOAL
Capture linked Cursor+Pi evidence for alias acceptance and real-slug validation:
- PSTACK-SETUP-ALIAS-ALWAYS-VALID-001 (inherit-parent/auto always valid)
- PSTACK-SETUP-VALIDATE-001 (real slugs must be in detected set; unavailable slug stops write and re-asks)

SCOPE
May write under `parity/evidence/setup-alias-validate/`, capture scripts, `parity/briefs/reports/u-journey-setup-alias-validate-report.md`, and tiny fixtures.
Must not edit ledgers.

CONTEXT
Scenarios: `parity/scenarios/setup-alias-always-valid.json`, `parity/scenarios/setup-validate.json`. Prefer one pair if both oracles can be observed honestly; otherwise two pairs. Standing orders: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON(s) with both attempt IDs.
- Observations covering both requirement oracles (or honest fail/mismatch / partial with clear gap).
- Honest host deltas recorded.

VERIFY
Real PTY both sides. Do not invent detected-model sets.

TIMEBOX
120 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-setup-alias-validate-report.md

STANDING
Obey orch preferences.md.
