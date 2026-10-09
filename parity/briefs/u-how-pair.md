GOAL
Capture one linked Cursor+Pi `/how` investigation pair under Method A (deterministic explainer spawn), with the how-spawn-gate installed on the candidate, and publish a falsifiable report that says pass or fail with attempt IDs.

SCOPE
May write:
- parity/evidence/investigate/pair-investigate-3.json (new)
- parity/evidence/investigate/cursor/<new-attempt>/
- parity/evidence/investigate/pi/<new-attempt>/
- parity/evidence/investigate/how-method-a-pair-3-report.md
- parity/briefs/reports/u-how-pair-report.md
May read anything under the repo, locked reference, /tmp/pi-ref-agent, capture scripts.
Must not write: parity/mismatches.json, parity/requirements.json, parity/progress.md, extensions/pi-pstack/src/** (gate already landed uncommitted; do not edit product code unless the capture proves the gate is not loaded).
Work in the existing checkout at /Users/josh-desktop/src/personal/pi-pstack-parity-again. No new branch required for evidence-only work.

CONTEXT
- Method A disposition: parity/reviews/how-explainer-disposition.md
- Gate design: extensions/pi-pstack/docs/how-explainer-spawn-design.md
- Gate code (uncommitted, registered in index.ts): extensions/pi-pstack/src/how-spawn-gate.ts
- Prior pi-only partial: parity/evidence/investigate/pi-recapture-3ebef40f.json (attempt 3ebef40f; gate blocked read then Task ran with Cursor-shaped args; explainerTaskStarted already widened)
- Capture driver: parity/scripts/capture-investigate.mjs
- Fixture digest must stay sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004
- Question: how does the pstack budget line in models.mdc change agent behavior?
- Standing orders path: ~/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md

ACCEPTANCE
- One pair JSON naming both attempt IDs, identical fixtureDigest, ruleUnchanged true on both sides.
- Method A check documented: parent starts explainer Task (or Running subagent chrome) before final answer on Pi; Cursor side also recorded.
- Report states measured pass/fail/partial with evidence paths. No claim that the mismatch row is closed.
- If Pi still skips spawn after the gate, report the tool sequence and whether the gate blocked/reminded; do not silently weaken Method A.

VERIFY
- Run the existing capture-investigate driver (or the same recorder pattern) for a fresh linked pair.
- Confirm installed candidate loads how-spawn-gate (grep identity / session for block reason or Task).
- bunx vitest run test/how-spawn-gate.test.ts from extensions/pi-pstack (expect pass; do not change tests unless broken by environment).
- Re-read both attempt identity.json and session transcripts for Task vs direct-tool sequence.

TIMEBOX
90 minutes. On expiry return partial findings with whatever attempts exist.

FORBIDDEN
No gt, rebase, force-push. No edits to mismatches/requirements/progress. No spending. No scope reduction of Method A. No fabricating spawn. No commit unless the operator already asked in this chat (they have not).

REPORT
Write parity/briefs/reports/u-how-pair-report.md with: status, attempt IDs, fixture digest, Method A verdict, commands actually run, deviations, suggested follow-ups for the coordinator.

STANDING
Read preferences.md at the store path above and obey every line.
