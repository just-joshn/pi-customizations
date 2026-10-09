GOAL
Post-terminal-restart retry: reopen a live Cursor webhook Automations editor (prefer existing `parity-webhook-witness`, else recreate via `/automate` webhook handoff), exercise Generate auth header, store sender key only in owned 0600 path, probe HTTP 200 for Cursor `key_server_ok` — or honest blocker with attempt IDs.

SCOPE
May write `parity/research/make-bot-auth-header-retry-001/`, `parity/evidence/make-bot-ui/`, `parity/briefs/reports/u-make-bot-auth-header-retry-001-report.md`, lever patches under owned paths.
Must not edit ledgers.

CONTEXT
Prior Generate-visible witness `c345b7ed`. Auth reentry `beb9d748` hit Untitled prefill parse error; Save did not help. Operator guidance was discard Untitled and open `parity-webhook-witness`. Terminal was restarted for TCC. Pi half `e75f8e08` already `key_server_ok`.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Prefer canCloseMismatch path: Generate + 0600 store + probe 200 + leak-scan clean.
- Or honest blocker after restart (document whether Untitled/prefill still broken, whether list open works).
- Never put sender keys in chat/report/evidence bodies.
- Default: no Activate. Save only if product requires it for auth materialization.
- Ledgers untouched.

VERIFY
Leak scan on artifacts. Probe disposition status codes only.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No secrets in report/evidence. No further subagents. No inventing update_state.

REPORT
parity/briefs/reports/u-make-bot-auth-header-retry-001-report.md

STANDING
Obey orch preferences.md.
