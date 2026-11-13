# Chat files

Chat files decide what the model sees. Editable files (`/add`) and read-only files (`/read-only`) are sent in full in every request. `/drop <file>` removes one file, and `/reset` drops all files and should clear the chat history, as Aider's `cmd_reset` does.

## Sub-features

- `files-add`: `/add app.py` gives the notice `Added app.py to the chat`, and the next request contains `app.py`'s contents.
- `files-read-only`: `/read-only NOTES.md` gives the notice `Added <abs path>/NOTES.md to read-only files.`, and the next request contains its contents.
- `files-drop`: `/drop app.py` gives the notice `Removed app.py from the chat`. The next request no longer contains `app.py`'s body but still has `NOTES.md`.
- `files-reset`: `/reset` gives the notice `All files dropped and chat history cleared.`. The next request has neither file nor any earlier user turn.

## How to get to it (user POV)

- Type `/add`, `/read-only`, `/drop`, or `/reset` in an interactive or RPC session.
- At startup, use `file:` and `read:` in `.pi-maintainer.conf.yml`, or `--file` and `--read`.

## Driving it with control-maintainer

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-maintainer/bin/control-maintainer drive chat-files`.
- **Act.** In RPC: `/add app.py`, `/read-only NOTES.md`, the prompt `what do these files do?`, `/drop app.py`, the prompt `and now?`, `/reset`, and the prompt `anything?`.
- **Observe.** The notices are as listed above. The last request in `requests.jsonl` after each prompt shows `class Store:` (from `app.py`) and `Style: greet() returns a short word.` (from `NOTES.md`) present or absent as each sub-feature states.
- **Proof.** `artifacts/verify-pi-maintainer/chat-files/` holds `results.json` (notices per step, written before `/reset` so it survives a reset failure) and `requests.jsonl`.

## Gotchas

- `files-reset` failed until 2026-11-12. `/reset` used to move only `historyThrough`, so earlier turns stayed in the request, split between a user turn and its reply. It now records `resetAfter` in the snapshot, and `partitionHistory` (`src/core/context.ts`) drops everything before the next user message. The regression test is `test/core/commands.pi.test.ts` › `/reset removes earlier chat history from the next request`. If this step fails again, report a product bug. Do not loosen the assertion.
- `results.json` is written before `/reset`, so the `files-add`, `files-read-only`, and `files-drop` evidence survives a reset failure.
- `/read-only` reports an absolute path, and `/add` reports a relative one.
- A plain `/drop` (no args) keeps files that were read-only at startup (`read:` config), but not ones added later with `/read-only`.
