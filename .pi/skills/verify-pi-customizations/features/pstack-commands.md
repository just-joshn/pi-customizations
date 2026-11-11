# Pstack command surface

The pstack extension registers commands including `/mode`, `/loop`, `/plan`, `/routines`, `/automations`, `/project`, `/in-cloud`, and `/secret`, and ships its skills for Pi to load. `/in-cloud` and `/secret` register only in a root session; the other six register at every depth. This drive checks all eight in a root session. `/mode` with no mode on reports `No mode is on.` through a UI notification.

## Sub-features

- `commands-mode` registers the `/mode` extension command.
- `commands-loop` registers the `/loop` extension command.
- `commands-plan` registers the `/plan` extension command.
- `commands-routines` registers the `/routines` extension command.
- `commands-other` registers `/automations` and `/project`, and in a root session `/in-cloud` and `/secret`.
- `commands-skills` exposes pstack skill commands; the drive checks `skill:poteto-mode`, `skill:setup-pstack`, and `skill:poteto-help`.
- `commands-mode-report` answers a bare `/mode` with `No mode is on.` when no mode is on.

## How to get to it (user POV)

- Type `/mode` in Pi interactive chat to see the current mode.
- Type `/` in Pi interactive chat and look for `mode`, `loop`, `plan`, `routines`, `automations`, `project`, `in-cloud`, and `secret` next to the skill entries.
- Type a loaded skill's bare name, such as `/poteto-mode`, without the `skill:` prefix, at the start of a message or after a space. pstack attaches that skill to the message when no extension command or prompt template owns the name.
- Send prompt `{"id": "...", "type": "get_commands"}` over Pi RPC and inspect `commands`.
- Send prompt `{"id": "...", "type": "prompt", "message": "/mode"}` over Pi RPC.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- `extensions/pi-pstack` is present and unchanged.

- **List the command surface.** Send `get_commands` to the RPC session. Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive pstack-commands`. The driver asserts `/mode`, `/loop`, `/plan`, `/routines`, `/automations`, `/project`, `/in-cloud`, `/secret`, `skill:poteto-mode`, `skill:setup-pstack`, and `skill:poteto-help` are registered and saves the full command list.
- **Request the mode report.** Send `/mode` to the RPC session. The fresh session has no mode on, so a `notify` UI request arrives with `No mode is on.`
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/pstack-commands/commands.json` and `mode-status.json`. `mode-status.json` is the notification Pi sent, including `notifyType: "info"`.

## Gotchas

- `/mode` reports through `ctx.ui.notify`, which appears as an `extension_ui_request` over RPC, not as a chat message.
- The command list also carries skills from `~/.agents/skills`, which Pi loads even with `PI_CODING_AGENT_DIR` pointed at the scratch directory. The driver asserts the pstack entries, not the whole list.
- `/loop` and `/mode` need an interactive or RPC session. In print and JSON runs the `Loop` tool is removed from the active tools, `/loop <prompt>` writes a one-shot notice to stderr, and the run exits when the agent settles.
- This drive does not exercise `Task`, `TodoWrite`, or `AskQuestion`; those are model-called tools, not commands.
- Bare `/<skill>` names come from an input handler and TUI autocomplete, not from registered commands, so `get_commands` does not list them and this drive does not cover them.
