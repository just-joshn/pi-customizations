GOAL
Capture a linked Cursor+Pi pair for PSTACK-SETUP-MAINTAIN-VERIFY-SOURCE-WAVE-001.

SCOPE
May write under `parity/evidence/maintain-verify/`, capture scripts, and `parity/briefs/reports/u-journey-setup-maintain-verify-source-wave-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-maintain-verify-source-wave.json`.
Expected: after index hygiene, one read-only subagent per feature file runs concurrently; each returns feature summary, source entry points, likely drift or none, and one live-verification recipe; children never drive the app and never edit files.
Reuse `parity/evidence/maintain-verify/` fixtures. Coordinate with outcomes/live-pass workers — do not race the same fixture cwd; use a dedicated fixture-app copy if needed.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Evidence of concurrent read-only children + required return fields (or honest fail/mismatch).
- Report only.

VERIFY
Real PTY both sides. Prefer Task/subagent events + child outputs on disk.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-setup-maintain-verify-source-wave-report.md

STANDING
Obey orch preferences.md.
