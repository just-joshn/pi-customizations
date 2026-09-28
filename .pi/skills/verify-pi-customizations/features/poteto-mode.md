# Poteto mode

Poteto mode toggles persistent agent behavior across session turns, surfacing desktop notifications and appending structured state records to the active session branch.

## Sub-features

- `poteto-toggle` activates or deactivates Poteto mode for the current session branch.
- `poteto-notify` triggers an extension UI notification confirming mode change.
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
- **Verify branch entry.** Check the appended entries stream. An `entry_appended` record arrives with `type: "custom"`, `customType: "pstack-state"`, and `data: { enabled: false, todos: [] }`.
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/poteto-mode/off.txt` and `off.json`. The JSON file captures both the UI notification and the custom state entry.

## Gotchas

- Turning off mode uses `ctx.ui.notify`, which appears as an `extension_ui_request` over RPC rather than a chat message.
- Mode changes persist on the active session branch and survive session restarts until explicitly turned off.
- The `off` argument is case-insensitive (`OFF`, `off`, `Off`).
