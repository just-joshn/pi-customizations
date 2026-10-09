GOAL
Capture a linked Cursor+Pi pair for PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001.

SCOPE
May write under `parity/evidence/make-bot-ui/`, capture scripts, and `parity/briefs/reports/u-journey-cmd-make-bot-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/cmd-make-bot-ui-key-server.json`.
Skill: `extensions/pi-pstack/skills/make-bot-ui/SKILL.md` (and Cursor official make-bot-ui).
Expected: sender key stays on the server — never in browser, chat, skill file, tool args, env, or logs.
If host lacks RoutinePrepare / webhook routines, publish honest blocker evidence; do not fake a pass.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs (or blocker JSON if env-bound).
- Observations prove key-server boundary (or honest fail/mismatch).
- Report only.

VERIFY
Real PTY both sides. Inspect generated UI/server/skill files for key leakage.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. No secrets in evidence.

REPORT
parity/briefs/reports/u-journey-cmd-make-bot-report.md

STANDING
Obey orch preferences.md.
