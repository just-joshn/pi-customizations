GOAL
Finish the remaining incomplete dependency nodes and resolve remaining edges where evidence allows; publish a merge proposal. Leave `closureAudited` false unless a real independent audit artifact is produced.

SCOPE
May write under `parity/research/dep-closure-wave-002/` and `parity/briefs/reports/u-dep-closure-wave-002-report.md`.
Must not edit `parity/dependencies.json` or `parity/source-lock.json` (coordinator merges).

CONTEXT
After wave 001: ~15 nodes still reading-incomplete, ~22 edges unresolved. Prior proposal shape: `parity/research/dep-closure-wave-001/merge-proposal.json`. Prefer remaining `@typescript/*` platforms, host computer-use/enterprise edges (honest unresolved if closed-source), Bun official contracts, and npm:typescript full-tree or explicit disposition. Standing orders at orch preferences path.

ACCEPTANCE
- ≥8 additional node inventories with hashes.
- Merge proposal with exact mutations.
- Hash verify script green.
- closureAudited remains false.

VERIFY
`python3 …/verify_inventory_shasum.py` (create if needed) passes.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated readingComplete. No commit.

REPORT
parity/briefs/reports/u-dep-closure-wave-002-report.md

STANDING
Obey orch preferences.md.
