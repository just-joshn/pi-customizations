GOAL
Close SETUP-LOAD-STATE-CURSOR: prove Cursor `/setup-pstack` loads existing fixture roles (bug-fix: auto) and lists retired `how critics`, or publish an honest isolated-fail diagnosis. Prefer isolated recapture reusing Pi `3f46cd66` if Cursor passes.

SCOPE
May write under `parity/evidence/setup-load-state/`, capture scripts, `parity/briefs/reports/u-setup-load-state-cursor-report.md`. May inspect locked setup-pstack skill. Must not edit ledgers. Do not change Pi product unless Cursor pass already holds and a Pi-only gap remains (it does not).

CONTEXT
Mismatch SETUP-LOAD-STATE-CURSOR from `parity/evidence/setup-load-state/pair-setup-load-state-retired-1.json`. Pi passed. Cursor showed all inherit-parent / no retired drop while fixture had `bug-fix: auto` + trailing `how critics`. Concurrent shared-rule races are suspected; rule-after matched locked digest not fixture. Standing orders at orch preferences path.

ACCEPTANCE
- Isolated Cursor capture (no other writers on `~/.cursor/rules/pstack-models.mdc` during the run) with planted fixture digest `sha256:e8dcb7b71c421dd7ceae42b69f478396223d15ffe12257cb963fe7bba4e8f0a2`.
- Either: Cursor `markerRoleLoaded` + `retiredListed` true and updated pair pass-paired; or honest fail with proof the planted fixture was visible to the agent and still mis-loaded.
- Report for coordinator; no ledger edits.

VERIFY
Re-read planted rule bytes at launch, screens, and rule-after. Do not score typed prompt text as model output.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated Cursor pass. No commit.

REPORT
parity/briefs/reports/u-setup-load-state-cursor-report.md

STANDING
Obey orch preferences.md.
