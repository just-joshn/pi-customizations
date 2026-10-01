# pstack status and todos

`/pstack status` reports source versions, bundled pstack resource counts, Poteto mode, model and compatibility paths, host limits, and a todo progress summary. `/pstack todos` lists active branch todo items or confirms an empty list.

## Sub-features

- `status-version` reports pstack version, cursor-team-kit version, and Pi agent version.
- `status-counts` reports counts from pstack's bundled skill and prompt-template directories, not all resources loaded by Pi.
- `status-mode` reports whether Poteto mode is on or off.
- `status-todos` shows the completed count out of the total in `/pstack status` when todos exist. `/pstack todos` lists them or reports `Todos: none.`
- `todo-replace` replaces the active branch list through `TodoWrite`.
- `todo-merge` updates matching IDs in place, preserves unmentioned items, and appends new IDs through `TodoWrite` with `merge: true`.
- `todo-widget` presents an eight-item window with compact, width-limited terminal rows.

## How to get to it (user POV)

- Type `/pstack` or `/pstack status` in Pi interactive chat.
- Type `/pstack todos` in Pi interactive chat.
- Send prompt `{"id": "...", "type": "prompt", "message": "/pstack status"}` over Pi RPC.
- Send prompt `{"id": "...", "type": "prompt", "message": "/pstack todos"}` over Pi RPC.
- Call the direct `TodoWrite` tool with `{"todos":[{"id":"check-status","content":"Check /pstack status","status":"pending"}]}` to replace the list.
- Call it with `{"todos":[{"id":"check-status","content":"Check /pstack status","status":"in_progress"}],"merge":true}` to merge by ID. Matching IDs update in place, unmentioned items stay, and new IDs append. Use `/pstack status` to read the progress summary and `/pstack todos` to inspect the list.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- `extensions/pi-pstack` is present and unchanged.

- **Request status.** Send `/pstack status` to the RPC session. Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive pstack-status`. A custom message of type `pstack-status` reports source versions, bundled resource counts, Poteto mode, configuration paths, host limits, and any todo summary.
- **Request todos.** Send `/pstack todos` to the RPC session. The empty scratch state produces `Todos: none.`.
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/pstack-status/status.txt`, `status.json`, and `todos.txt`. The driver checks the status version, team-kit, and resource-count patterns, plus the empty todo response. It does not seed todos or verify a non-empty summary or list.

## Gotchas

- pstack status and todos output are delivered as custom message records (`role: "custom"`, `customType: "pstack-status"`), not regular assistant responses.
- The counts cover directories under pstack's `skills/` and `host/skills/`, plus Markdown files under `prompts/` and `host/prompts/`. Other packages can add resources to Pi without changing these counts.
- The TUI todo widget shows at most eight items. It keeps the in-progress todo, or the first pending todo when none is in progress, in the window and includes one earlier todo where possible. It shows `... N earlier` and `... N more` rows for hidden items. If todos exist but none is in progress or pending, the widget shows the first eight.
- The widget replaces line breaks with spaces and truncates each row to the terminal width. `/pstack todos` RPC text and persisted `pstack-state` retain the original line breaks. The `control-pi drive pstack-status` recipe does not test the TUI window or multiline rendering.
- Unrecognized subcommands such as `/pstack foo` return command usage guidance rather than status output.
- Running `/pstack` without arguments displays the same status banner as `/pstack status`.
- This drive covers the status banner and empty todos, not populated todo rendering or interactive widgets.
