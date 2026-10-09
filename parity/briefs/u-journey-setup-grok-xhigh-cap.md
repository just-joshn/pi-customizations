GOAL
Capture a linked Cursor+Pi pair for PSTACK-SETUP-GROK-XHIGH-CAP-001: under budget unlimited, Grok roles stay at xhigh (including grok-*-xhigh-fast) rather than max.

SCOPE
May write under `parity/evidence/setup-grok-xhigh-cap/`, capture scripts, fixtures, and `parity/briefs/reports/u-journey-setup-grok-xhigh-cap-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-grok-xhigh-cap.json`. Reuse `parity/scripts/capture-setup-budget-apply.mjs` patterns / `--budget=unlimited`. Prior unlimited pair used Claude-only because Grok cannot map to max — this journey needs at least one Grok real slug present and capped at xhigh under unlimited.
Serialize on `~/.cursor/rules/pstack-models.mdc`; restore locked digest `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004`.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations: Grok roles at xhigh under unlimited; non-Grok real slugs may go to max per host; aliases unchanged (or honest fail/mismatch).
- Report only; no ledger edits.

VERIFY
Real PTY both sides. Re-read rule-after for Grok effort tokens.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-setup-grok-xhigh-cap-report.md

STANDING
Obey orch preferences.md.
