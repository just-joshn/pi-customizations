GOAL
Capture a linked Cursor+Pi pair for PSTACK-PRIN-PROVE-IT-001. Prefer closing adjacent principle ids only when the same pair honestly proves them.

SCOPE
May write under `parity/evidence/principles/`, capture scripts, and `parity/briefs/reports/u-journey-prin-prove-it-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/prin-prove-it.json`.
Leaf skill: principle-prove-it-works (disable-model-invocation true). Fresh poteto-mode session; task about to be declared done must verify against a real artifact (run/read/diff), preferably via a deterministic rerunnable script whose output is kept.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Evidence shows Read of leaf skill + verification against real artifact (not self-report alone).
- Report only.

VERIFY
Real PTY both sides. Keep script output / file reads in evidence.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-prin-prove-it-report.md

STANDING
Obey orch preferences.md.
