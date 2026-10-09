GOAL
Capture a linked Cursor+Pi pair for PSTACK-SETUP-MAINTAIN-VERIFY-LIVE-PASS-001.

SCOPE
May write under `parity/evidence/maintain-verify/`, capture scripts, and `parity/briefs/reports/u-journey-setup-maintain-verify-live-pass-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-maintain-verify-live-pass.json`.
Expected: live pass runs even when source looks clean; coordinator owns driving; every feature exercised once with doctor-before-drive, evidence-survives-cleanup, no leftover residue; doctor failure from skill drift fixed under edit scope and retried once before blocked; verified-unreachable needs concrete prerequisite + attempted route; harness fixes re-driven live before ship; final teardown after last drive; evidence remains.
Use a dedicated fixture copy so outcomes/source-wave workers do not race.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Live-pass invariants evidenced (or honest fail/mismatch).
- Report only.

VERIFY
Real PTY both sides. Keep doctor/drive/evidence/cleanup artifacts.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-setup-maintain-verify-live-pass-report.md

STANDING
Obey orch preferences.md.
