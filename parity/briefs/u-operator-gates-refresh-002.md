GOAL
Refresh the operator remaining-gates checklist against current ledgers (94/98, 13 completion blockers, 3 open mismatches, live-int-002 counts, console lock, freeze-prep Option A). Produce an updated report + grant checklist. Ledgers untouched except via coordinator later.

SCOPE
May write `parity/research/operator-gates-refresh-002/`, `parity/briefs/reports/u-operator-gates-refresh-002-report.md`, `parity/orch-inbox/` update note.
Must not edit ledgers.

CONTEXT
Prior: `u-operator-remaining-gates-001`. Console `IOConsoleLocked=Yes`. Make-bot Generate unpaid. Creation-boundary Cursor paid / Pi unpaid / freeze-prep A. Custody pack ready. No Slack/Benny/API key.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Accurate G1–G11 (or renumbered) table with current attempt IDs and which grants unblock which blockers.
- Explicit unlock → Discard Untitled → Generate path for G10.
- Ledgers untouched.

VERIFY
Cross-check against mismatches.json open ids and completion.json blocker codes.

TIMEBOX
40 minutes.

FORBIDDEN
No ledger edits. No further subagents. No freeze.

REPORT
parity/briefs/reports/u-operator-gates-refresh-002-report.md

STANDING
Obey orch preferences.md.
