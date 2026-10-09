# Operator action — make-bot stuck on Untitled (G10)

Wait unlocked and ran the probe twice. Both attempts: `host_blocked` / `untitled_new_automation_without_generate`.

- Attempt `3941ef77…` (auto wait)
- Attempt `7b5e854b…` (manual retry after keyboard Discard)

## What you need to do in Cursor Agents

1. Keep the Mac unlocked.
2. Open **Window → Cursor Agents**.
3. If **Unsaved Changes** appears, click **Discard** (never Save). Keyboard that works for the harness: Tab, Tab, Space after focusing the modal.
4. Leave the Untitled New Automation editor. Get to the Automations **list** (not New Automation).
5. Open existing draft **`parity-webhook-witness`** (or recreate a webhook automation that shows **Generate auth header**).
6. Leave that editor open with Generate visible. Do not Activate.
7. Tell the agent to re-run the probe, or leave the machine alone if a wait is re-armed.

SE/OCR clicks report success on Discard but do not clear the web modal. Keyboard Tab×2+Space does. The draft name is not visible in the current Automations UI, so the harness cannot open Generate without your navigation.
