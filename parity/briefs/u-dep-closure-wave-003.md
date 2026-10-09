GOAL
Resolve as many remaining unresolved dependency edges/references as evidence allows in one wave (bootstrap → tools-manifest → commander → bun runtime; document computer-use/enterprise if still environment-bound).

SCOPE
May write under `parity/research/dep-closure-wave-003/`, `parity/briefs/reports/u-dep-closure-wave-003-report.md`.
Must not edit ledgers (`dependencies.json` merge is coordinator-only). Publish a merge payload in the report.

CONTEXT
`closureAudited: true` but `completeDependencyClosure: false`. Unresolved edges include cursor-cli-host→computer-use/enterprise-policy and source-tools-bootstrap chain through npm:commander@14.0.0→source-bun-runtime. Prior waves: `parity/research/dep-closure-wave-001/`, `...-002/`, audit `parity/research/dep-audit-001/audit.md`. Standing orders at orch preferences path.

ACCEPTANCE
- Report lists each edge/ref: resolved with path+hash evidence, or still-unresolved with concrete blocker (not vague).
- Merge payload JSON suitable for coordinator to apply (nodes/edges/refs only; no ledger write by worker).
- Hash verify notes for any new captures.

VERIFY
Re-read official sources / lockfiles / registry metadata; do not invent pins.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated closure. No broad allowlist/authorization changes. No commit.

REPORT
parity/briefs/reports/u-dep-closure-wave-003-report.md

STANDING
Obey orch preferences.md.
