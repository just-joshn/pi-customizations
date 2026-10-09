GOAL
Capture linked Cursor+Pi pairs for the three remaining budget labels on PSTACK-SETUP-BUDGET-APPLY-001: medium→high, small→medium, unlimited→max (real slugs + panel lists; inherit-parent/auto unchanged). Large→xhigh already pass-paired.

SCOPE
May write under `parity/evidence/setup-budget-apply/`, extend `parity/scripts/capture-setup-budget-apply.mjs` (CLI flag for budget/effort), fixtures, and `parity/briefs/reports/u-journey-setup-budget-apply-remaining-report.md`.
Must not edit ledgers.

CONTEXT
- Requirement expectedObservation lists all four budgets; coordinator declined overclaim on large alone.
- Prior pair: `parity/evidence/setup-budget-apply/pair-setup-budget-apply-large-1.json` (cursor `66de566f-5754-4e84-b3c2-2683254d419d`, pi `bf23823c-fcb1-4d97-9367-6d15b7a66591`).
- Prior report: `parity/briefs/reports/u-journey-setup-budget-apply-report.md`.
- Reuse fixtures/script patterns; start fixture at a budget/effort that makes the target remap observable (e.g. medium fixture when targeting unlimited/large, or high when targeting small).
- Shared `~/.cursor/rules/pstack-models.mdc` race: run Cursor sides sequentially; restore locked digest `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` after each side; avoid overlapping other setup captures.
- Pi: host-native `provider/id:effort`; agent must pass remapped `roleOverrides` (write tool does not remap). Prefer models in `availableModels` (claude-subscription Claude worked).
- Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Three pair JSON files (or one multi-label results file linking three pairs) with both attempt IDs each.
- Scorer: every real slug → target effort; panel mapped; aliases preserved; budgetAfter matches label.
- Honest host deltas; failed attempts listed.
- Report does not edit ledgers.

VERIFY
Real PTY both sides per label. Re-read rule-after files and pair JSON.

TIMEBOX
150 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. Do not claim the requirement verified (coordinator merges).

REPORT
parity/briefs/reports/u-journey-setup-budget-apply-remaining-report.md

STANDING
Obey orch preferences.md. poteto-mode Investigation / figure-it-out as needed.
