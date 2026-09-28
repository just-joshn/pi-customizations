# pstack status and todos

pstack status and todos report runtime metadata, loaded skill counts, bundled prompt templates, persistent mode state, model configuration paths, and active branch todo items.

## Sub-features

- `status-version` reports pstack version, team-kit version, and Pi agent version.
- `status-counts` reports the count of loaded skills and prompt templates.
- `status-mode` reports whether Poteto mode is on or off.
- `status-todos` reports current active branch todo items or confirms an empty list.

## How to get to it (user POV)

- Type `/pstack` or `/pstack status` in Pi interactive chat.
- Type `/pstack todos` in Pi interactive chat.
- Send prompt `{"id": "...", "type": "prompt", "message": "/pstack status"}` over Pi RPC.
- Send prompt `{"id": "...", "type": "prompt", "message": "/pstack todos"}` over Pi RPC.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- `extensions/pi-pstack` is present and unchanged.
- Disposable `PI_CODING_AGENT_DIR` scratch directory initialized.

- **Request status.** Send `/pstack status` to the RPC session. Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive pstack-status`. A custom message of type `pstack-status` arrives containing `pstack 0.15.5`, `team-kit 1.2.0`, and `65 skills, 64 prompt templates`.
- **Request todos.** Send `/pstack todos` to the RPC session. A second custom message arrives containing `Todos: none.`.
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/pstack-status/status.txt`, `status.json`, and `todos.txt`. The files contain the full version string and empty todo confirmation.

## Gotchas

- pstack status and todos output are delivered as custom message records (`role: "custom"`, `customType: "pstack-status"`), not regular assistant responses.
- Unrecognized subcommands such as `/pstack foo` return command usage guidance rather than status output.
- Running `/pstack` without arguments displays the same status banner as `/pstack status`.
