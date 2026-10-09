# Operator unlock card (G10) — do this when you can unlock the Mac

**Do not Restart the agent terminal** until the auto cascade finishes (or fails with a report).

## Steps

1. Unlock the Mac so the Login screen is gone.
2. Confirm Cursor is frontmost (wait script also runs `open -a Cursor`).
3. If you see **Untitled / New Automation / Unsaved Changes**: click **Discard** (never Save).
4. Leave the machine alone for ~5–25 minutes while:
   - probe Generate → 0600 key store → HTTP 200
   - fail-closed make-bot ledger merge
   - live-int-004 refresh + ledger narrow
5. Watch for `parity/orch-inbox/UNLOCKED-make-bot-cascade-NOW.md` and `UNLOCKED-cascade-*.md`.

## After make-bot closes (still unpaid)

1. In Cursor **desktop IDE**, authenticate Slack MCP (`plugin-slack-slack`).
2. Supply Benny valid config + test-thread grant → triage pair.
3. Editor Save + seven thread-safety checks → RecordThreadSafety → Enable(local).
4. Later: CU API key (G1), Enterprise (G2), Freeze owner (G3).

## Current score

95/98 verified. Completion BLOCKED (12). Console locked until you unlock.
