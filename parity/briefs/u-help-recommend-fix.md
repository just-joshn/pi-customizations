GOAL
Repair or prove Pi `/poteto-help` routing so a branch-review question recommends `/interrogate` as the primary skill (matching Cursor and poteto-help recipes), then recapture a linked Cursor+Pi help pair that clears `CMD-POTETO-HELP-RECOMMENDATION`.

SCOPE
May edit `extensions/pi-pstack/skills/poteto-help/**` and mirrored prompts if needed, tests under `extensions/pi-pstack/test/`, capture under `parity/evidence/commands/`, `parity/scripts/capture-commands-help-cancel.mjs` or a sibling help-only capture, `parity/briefs/reports/u-help-recommend-fix-report.md`.
Must not edit ledgers (`mismatches.json`, `requirements.json`, `progress.md`).

CONTEXT
Mismatch `CMD-POTETO-HELP-RECOMMENDATION`: Cursor recommended `/interrogate`, Pi `/review-and-ship` for `/poteto-help which skill should i use to review this branch?`. Official table maps "Have different models review a diff…" to `/interrogate`. recipes.md has an `/interrogate the whole branch…` example. Pi also ships team-kit `review-and-ship`, which can steal the recommendation. Prefer the smallest skill-text encoding that makes the oracle deterministic; do not delete review-and-ship. Standing orders at orch preferences path.

ACCEPTANCE
- Linked pair (or help-only pair) with both attempt IDs where primary recommendation is `/interrogate` on both sides (or documented host mapping accepted in the report for coordinator).
- Report states whether a product edit was required and the paths.
- Unit/package tests for any product edit pass via package test script.

VERIFY
Real PTY both sides for the help prompt. Re-read screens for the recommended skill string. `bun run test` (or narrow vitest) for touched tests.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No commit. No fabricating Cursor screens.

REPORT
parity/briefs/reports/u-help-recommend-fix-report.md

STANDING
Obey orch preferences.md.
