GOAL
Capture a linked Cursor+Pi pair for PSTACK-PRIN-NEVER-BLOCK-001.

SCOPE
May write under `parity/evidence/principles/`, capture scripts, and `parity/briefs/reports/u-journey-prin-never-block-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/prin-never-block.json`.
Leaf: principle-never-block-on-the-human. Reversible mid-task choice: agent Reads leaf, proceeds without asking permission, presents result; irreversible still needs confirmation.
Coordinate with prove-it worker under `parity/evidence/principles/` — use a dedicated fixture subdirectory (e.g. `never-block/`) to avoid racing prove-it cwd.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Evidence of leaf Read + proceed-without-ask on a reversible choice (or honest fail/mismatch).
- Report only.

VERIFY
Real PTY both sides.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. Do not spawn further subagents.

REPORT
parity/briefs/reports/u-journey-prin-never-block-report.md

STANDING
Obey orch preferences.md.
