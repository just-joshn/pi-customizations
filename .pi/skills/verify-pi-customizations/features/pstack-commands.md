# Pstack command surface

The pstack extension registers two extension commands, `/mode` and `/loop`, and ships its skills for Pi to load. `/mode` with no mode on reports `No mode is on.` through a UI notification.

## Sub-features

- `commands-mode` registers the `/mode` extension command.
- `commands-loop` registers the `/loop` extension command.
- `commands-skills` exposes the pstack skill commands (`skill:poteto-mode`, `skill:setup-pstack`, `skill:poteto-help`, and the rest of the package's skills).
- `commands-mode-report` answers a bare `/mode` with `No mode is on.` when no mode is on.

## How to get to it (user POV)

- Type `/mode` in Pi interactive chat to see the current mode.
- Type `/` in Pi interactive chat and look for `mode` and `loop` next to the skill entries.
- Send prompt `{"id": "...", "type": "get_commands"}` over Pi RPC and inspect `commands`.
- Send prompt `{"id": "...", "type": "prompt", "message": "/mode"}` over Pi RPC.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- `extensions/pi-pstack` is present and unchanged.

- **List the command surface.** Send `get_commands` to the RPC session. Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive pstack-commands`. The driver asserts `/mode`, `/loop`, `skill:poteto-mode`, `skill:setup-pstack`, and `skill:poteto-help` are registered and saves the full command list.
- **Request the mode report.** Send `/mode` to the RPC session. The fresh session has no mode on, so a `notify` UI request arrives with `No mode is on.`
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/pstack-commands/commands.json` and `mode-status.txt`.

## Gotchas

- `/mode` reports through `ctx.ui.notify`, which appears as an `extension_ui_request` over RPC, not as a chat message.
- The command list also carries skills from the repository root package and your agent directory; the driver asserts the pstack entries, not the whole list.
- `/loop` and `/mode` need an interactive or RPC session; print and JSON runs have no `Loop` tool and no mode persistence surface.
- This drive does not exercise `Task`, `TodoWrite`, or `AskQuestion`; those are model-called tools, not commands.
