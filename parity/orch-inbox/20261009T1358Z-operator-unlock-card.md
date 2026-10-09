# Operator unlock card — 2026-10-09T13:58Z

**95/98 verified. Completion BLOCKED (12). Do not Restart this agent until the unlock cascade finishes.**

## Why the prior wait never fired

Cursor glass reports `AXWindow` count 0 to System Events even when the IDE UI is visible. The wait script now also accepts `cursor-agent-helper desktop-share-status` (`ready=true`, `screenLocked=false`). Evidence: `parity/research/wait-unlock-make-bot-001/helper-cursor-2.png`.

## Do this now

1. Unlock the Mac (Login / Touch ID). Leave the session unlocked.
2. Confirm Cursor shows `pi-pstack-parity-again` (already opened).
3. If a git "too many active changes" dialog is up, click **OK** or **Don't Show Again**.
4. If **Untitled / New Automation / Unsaved Changes** appears, click **Discard** (never Save).
5. Leave the machine alone for ~5–25 minutes while the armed wait runs:
   - probe Generate → 0600 key store → HTTP 200
   - fail-closed make-bot ledger merge
   - live-int-004 refresh + ledger narrow
6. Watch for `parity/orch-inbox/UNLOCKED-make-bot-cascade-NOW.md`.

Wait log: `parity/research/wait-unlock-make-bot-001/wait-rearm-20261009T1356.log`

## After make-bot closes (still unpaid)

1. In Cursor desktop IDE, authenticate Slack MCP (`plugin-slack-slack`, currently needsAuth).
2. Benny valid config + test-thread grant → triage pair.
3. Editor Save + seven thread-safety checks → RecordThreadSafety → Enable(local).
4. Later unpaid: CU API key (G1), Enterprise (G2), Freeze owner (G3).

## Already done this session

- Session pickup of `pi-pstack-parity-again` (not a greenfield rewrite).
- Pi user package retargeted from `pi-customizations` 0.15.9-pi.1 to parity-again `0.15.15-pi.1`.
- `/pstack-status` smoke passed under Pi 1.1.0.
- Unlock census harness fixed; wait re-armed for 2h.
