GOAL
Capture a linked Cursor+Pi pair for PSTACK-PRIN-SEQUENCE-UNITS-001.

SCOPE
May write under `parity/evidence/principles/`, capture scripts, and `parity/briefs/reports/u-journey-prin-sequence-units-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/prin-sequence-units.json`.
Leaf: principle-sequence-verifiable-units. Multi-unit migration or stacked commits: agent Reads leaf, verifies each unit before the next, orders delivery so a reviewer sees a proving sequence (e.g. failing test then fix).
Use dedicated fixture subdirectory `sequence-units/` under `parity/evidence/principles/`.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Leaf Read + per-unit verify ordering evidenced (or honest fail/mismatch).
- Report only.

VERIFY
Real PTY both sides. Keep unit markers / verify outputs.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. Do not spawn further subagents.

REPORT
parity/briefs/reports/u-journey-prin-sequence-units-report.md

STANDING
Obey orch preferences.md.
