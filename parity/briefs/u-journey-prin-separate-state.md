GOAL
Capture a linked Cursor+Pi pair for PSTACK-PRIN-SEPARATE-STATE-001.

SCOPE
May write under `parity/evidence/principles/`, capture scripts, and `parity/briefs/reports/u-journey-prin-separate-state-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/prin-separate-state.json`.
Leaf: principle-separate-before-serializing-shared-state. Concurrent actors writing same file/key: Reads leaf; eliminates sharing first.
Dedicated fixture `separate-state/` under `parity/evidence/principles/`.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Leaf Read + share-elimination evidenced (or honest fail).
- Report only.

VERIFY
Real PTY both sides.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. Do not spawn further subagents.

REPORT
parity/briefs/reports/u-journey-prin-separate-state-report.md

STANDING
Obey orch preferences.md.
