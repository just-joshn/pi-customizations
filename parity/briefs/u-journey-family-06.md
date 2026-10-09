GOAL
Capture a minimal linked Cursor+Pi pair for journey family 06 proving swarm/multiworker fan-out with concurrent workers and isolated writes (or the smallest registered multiworker command that exists on both hosts).

SCOPE
May write under `parity/evidence/swarm/` (or `parity/evidence/multiworker/`), `parity/scripts/` capture helper, `parity/briefs/reports/u-journey-family-06-report.md`.
Must not edit ledgers or product code unless a blocking Pi registration bug is measured (then product fix + report; still no ledger edits).

CONTEXT
Family stub: `parity/scenarios/journey-family-06-multiworker-designs-reviews.json`. Prefer `/swarm` with a tiny N=2 fixture task. Standing orders at orch preferences path.

ACCEPTANCE
- Pair JSON with both attempt IDs and identical fixture digests where applicable.
- Observations cover fan-out started, worker isolation (no shared-write collision), and a single rolled-up report/result.
- Honest host deltas recorded.

VERIFY
Real PTY both sides. Re-read screens/sessions.

TIMEBOX
120 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-family-06-report.md

STANDING
Obey orch preferences.md.
