# Todos

The model keeps a session todo list with `TodoWrite`: `merge:false` replaces the list, `merge:true` updates items by id. Each write returns the list as text, updates the `pstack-todos` footer widget, and the next turn's system prompt carries the list in `<pstack_todos>`.

## Sub-features

- `todo-result`: after a replace and a merge, the result is `Todos (1/2 completed):\n[x] a: Alpha\n[ ] b: Beta`.
- `todo-widget`: `setWidget` `pstack-todos` with lines `["Todos 1/2", "✓ Alpha", "○ Beta"]`.
- `todo-prompt`: the next system prompt contains `<pstack_todos>` with the same list.

## How to get to it (user POV)

- Give the agent a multi-step task, or a skill that says "open a todo list".
- The widget sits above the editor in the TUI.

## Driving it with control-pstack

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-pstack/bin/control-pstack drive todos`.
- **Act.** RPC session: `TodoWrite {merge:false, todos:[{id:"a",content:"Alpha",status:"pending"},{id:"b",content:"Beta",status:"pending"}]}`; then `TodoWrite {merge:true, todos:[{id:"a",status:"completed"}]}`; then a prompt `@@sys`, which replies with the current system prompt.
- **Observe.** `todo-result` exactly, `todo-widget` exactly, and `todo-prompt` in the `@@sys` reply.
- **Proof.** `artifacts/verify-pi-pstack/todos/`: `rpc.events.jsonl`, `results.json` (result text, widget lines, extracted `<pstack_todos>` section).

## Gotchas

- Todos are session state: in a JSON `--no-session` run each process starts empty, so multi-write proofs need RPC (or one JSON run with several script steps).
- Branch-following (`fork` back to before a write) is covered by `test/e2e/todo.e2e.test.ts`, not this drive.
