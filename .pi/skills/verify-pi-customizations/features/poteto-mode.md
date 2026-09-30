# Poteto mode

Poteto mode toggles persistent agent behavior across session turns, surfacing Pi UI notifications when switched off and appending structured state records to the active session branch.

## Sub-features

- `poteto-toggle` activates or deactivates Poteto mode for the current session branch.
- `poteto-notify` triggers an extension UI notification confirming the command-off path.
- `poteto-persist` appends a `pstack-state` custom entry storing the updated mode flag.

## How to get to it (user POV)

- Type `/poteto-mode` in Pi interactive chat to activate.
- Type `/poteto-mode off` in Pi interactive chat to deactivate.
- Type `/skill:poteto-mode off` to invoke the native skill command directly.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- `extensions/pi-pstack` is present and unchanged.
- Disposable `PI_CODING_AGENT_DIR` scratch directory initialized.

- **Turn off mode.** Send `/poteto-mode off` to the RPC session. Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive poteto-mode`. An `extension_ui_request` notification arrives with `message: "Poteto mode is off."` and `notifyType: "info"`.
- **Verify branch entry.** Check the appended entries stream. An `entry_appended` record arrives with `type: "custom"`, `customType: "pstack-state"`, and `data.enabled: false`. In this fresh session, `data.todos` is empty; toggling an existing branch preserves its todos.
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/poteto-mode/off.txt` and `off.json`. The JSON file captures both the UI notification and the custom state entry.

## Gotchas

- Turning off mode uses `ctx.ui.notify`, which appears as an `extension_ui_request` over RPC rather than a chat message.
- Mode changes persist on the active session branch. This `--no-session` drive proves the off notification and appended state, not restoration after restart or branch navigation.
- Native `/skill:poteto-mode` interception requires Pi discovery to resolve to this package's skill path.
- The harness creates its own disposable scratch directory; no manual initialization is needed.
- The `off` argument is case-insensitive (`OFF`, `off`, `Off`).
