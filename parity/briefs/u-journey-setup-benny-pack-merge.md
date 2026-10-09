GOAL
Capture a linked Cursor+Pi pair for PSTACK-SETUP-BENNY-PACK-MERGE-001.

SCOPE
May write under `parity/evidence/setup-benny/`, capture scripts, and `parity/briefs/reports/u-journey-setup-benny-pack-merge-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-benny-pack-merge.json`.
Expected: entire source pack merges into `<target>/.cursor/automations/benny/` with create-if-absent, same relative paths, preserve destination-only files, never overwrite user-owned config/feature/routing maps outside destination, merge source-managed conflicts without discarding local edits or stopping when ownership ambiguous, verify required pack files afterward.
Use a disposable fixture target under evidence. Prefer dedicated fixture-app copy so no-secret/control workers do not race.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Merge behavior evidenced on disk (or honest fail/mismatch).
- Report only.

VERIFY
Real PTY both sides. Diff fixture before/after.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. No real secrets.

REPORT
parity/briefs/reports/u-journey-setup-benny-pack-merge-report.md

STANDING
Obey orch preferences.md.
