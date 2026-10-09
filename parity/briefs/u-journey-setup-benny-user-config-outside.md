GOAL
Capture a linked Cursor+Pi pair for PSTACK-SETUP-BENNY-USER-CONFIG-OUTSIDE-001.

SCOPE
May write under `parity/evidence/setup-benny/`, capture scripts, and `parity/briefs/reports/u-journey-setup-benny-user-config-outside-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-benny-user-config-outside.json`.
Expected: user-owned configuration, feature map, and routing map copies live outside `.cursor/automations/benny/`; copied example files are not edited; pack refreshes may update source-managed files after conflict review but never touch user-owned copies.
Use a dedicated fixture subdirectory. Prefer building on pack-merge fixture patterns without racing other benny workers.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Outside-pack placement + examples untouched evidenced (or honest fail/mismatch).
- Report only.

VERIFY
Real PTY both sides. Diff paths/digests.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. No real secrets.

REPORT
parity/briefs/reports/u-journey-setup-benny-user-config-outside-report.md

STANDING
Obey orch preferences.md.
