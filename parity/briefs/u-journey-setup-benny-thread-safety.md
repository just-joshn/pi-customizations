GOAL
Capture a linked Cursor+Pi pair for PSTACK-SETUP-BENNY-THREAD-SAFETY-001, or publish an honest env blocker with evidence of what was attempted.

SCOPE
May write under `parity/evidence/setup-benny/`, capture scripts, and `parity/briefs/reports/u-journey-setup-benny-thread-safety-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-benny-thread-safety.json`.
Expected: after editor save, before enabling normal Benny traffic, all seven checks pass on a test channel or harmless report (triage stores root thread_ts and posts exactly one verdict reply with one configured marker; repro accepts marker only from configured triage identity and keeps immutable source coordinates; no source-channel root message; delegated workers cannot use Slack write actions; missing coordinates / deleted parent / failed preflight produces no post and no tracker issue). Normal traffic enables only after all seven pass.
If Slack test channel / Automations editor is unavailable, document the blocker with attempted steps. Do not fabricate check passes.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs, or blocker JSON with attempted steps.
- Seven-check pass evidenced or honest blocker.
- Report only.

VERIFY
Real PTY / real Slack test channel when available.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. No real secrets. Do not spawn further subagents. Do not enable normal Benny traffic without seven-check pass.

REPORT
parity/briefs/reports/u-journey-setup-benny-thread-safety-report.md

STANDING
Obey orch preferences.md.
