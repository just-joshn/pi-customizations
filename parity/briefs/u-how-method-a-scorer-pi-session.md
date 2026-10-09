GOAL
Extend how-method-a-v1 so a Pi attempt that starts Task (visible in session transcript / subagents/) scores pass even when PTY chrome lacks "Running subagent".

SCOPE
May edit parity/scripts/score-how-method-a.mjs and parity/test/score-how-method-a.test.mjs. May write a report under parity/briefs/reports/.
Must not edit ledgers or product gate code.

CONTEXT
Live pi 951a315d: PTY scorer fail; session content tool name `task` present; subagent transcript exists under /tmp/pi-ref-agent/sessions/.../01a11c8b.../subagents/.
Cursor PTY path must keep passing.

ACCEPTANCE
Scorer exits 0 on pi 951a315d when given session path or auto-discovered PI_CODING_AGENT_DIR session. Historical cursor 6f45e2db still 0; pi 8ad2dbc5 still 1.

VERIFY
Re-run CLI on those three dirs.

TIMEBOX
45 minutes.

FORBIDDEN
No ledger edits. No gt/rebase/force-push.

REPORT
parity/briefs/reports/u-how-method-a-scorer-pi-session-report.md

STANDING
Obey orch preferences.md.
