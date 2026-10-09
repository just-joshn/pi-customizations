GOAL
Repair Pi `/poteto-mode` so a TodoWrite with verbatim matched-playbook steps lands before any product mutation, close POTETO-PLAYBOOK-TODO, and recapture a linked pass-paired run.

SCOPE
May edit `extensions/pi-pstack/src/**` (prefer a gate analogous to `figure-it-out-playbook-gate.ts`; `firstActionRule` alone failed), tests, `parity/evidence/poteto-playbook/`, capture scripts, `parity/briefs/reports/u-poteto-todo-gate-report.md`.
Must not edit ledgers.

CONTEXT
Mismatch POTETO-PLAYBOOK-TODO from `parity/evidence/poteto-playbook/pair-poteto-playbook-todo-1.json`: Cursor Bug fix todos before `src/inc.js`; Pi read `bug-fix.md` then bash/edit with no TodoWrite. Capture: `parity/scripts/capture-poteto-playbook-todo.mjs`. Standing orders at orch preferences path.

ACCEPTANCE
- Product gate/tests green via package test script.
- Linked recapture: both hosts `playbookTodosBeforeProduct` (or Pi fresh + Cursor reuse if fixture identical).
- Report for coordinator; no ledger edits.

VERIFY
Real PTY Pi (and Cursor if needed). Re-read session for TodoWrite before product tools.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No commit. No fabricating TodoWrite chrome.

REPORT
parity/briefs/reports/u-poteto-todo-gate-report.md

STANDING
Obey orch preferences.md.
