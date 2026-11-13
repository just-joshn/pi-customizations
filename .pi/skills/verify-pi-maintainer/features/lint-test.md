# Lint and test

`/test [cmd]` runs the test command (the argument or `test-cmd`). On a non-zero exit it posts the output and sends it to the model as a new turn. `/lint [files]` runs the linter for each file (in-chat files, or dirty files when none are in the chat) and prints its errors.

## Sub-features

- `test-pass`: `/test true` prints nothing and starts no turn.
- `test-fail`: `/test` with `test-cmd: "sh -c 'echo TESTFAIL-42; exit 3'"` gives the notices `TESTFAIL-42` and `Added N lines of output to the chat.`, and a model turn whose request contains `TESTFAIL-42`.
- `lint-cmd`: `/lint app.py` with `lint-cmd: ["python: sh -c 'echo LINTERR-7 in $0; exit 1'"]` gives a notice that contains `LINTERR-7`.

## How to get to it (user POV)

- Type `/test`, `/test <cmd>`, `/lint`, or `/lint <files>`.
- At startup: `--test` (requires `--test-cmd`) and `--lint` run once and exit. `--auto-lint` and `--auto-test` run after each edit. See `extensions/pi-maintainer/docs/usage/lint-test.md`.

## Driving it with control-maintainer

Preconditions:

- `doctor` passes. The drive rewrites the config with the `test-cmd` and `lint-cmd` above and `auto-lint: false`.

Steps:

- **Run.** `./.pi/skills/verify-pi-maintainer/bin/control-maintainer drive lint-test`.
- **Act.** In RPC: `/test true`, then `/test`, awaited to `agent_settled` because it starts a turn, then `/lint app.py`.
- **Observe.** The notices are as above. The last `requests.jsonl` entry after `/test` contains `TESTFAIL-42`.
- **Proof.** `artifacts/verify-pi-maintainer/lint-test/` holds `results.json` (the notices for each command) and `requests.jsonl`.

## Gotchas

- Commands are argv-split and run through Pi's executor, not a shell. Wrap anything with pipes, `;`, or exit codes in `sh -c '...'`.
- `/test` answers `handled` even though it starts a turn. A harness that stops at the response misses the turn, so pass `turn: true` to `rpc.type`.
- `/lint` without arguments and without chat files lints dirty files. On a clean tree it warns `No dirty files to lint.`
- `lint-cmd` keys are languages (`python`), not extensions. An unprefixed value applies to every language.
