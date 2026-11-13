# Edit

The model answers in reply text, not tool calls. pi-maintainer parses the reply in the session's edit format, writes the files in the chat, and auto-commits the change. The commit message comes from a separate commit-message request to the model, and the commit carries a `Co-authored-by: pi (<model>) <noreply@pi.dev>` trailer.

## Sub-features

- `edit-router`: after session start, the session model is `pi-maintainer/coder`.
- `edit-whole`: in print mode with `edit-format: whole` and `file: [app.py]`, a `app.py` + fenced whole-file reply replaces `app.py`.
- `edit-block`: in RPC with `edit-format: diff` after `/add app.py`, a SEARCH/REPLACE block applies.
- `edit-commit`: each edit becomes a commit with subject `feat: scripted edit` and the trailer. Print stderr and an RPC notice both say `Commit <hash> feat: scripted edit`.
- `edit-no-tools`: every model request carries zero tools.

## How to get to it (user POV)

- Run `pi -p "<request>"` in a repo, with files named by `file:` in `.pi-maintainer.conf.yml` or `--file`.
- Use the interactive or RPC session: `/add <file>`, then type the request.

## Driving it with control-maintainer

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-maintainer/bin/control-maintainer drive edit`.
- **Print.** With config `yes-always: true`, `edit-format: whole`, and `file: [app.py]`, the drive runs `pi --print --no-session "make greet say hey\n@@reply <app.py whole-file listing>"`. The process exits 0, `app.py` has `return "hey"`, HEAD is `feat: scripted edit` with the trailer, and stderr matches `Commit [0-9a-f]+ feat: scripted edit`.
- **RPC.** With config `edit-format: diff`, `get_state` returns `pi-maintainer/coder`. `/add app.py` gives the notice `Added app.py to the chat`. The drive then sends a prompt with a SEARCH/REPLACE reply (`return "hey"` to `return "hello"`). The result is a notice of `Commit <hash> feat: scripted edit`, `app.py` updated on disk, `HEAD~1` equal to the print commit, and a clean `git status`.
- **Proof.** `artifacts/verify-pi-maintainer/edit/` holds `print.stderr.txt`, `rpc.events.jsonl`, `requests.jsonl` (with `kind: "commit"` entries and `tools: []`), `git-log.txt`, and `app.py.final`.

## Gotchas

- An unknown model defaults to `edit-format: whole`. A SEARCH/REPLACE reply under `whole` is not applied: pi-maintainer prints the file name and changes nothing. Set the format in config before blaming the parser.
- On a repo with no commits, pi-maintainer creates the repo, but the edit pipeline then reports `Unable to get current commit. The repository might be empty.` That is why the seed repo has an `init` commit.
- Without `.pi-maintainer*` in `.gitignore`, startup offers to add it and dirties `.gitignore`.
- `bun run journey:edit` in the package pins Pi to the devDependency version (1.5.0) and fails on the installed 1.5.2 before it drives anything.
