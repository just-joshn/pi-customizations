# Poteto mode

Poteto mode toggles persistent agent behavior across session turns. The extension adds its instructions to agent prompts when mode is enabled. Each mode change appends a state record to the active session branch. The `/poteto-mode off` command sends a Pi UI notification; `/poteto-mode` activation does not.

## Sub-features

- `poteto-toggle` activates or deactivates Poteto mode for the current session branch.
- `poteto-notify` sends a Pi UI notification for `/poteto-mode off`. `/poteto-mode` activation does not send this notification.
- `poteto-persist` appends a `pstack-state` custom entry storing the updated mode flag.

## How to get to it (user POV)

- Type `/poteto-mode` in Pi interactive chat to activate.
- Type `/poteto-mode off` in Pi interactive chat to deactivate.
- Type `/skill:poteto-mode` to activate mode through the native skill command, or `/skill:poteto-mode off` to turn it off.
- Call the direct `pstack_mode` tool with `{ "enabled": true }` or `{ "enabled": false }` to set mode and append branch state. The tool does not send a UI notification.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- `extensions/pi-pstack` is present and unchanged.

- **Turn off mode.** Send `/poteto-mode off` to the RPC session. Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive poteto-mode`. An `extension_ui_request` notification arrives with `message: "Poteto mode is off."` and `notifyType: "info"`. The driver asserts the message and records `notifyType` without asserting it.
- **Verify branch entry.** Check the appended entries stream. An `entry_appended` record arrives with `type: "custom"`, `customType: "pstack-state"`, and `data.enabled: false`. In this fresh session, `data.todos` is empty; toggling an existing branch preserves its todos. The driver records `todos` without asserting it.
- **Proof.** Receipts `PS-UI-5.json` and `PS-CMD-1.json` exist under `artifacts/user-perspective/poteto-mode/`, each asserted against `raw/rpc-1.jsonl`. The receipts capture both the UI notification and the custom state entry.

## Gotchas

- Turning off mode uses `ctx.ui.notify`, which appears as an `extension_ui_request` over RPC rather than a chat message.
- The extension restores mode from the active branch when a session opens or the branch changes. To verify restoration, reopen the same session or switch branches and check `/pstack status`.
- This `--no-session` drive tests only `/poteto-mode off`. It does not verify `/poteto-mode` activation, `/skill:poteto-mode off`, direct `pstack_mode` calls, or restoration after restart or branch navigation.
- Native `/skill:poteto-mode` interception requires Pi discovery to resolve to this package's skill path.
- The harness creates its own disposable scratch directory; no manual initialization is needed.
- The `off` argument is case-insensitive (`OFF`, `off`, `Off`).
