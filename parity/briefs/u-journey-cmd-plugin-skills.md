GOAL
Capture a linked Cursor+Pi pair proving the locked pstack plugin registers skills from `./skills/` and agents from `./agents/` as declared by the manifest (PSTACK-CMD-PLUGIN-SKILLS-REGISTER-001).

SCOPE
May write under `parity/evidence/plugin-skills/`, capture scripts, `parity/briefs/reports/u-journey-cmd-plugin-skills-report.md`, and a tiny fixture if needed.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/cmd-plugin-skills-register.json`. Prefer loading/installing the locked plugin so the host reads the manifest, then observing registered skill/agent directories. Standing orders: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations: skills and agents directory registration from the manifest on both hosts (or honest fail/mismatch / Pi binding delta).
- Honest host deltas recorded.

VERIFY
Real host load evidence both sides (PTY or equivalent host registration surface). Do not invent registration.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-cmd-plugin-skills-report.md

STANDING
Obey orch preferences.md.
