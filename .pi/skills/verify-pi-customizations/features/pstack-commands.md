# Pstack command surface

The pstack extension registers one command, `/pstack`, and ships its compiled skills and their `/name` prompt templates for Pi to load. `/pstack status` reports the persistent style and this project's runs through a UI notification. The commands of the removed runtime (`/mode`, `/loop`, `/plan`, `/routines`, `/automations`, `/project`, `/in-cloud`, and `/secret`) are gone.

## Sub-features

- `commands-pstack` registers the `/pstack` extension command.
- `commands-retired` registers none of `/mode`, `/loop`, `/plan`, `/routines`, `/automations`, `/project`, `/in-cloud`, or `/secret`.
- `commands-skills` exposes pstack skills as `skill:<name>` and as `/name` prompt templates. The drive checks `poteto-mode`, `setup-pstack`, and `poteto-help` in both forms.
- `commands-status` answers `/pstack status` with `pstack style: off (poteto-mode from <path>).` when the style is off.

## How to get to it (user POV)

- Type `/pstack status` in Pi interactive chat to see the style and run count.
- Type `/` in Pi interactive chat and look for `pstack` and the skill names, such as `poteto-mode`.
- Send prompt `{"id": "...", "type": "get_commands"}` over Pi RPC and inspect `commands`.
- Send prompt `{"id": "...", "type": "prompt", "message": "/pstack status"}` over Pi RPC.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- `extensions/pi-pstack` is present and unchanged.

- **List the command surface.** Send `get_commands` to the RPC session. Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive pstack-commands`. The driver asserts that `pstack`, `skill:poteto-mode`, `skill:setup-pstack`, `skill:poteto-help`, `poteto-mode`, `setup-pstack`, and `poteto-help` are registered, that no retired command is, and saves the full command list.
- **Request the status report.** Send `/pstack status` to the RPC session. A `notify` UI request arrives whose message starts with `pstack style: off (poteto-mode from `.
- **Proof.** Verify that `artifacts/verify-pi-customizations/pstack-commands/commands.json` and `pstack-status.json` exist. `pstack-status.json` is the notification Pi sent, including `notifyType: "info"`.

## Gotchas

- `/pstack` reports through `ctx.ui.notify`, which appears as an `extension_ui_request` over RPC, not as a chat message.
- The command list also carries skills from `~/.agents/skills`, which Pi loads even with `PI_CODING_AGENT_DIR` pointed at the scratch directory. The driver asserts the pstack entries, not the whole list.
- This drive does not exercise the model tools `pstack_worker` and `pstack_evidence`. `tests/integration/pi-load.test.ts` in the package checks them with a scripted model.
- A name that another command owns is reachable as `/pstack:<name>`. This drive does not cover that path. `tests/integration/pi-load.test.ts` does.
