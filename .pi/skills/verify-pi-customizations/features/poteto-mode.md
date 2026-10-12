# Poteto mode (Custom Mode)

Poteto mode is Cursor's Custom Mode: `/mode poteto-mode` keeps the skill in the system prompt on every turn until `/mode off`. Each change appends a branch entry, and the footer shows the active mode.

## Sub-features

- `mode-on` turns the mode on with `/mode poteto-mode` and notifies `Custom Mode on: poteto-mode. /mode off exits.`
- `mode-entry` appends a `pstack/mode` custom entry with `data.skill: "poteto-mode"` when the mode turns on.
- `mode-off` turns the mode off with `/mode off`, notifies `Custom Mode off.`, and appends a `pstack/mode` entry with `data: null`.
- `mode-status` reflects the mode in the footer status under the key `pstack-mode`.

## How to get to it (user POV)

- Type `/mode poteto-mode` in Pi interactive chat to turn the mode on.
- Type `/mode off` in Pi interactive chat to turn it off.
- Type `/mode` to see the current mode.
- Send prompt `{"id": "...", "type": "prompt", "message": "/mode poteto-mode"}` over Pi RPC.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- `extensions/pi-pstack` is present and unchanged.

- **Turn the mode on, then off.** Send `/mode poteto-mode` and then `/mode off` to the RPC session. Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive poteto-mode`. The driver asserts both notifications, the on entry's `data.skill`, and the off entry's `data: null`.
- **Proof.** Verify that the artifact exists at `artifacts/verify-pi-customizations/poteto-mode/mode.json`. The JSON file captures every notification and every appended entry from the drive.

## Gotchas

- Mode changes report through `ctx.ui.notify`, which appears as an `extension_ui_request` over RPC rather than a chat message.
- The extension restores the mode from the active branch when a session opens or the branch changes; this `--no-session` drive does not cover restoration across restarts.
- `/mode <skill>` only accepts loaded skills. The driver uses `poteto-mode` because the package ships it.
- Turning the mode on with a task argument (`/mode poteto-mode <task>`) sends the task as a user message; the drive uses no task, so no model runs.
- The entry type and status key are spelled `pstack/mode` and `pstack-mode`, matching the package name `pi-pstack`.
