# `@justjoshn/pi-modes`

Four Pi-native execution modes for [Pi](https://pi.dev) (part of the `no-ceilings` package suite):

| Mode | Purpose | Tool Access & Behavior |
| --- | --- | --- |
| **Agent** | Default full-capability agent execution | Full active tools; tracks plan execution steps (`[DONE:n]`) with a live progress widget |
| **Ask** | Read-only Q&A and code explanation | Disables `edit`/`write`; blocks mutating `bash` commands; injects read-only Q&A guidance |
| **Plan** | Read-only exploration and structured planning | Disables `edit`/`write`; blocks mutating `bash`; provides `ask_question` and `create_plan` (a `.plan.md` in `~/.pi/agent/plans/` with a session header and YAML `todos` when present, plus `phases` for project plans); interactive **Ready to build?** flow |
| **Debug** | Hypothesis-driven runtime debugging | Starts a local NDJSON HTTP ingest server (`127.0.0.1:7242-7942/ingest/<uuid>`) writing to `.pi/debug-<6-char-id>.log`; live Runtime Logs widget; `<reproduction_steps>` interactive Proceed / Mark as fixed / Follow-up flow |

## Commands & Shortcuts

- `Ctrl+Alt+M` — Cycle modes: `Agent → Plan → Debug → Ask`
- `Ctrl+Alt+P` — Toggle Plan mode
- `/mode [agent|plan|debug|ask]` — Switch mode directly or open picker
- `/agent [<prompt>]` — Switch to Agent mode (optionally submitting a prompt)
- `/plan [<prompt>]` — Enter Plan mode, submit a planning prompt, or review an existing plan
- `/ask [<prompt>]` — Toggle Ask mode or submit a read-only question
- `/debug [<prompt>]` — Toggle Debug mode or submit a debugging prompt
- `/logs` — Show the current Debug NDJSON log path and recent entries

## CLI Flags

- `--mode <agent|plan|debug|ask>`
- `--plan` (shorthand for `--mode=plan`)

## Tools Registered

- `switch_mode` — Agent-initiated mode switch proposal with interactive user approval
- `ask_question` — Structured single/multi-select clarifying questions with automatic `"Other"` freeform option
- `create_plan` — Persists structured markdown plans to `~/.pi/agent/plans/`; writes YAML `todos` when present and `phases` for project plans
