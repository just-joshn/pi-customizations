GOAL
Capture a linked Cursor+Pi pair proving `/show-me-your-work` keeps a reviewable TSV decision trail (PSTACK-CMD-SHOW-ME-YOUR-WORK-TSV-001).

SCOPE
May write under `parity/evidence/show-me-your-work/`, capture scripts, `parity/briefs/reports/u-journey-cmd-show-me-your-work-report.md`, and a tiny fixture.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/cmd-show-me-your-work-tsv.json`. Prefer smallest multi-step task that forces TSV appends. Standing orders: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations: TSV decision trail written/updated on both hosts (or honest fail/mismatch).
- Honest host deltas recorded.

VERIFY
Real PTY both sides. Re-read on-disk TSV rows.

TIMEBOX
120 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-cmd-show-me-your-work-report.md

STANDING
Obey orch preferences.md.
