GOAL
Capture a linked Cursor+Pi pair for PSTACK-SETUP-BENNY-SETTINGS-ENABLE-001. Prefer closing adjacent SETUP-BENNY-* ids only when the same pair honestly proves them.

SCOPE
May write under `parity/evidence/setup-benny/`, capture scripts, and `parity/briefs/reports/u-journey-setup-benny-settings-enable-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-benny-settings-enable.json`.
Expected: after pack copy, target `.cursor/settings.json` exists with `plugins.pstack.enabled` true; unrelated top-level settings and other plugin entries stay intact; when `plugins.pstack` already exists only `enabled` changes; JSONC comments/syntax preserved when applicable; file validates after edit.
Use a dedicated fixture subdirectory so pack-merge/no-secret workers do not race.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Settings enable + preserve behavior evidenced (or honest fail/mismatch).
- Report only.

VERIFY
Real PTY both sides. Diff settings before/after; validate JSON/JSONC.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. No real secrets.

REPORT
parity/briefs/reports/u-journey-setup-benny-settings-enable-report.md

STANDING
Obey orch preferences.md.
