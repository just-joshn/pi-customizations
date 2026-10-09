GOAL
Add a small, rerunnable Method A scorer that reads a recorder attempt directory (events.jsonl and optional session transcript) and prints pass/fail for "parent started explainer Task / Running subagent before final answer."

SCOPE
May write:
- parity/scripts/score-how-method-a.mjs
- parity/test/score-how-method-a.test.mjs (if the parity package already has a test runner for scripts)
- parity/briefs/reports/u-how-method-a-scorer-report.md
Must not edit product code, mismatches.json, requirements.json, progress.md, or investigate evidence.

CONTEXT
Disposition: parity/reviews/how-explainer-disposition.md Method A.
Prior pi-only partial: parity/evidence/investigate/pi-recapture-3ebef40f.json.
Live cursor attempt under capture may still be writing: c1abf807-141d-4731-a887-182cf312ad02.
Event payloads are base64 in `kind: output` / `dataB64` (see recorder). Strip ANSI before matching.
Standing orders at orch preferences path.

ACCEPTANCE
- CLI: `node parity/scripts/score-how-method-a.mjs <attemptDir>` exits 0 on Method A pass, 1 on fail, 2 on bad input.
- JSON report to stdout with signals found (Running subagent, Task tool, READONLY explainer, gate block reason).
- At least one self-check against a known historical attempt dir (cursor 6f45e2db should pass; pi 8ad2dbc5 should fail).
- Report documents the commands run.

VERIFY
Run the scorer on those two historical attempts and keep exit codes.

TIMEBOX
30 minutes.

FORBIDDEN
No ledger edits. No gt/rebase/force-push. Do not wait for the in-flight capture to finish.

REPORT
parity/briefs/reports/u-how-method-a-scorer-report.md

STANDING
Obey orch preferences.md verbatim.
