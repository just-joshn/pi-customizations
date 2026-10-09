# Mac console unlock required — desktop Automations blocked

Measured 2026-10-09T08:37:00Z.

```
IOConsoleLocked = Yes
CGSSessionScreenIsLocked = Yes
```

Helper `get_app_state` works but `isActive=false`. System Events clicks hit `loginwindow`, not Cursor. Stuck Automations Untitled + Unsaved Changes modal cannot be Discarded under lock.

## Operator steps (blocking make-bot G10)

1. Unlock the Mac **lock screen** (password / Touch ID) until `IOConsoleLocked` is No.
2. Restart this Cursor agent terminal after unlock (TCC + frontmost).
3. Discard stuck **Untitled** New Automation (do **not** Save).
4. Open a webhook draft (`parity-webhook-witness` or recreate via `/automate`).
5. Tell coordinator to recapture Generate auth header + 0600 store + probe 200.

## Still unpaid elsewhere

- G4–G8 Benny + Slack (triage + thread-safety)
- G1 `CURSOR_API_KEY` (CU cloud)
- G2 Enterprise team
- G3 acceptance freeze owner + external custody
- Creation-boundary: Cursor half paid; Pi Automations editor absent (`f4c7eec5`) — keep-unverified

Do not set `acceptanceDefinitionsFrozen` without G3.
