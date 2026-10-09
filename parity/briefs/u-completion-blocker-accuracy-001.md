GOAL
While desktop is console-locked, audit each of the 13 `completion.json` blockers against current ledgers/evidence. Confirm none are stale false-opens; for each, state the exact unlockable/grantable next evidence. Ledgers untouched.

SCOPE
May write `parity/research/completion-blocker-accuracy-001/`, `parity/briefs/reports/u-completion-blocker-accuracy-001-report.md`.
Must not edit ledgers. Must not freeze. Must not fabricate live evidence.

CONTEXT
94/98. Open mismatches: BENNY-TRIAGE, MAKE-BOT, THREAD-SAFETY. Creation-boundary ENV closed-env-resolved; req unpaid (Option A). Live-int-002 b=115. Console locked. Wait-unlock lever alive.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Table of 13 blockers → still-valid yes/no → next evidence / grant ID.
- Flag any stale blocker that check-completion should ignore (with proof).
- Ledgers untouched.

VERIFY
Re-run `node parity/scripts/check-completion.mjs` and match codes.

TIMEBOX
35 minutes.

FORBIDDEN
No ledger edits. No freeze. No further subagents.

REPORT
parity/briefs/reports/u-completion-blocker-accuracy-001-report.md

STANDING
Obey orch preferences.md.
