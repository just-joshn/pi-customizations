GOAL
Repair MODE-PLAIN-ENTER-STICKY so plain `/poteto-mode <task>` matches Cursor plain Enter: skill attaches for one message and does not enable sticky session mode. Provide a Pi-native sticky activation that maps Option+Enter / Use as Mode, then prove with unit tests and a recaptured mode-one-message pair.

SCOPE
May edit:
- extensions/pi-pstack/src/commands.ts
- extensions/pi-pstack/src/state.ts (only if needed for sticky entry API)
- extensions/pi-pstack/skills/poteto-help/** (align with Cursor Enter vs sticky; Pi sticky spelling)
- extensions/pi-pstack/docs/guide/02-poteto-mode.md (if it states the inverted rule)
- extensions/pi-pstack/test/commands.test.ts
- extensions/pi-pstack/test/integration.test.ts
- extensions/pi-pstack/test/parity-runtime-mode.test.ts
- extensions/pi-pstack/test/user-perspective.test.ts
- other tests that assert sticky on plain `/poteto-mode`
- parity/scripts/capture-mode-one-message.mjs (if needed for recapture)
May write:
- parity/evidence/mode-one-message/ (fresh pair after repair)
- parity/briefs/reports/u-mode-plain-enter-fix-report.md
Must not edit mismatches.json, requirements.json, progress.md (coordinator merges).

CONTEXT
- Mismatch MODE-PLAIN-ENTER-STICKY. Pair mode-one-message-1: Cursor non-sticky; Pi sticky crown.
- Upstream Cursor poteto-help: Enter = one message; Option+Enter = Custom Mode.
- Current Pi commands.ts calls `store.toggle(true)` on every `/poteto-mode` and `/skill:poteto-mode` (except off). That is the defect vs the Cursor oracle.
- Suggested sticky spelling (default if no better Pi host API): `/poteto-mode sticky <task>` and `/poteto-mode sticky` alone; keep `/poteto-mode off`. One-message remains `/poteto-mode <task>` and `/skill:poteto-mode <task>` without toggle.
- Many integration tests currently expect sticky on plain `/poteto-mode`; update them to the sticky spelling.
- Standing orders at orch preferences path.

ACCEPTANCE
- Plain `/poteto-mode <task>` does not call toggle(true); skill still delivers.
- Sticky spelling enables mode and persists across a follow-up (unit or integration proof).
- poteto-help documents Enter vs sticky mapping honestly for Pi.
- Focused tests green: commands, parity-runtime-mode, and the integration tests you touch.
- Fresh Pi capture (at least `--pi-only`) shows no crown sticky after plain `/poteto-mode` + follow-up, or a full `--both` pair if cheap.
- Report lists every test file updated and the sticky spelling chosen.

VERIFY
```
cd extensions/pi-pstack && bunx vitest run test/commands.test.ts test/parity-runtime-mode.test.ts
cd extensions/pi-pstack && bun run typecheck
# recapture
node parity/scripts/capture-mode-one-message.mjs --pi-only
```

TIMEBOX
120 minutes.

FORBIDDEN
No commit. No ledger edits. No gt/rebase/force-push. Do not weaken the Cursor one-message requirement.

REPORT
parity/briefs/reports/u-mode-plain-enter-fix-report.md

STANDING
Obey orch preferences.md verbatim.
