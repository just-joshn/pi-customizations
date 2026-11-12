# Poteto mode (persistent pstack style)

`/pstack on` turns on the persistent pstack style: each new user task gets the `poteto-mode` skill once, until `/pstack off`. Each change appends a `pstack/style` branch entry, and the footer shows `pstack on` while the style is on.

## Sub-features

- `style-on` turns the style on with `/pstack on` and notifies `pstack style on. Each new task gets the poteto-mode skill once; /pstack off ends it.`
- `style-entry` appends a `pstack/style` custom entry with `data: { on: true }` when the style turns on.
- `style-off` turns the style off with `/pstack off`, notifies `pstack style off.`, and appends a `pstack/style` entry with `data: { on: false }`.
- `style-status` shows `pstack on` in the footer status under the key `pstack-style` and clears it on `/pstack off`.

## How to get to it (user POV)

- Type `/pstack on` in Pi interactive chat to turn the style on.
- Type `/pstack off` in Pi interactive chat to turn it off.
- Type `/pstack status` to see whether the style is on.
- Type `/poteto-mode <task>` to use the skill for one task without the persistent style.
- Send prompt `{"id": "...", "type": "prompt", "message": "/pstack on"}` over Pi RPC.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- `extensions/pi-pstack` is present and unchanged.

- **Turn the style on, then off.** Send `/pstack on` and then `/pstack off` to the RPC session. Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive poteto-mode`. The driver asserts both notifications, exactly two `pstack/style` entries (`{ on: true }`, then `{ on: false }`), and the `pstack-style` status set to `pstack on`, then cleared.
- **Proof.** Verify that the artifact exists at `artifacts/verify-pi-customizations/poteto-mode/style.json`. The JSON file captures every notification, appended entry, and `setStatus` update from the drive.

## Gotchas

- Style changes report through `ctx.ui.notify`, which appears as an `extension_ui_request` over RPC rather than a chat message.
- The drive sends no task, so no model runs and the drive does not see the `pstack-style` skill message that a task turn adds. `tests/integration/extension.test.ts` in the package covers that message, compaction, resume, and fork.
- `/pstack on` refuses when the `poteto-mode` skill is not loaded. The driver loads the package, which ships it.
- The extension clears the status by passing `undefined`, so Pi's RPC `setStatus` message omits `statusText`. `control-pi` records that as `null`.
