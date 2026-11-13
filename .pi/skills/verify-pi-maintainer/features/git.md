# Git commands

pi-maintainer owns git the way Aider does. Assistant edits are auto-committed. `/diff` shows what the last assistant message changed, `/undo` removes the last assistant commit and restores its files, `/commit` commits edits made outside the chat, and `/git` runs raw git (argv, no shell) without adding the output to the chat.

## Sub-features

- `git-diff`: after an assistant edit, `/diff` gives the notice `Diff since <7-hex>...` followed by a unified diff with `-    return "hi"` and `+    return "hello"`.
- `git-undo`: `/undo` gives the notice `Removed: <hash> feat: scripted edit`. HEAD is `init` again and `app.py` is back to the seed contents.
- `git-commit`: after an outside edit, `/commit bump version` gives the notice `Commit <hash> bump version`, and the tree is clean.
- `git-raw`: `/git log --oneline -3` gives a notice with the log lines.

## How to get to it (user POV)

- Type `/diff`, `/undo`, `/commit [message]`, or `/git <args>` in an interactive or RPC session.

## Driving it with control-maintainer

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-maintainer/bin/control-maintainer drive git`.
- **Act.** In RPC: `/add app.py`, then a SEARCH/REPLACE prompt (`hi` to `hello`), then `/diff`, then `/undo`. Next, outside the chat, the drive appends `VERSION = 2` to `app.py`. It then sends `/commit bump version` and `/git log --oneline -3`.
- **Observe.** The notices are as above. `git log -1 --format=%s` reads `feat: scripted edit`, then `init`, then `bump version`. `git status --porcelain` is empty at the end.
- **Proof.** `artifacts/verify-pi-maintainer/git/` holds `results.json` (diff, undo, commit, and git notices), `git-log.txt`, and `app.py.final`.

## Gotchas

- `/undo` only undoes commits that pi-maintainer made in this session (`assistantCommits`). On a first commit it says `This is the first commit in the repository. Cannot undo.`
- `/diff` on a repo whose only commit is the assistant's fails with `Unable to diff: ... unknown revision`, because there is no parent.
- `/git` runs with cwd `process.cwd()`, not the repo root, and does not evaluate shell metacharacters.
- A `/commit` message is the subject verbatim. Without one, the model writes it (`feat: scripted edit`).
