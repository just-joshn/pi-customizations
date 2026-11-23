# Mode switching and persistence

`switch_mode` asks for a mode transition, `/mode plan` changes the next run, and inline `/mode ... <prompt>` submits a prompt with the new mode. Startup state and resumed sessions must keep the mode, guidance, and loadout consistent.

## Sub-features

- `switch-tool`: `switch_mode` from Agent to Ask reaches the model as a success and changes the next request.
- `switch-guidance`: the request after the switch carries `[ASK MODE ACTIVE]`.
- `switch-loadout`: the post-switch request uses the read-only tool loadout.
- `plan-command`: `/mode plan` carries Plan guidance and offers `create_plan`.
- `inline-mode-prompt`: `/mode reviewer Check this inline.` submits the embedded prompt in that mode.
- `inline-lone-command`: a lone `/mode ask Explain this inline.` waits for the prompt rather than dropping it.
- `unknown-startup-mode`: `--mode=plna` warns on stderr.
- `extension-triggered-turn`: an extension-triggered first turn receives the active custom skill.
- `resume`: a resumed session keeps the mode reminder without duplicating state.

## How to get to it (user POV)

Run `/mode agent`, `/mode plan`, `/mode ask`, `/mode debug`, or `/mode <skill>`. Ask the model to call `switch_mode` when the change is about approval or escalation. Use `/mode <skill> <prompt>` to enter and submit in one line. Start with `--mode=<value>` or `--plan` to test startup persistence. Resume with `--session <file>`.

## Driving it with the fake-model harness

```sh
node "$HELPER" drive "$EVIDENCE"
```

Require these exact `ok` lines:

- `ok switch run sends a second request`
- `ok the switch tool reached the model as success`
- `ok the request after switch_mode carries the Ask guidance`
- `ok the request after switch_mode uses the read-only loadout`
- `ok the request after /mode plan carries the Plan guidance`
- `ok /mode plan offers create_plan`
- `ok print mode sends the prompt embedded in /mode`
- `ok the embedded prompt enters the requested custom mode`
- `ok the next positional prompt keeps the mode`
- `ok print mode waits for a lone slash-command prompt`
- `ok the inline Ask prompt gets read-only guidance`
- `ok an unknown startup mode warns on stderr in print mode`
- `ok an extension-triggered first turn receives the custom skill`
- `ok the resumed custom mode still sends its reminder`
- `ok resuming does not append an unchanged snapshot`

The session JSONL files are under `e2e-root/sessions/`; inspect the `pi-modes-state` entries and the final mode/tool state. The fake e2e's `switch_mode` approval uses the non-UI read-only rules.

## Gotchas

- `switch_mode` from Ask or Plan to Agent/Debug needs an interactive approval. Without a UI, that escalation is refused; read-only-to-read-only transitions proceed.
- Startup `--mode` uses the equals form. `--mode <value>` is Pi's own output-mode flag.
- `--plan "prompt"` swallows the prompt because Pi assigns the next bare argument to the boolean flag. Put prompts after `--` or use `--mode=plan`.
- `/mode <multi-word title>` matches the title exactly and submits no prompt. This is expected.
- Mode state is run-scoped. Do not test persistence by importing state functions; resume a real session and inspect its JSONL.
