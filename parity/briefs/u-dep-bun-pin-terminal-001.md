GOAL
Produce an honest terminal disposition for the Bun runtime pin unresolvedReference: either (a) prove an official pin exists and record it, or (b) prove the official tools/poteto source declares no Bun binary pin and publish a merge payload that closes the reference as `absent-in-source` without inventing a version pin from host bun/mise/bun-types.

SCOPE
May write under `parity/research/dep-bun-pin-terminal-001/`, `parity/briefs/reports/u-dep-bun-pin-terminal-001-report.md`.
Must not edit ledgers. Must not invent engines/packageManager/.bun-version.

CONTEXT
Wave-009 capture: `parity/research/dep-closure-wave-009/bun/official-capture.json` (pinStatus unresolved). Completion gate blocks on DEPENDENCY_REFERENCE_UNRESOLVED for this line. Standing: orch preferences.md.

ACCEPTANCE
- Clear verdict: pin-found (path+hash) OR absent-in-source (exhaustive candidate list + hashes).
- Merge payload JSON for coordinator if closing as absent-in-source is honest.
- Explicit statement that host bun 1.4.2 / mise latest / bun-types are not pins.

VERIFY
Re-run pin candidate probes; shasum docs if fetched.

TIMEBOX
45 minutes.

FORBIDDEN
No ledger edits. No invented pin files. No commit. Do not spawn further subagents.

REPORT
parity/briefs/reports/u-dep-bun-pin-terminal-001-report.md

STANDING
Obey orch preferences.md.
