GOAL
Build a fail-closed executable completion gate that writes `parity/completion.json` and exits non-zero unless source-lock, dependency graph, requirement coverage, scenario evidence, and zero open mismatches are satisfied. Deliberately prove it fails on the current incomplete denominator.

SCOPE
May write:
- parity/scripts/check-completion.mjs (or .ts run via bun)
- parity/test/check-completion.test.mjs
- parity/briefs/reports/u-completion-gate-v1-report.md
Must not edit product code or force a fake pass by shrinking the denominator.

CONTEXT
Done predicate in orch preferences. Current state: requirements incomplete, acceptanceDefinitionsFrozen false, no paired evidence for most rows, completion.json absent. Gate must FAIL now. Open mismatches must fail the gate (MODE-PLAIN-ENTER-STICKY is open).

ACCEPTANCE
- CLI exits 2 (or 1) on current tree with BLOCKED reasons.
- CLI would pass only if every requirement is verified-pass-paired, mismatches have zero open, completion fields filled.
- Tests cover missing requirements.json, open mismatch, unverified requirement, forged verified without evidence.
- Report shows the real failing run output path.

VERIFY
node parity/scripts/check-completion.mjs ; echo exit:$?
bunx vitest run parity/test/check-completion.test.mjs

TIMEBOX
90 minutes.

FORBIDDEN
No fake pass. No deleting open mismatches to get green.

REPORT
parity/briefs/reports/u-completion-gate-v1-report.md

STANDING
Obey orch preferences.md.
