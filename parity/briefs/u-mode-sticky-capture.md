GOAL
Capture a linked Cursor+Pi pair for `PSTACK-MODE-STICKY-001` using Pi sticky spelling `/poteto-mode sticky <task>` and the best available Cursor Option+Enter / Alt+Enter (or documented equivalent). Publish attempt IDs and whether sticky holds across a follow-up turn.

SCOPE
May write under `parity/evidence/mode-sticky/` and `parity/briefs/reports/u-mode-sticky-capture-report.md`.
May extend `parity/scripts/capture-mode-one-message.mjs` into a sibling `capture-mode-sticky.mjs` if needed.
Must not edit ledgers or product code unless Cursor Option+Enter is impossible and a measured host mapping must be recorded in the report only.

CONTEXT
Plain Enter one-message is repaired (`/poteto-mode sticky` enables mode). Prior Option+Enter probe failed to select Custom Mode from slash menu. Prove sticky on Pi with the new spelling. For Cursor, try Option+Enter (`\x1b\r` / documented sequences) and record failure honestly if the CLI still cannot enter Custom Mode from the harness.
Fixture digest `sha256:2b6b4668…`. Standing orders at orch preferences path.

ACCEPTANCE
- Pair JSON with both attempt IDs and identical fixture digests.
- Pi sticky badge true after sticky invocation and after follow-up.
- Cursor side documented with measured chrome (Custom Mode or explicit harness limitation).
- Report does not edit mismatches.json.

VERIFY
Real PTY both sides. Re-read screens for badge / Custom Mode.

TIMEBOX
90 minutes.

FORBIDDEN
No commit. No ledger edits. No fabricating Cursor Custom Mode.

REPORT
parity/briefs/reports/u-mode-sticky-capture-report.md

STANDING
Obey orch preferences.md.
