GOAL
Re-verify SETUP-WRITE-CARD structured parity against the linked attempt IDs already on disk, and publish whether anything still blocks a coordinator close besides the missing commit hash.

SCOPE
May write:
- parity/briefs/reports/u-write-card-verify-report.md
- parity/evidence/setup-success/write-card-verify-rerun.json (fresh comparator output only)
Must not write product code, mismatches.json, requirements.json, progress.md.
May re-run parity/scripts/compare-write-card.mjs against existing screens.

CONTEXT
- Linked pair: parity/evidence/setup-success/pair-setup-success-write-card-2.json
- Cursor de231068, Pi 0d269402
- Prior report write-card-parity-linked.json already pass:true
- Trail review demoted close to provisional until commit hash + linked pair
- Product diffs still uncommitted under extensions/pi-pstack/src/tool-cards.ts and setup-tool.ts
- Standing orders: ~/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md

ACCEPTANCE
- Fresh write-card-v1 run recorded with pass/fail and both screen paths.
- Report lists blockers for full close (commit hash, recordPair vs sequential, etc.) with measured facts only.
- Does not set acceptanceVerdict pass-paired on the mismatch row.

VERIFY
node parity/scripts/compare-write-card.mjs (or the documented invocation) against the linked screens; keep the JSON output.

TIMEBOX
20 minutes.

FORBIDDEN
No commit. No product edits. No ledger edits. No gt/rebase/force-push.

REPORT
parity/briefs/reports/u-write-card-verify-report.md

STANDING
Read preferences.md at the store path and obey every line.
