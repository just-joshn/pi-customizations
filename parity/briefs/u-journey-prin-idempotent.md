GOAL
Capture a linked Cursor+Pi pair for PSTACK-PRIN-IDEMPOTENT-001.

SCOPE
May write under `parity/evidence/principles/`, capture scripts, and `parity/briefs/reports/u-journey-prin-idempotent-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/prin-idempotent.json`.
Leaf: principle-make-operations-idempotent. Lifecycle command that may crash mid-run: Reads leaf; re-run after partial prior execution converges to same end state.
Dedicated fixture `idempotent/` under `parity/evidence/principles/`.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Leaf Read + re-run converge evidenced (or honest fail).
- Report only.

VERIFY
Real PTY both sides. Prefer a scripted mid-crash then re-run proof.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. Do not spawn further subagents.

REPORT
parity/briefs/reports/u-journey-prin-idempotent-report.md

STANDING
Obey orch preferences.md.
