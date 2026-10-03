# pi-maintainer

`pi-maintainer` checks the files pi edits, prints the failures, and, on confirmation, sends the failure text back to the model as the next user turn. It also exposes the checkers through `/lint`, `/test`, `/run`, and the one-shot `--lint` and `--test` flags.

## Sub-features

- `maintainer-commands` registers the `/lint`, `/test`, and `/run` commands.
- `maintainer-auto-lint` lints every file an editing turn changed and confirms a repair for each failure.
- `maintainer-auto-test` runs the configured test command after an editing turn and confirms a repair for a failure.
- `maintainer-one-shot-lint` lints the dirty files at startup, confirms a repair per file, and exits 0.
- `maintainer-one-shot-test` runs the test command, adds failing output to the chat, and exits 0, or exits 1 with no test command.
- `maintainer-lint-cmd` parses `--lint-cmd` entries and exits 1 on an unparsable entry.
- `maintainer-run-output` adds command output to the chat through the run-output template.

## How to get to it (user POV)

- Run `pi --no-extensions -e ./extensions/pi-maintainer --test --test-cmd "exit 1"` one-shot.
- Run `pi --no-extensions -e ./extensions/pi-maintainer --lint` one-shot on a repository with dirty files.
- Run `pi --no-extensions -e ./extensions/pi-maintainer --lint-cmd "rust:"` with an unparsable entry.
- Type `/lint`, `/test <cmd>`, or `/run <cmd>` in a session that loaded the extension.
- Edit a file in an auto-lint session and accept the repair confirmation.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- `extensions/pi-maintainer/package.json` declares `"pi": { "extensions": ["./index.ts"] }`.

- **Drive the RPC and one-shot surfaces.** Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive pi-maintainer`.
- **Verify command registration.** The drive asserts `get_commands` lists `lint`, `test`, and `run` with `source: "extension"`.
- **Verify the lint text.** The drive asserts the `/lint` notification carries the configured checker command line, the checker output, the marked-line heading, and the marked source line.
- **Verify the output templates.** The drive asserts the `/test` and `/run` custom entries equal the run-output template filled with the command and its output.
- **Verify one-shot exit codes.** The drive asserts exit 0 for a failing one-shot test, exit 1 without a test command, and exit 1 for an unparsable `--lint-cmd`.
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/pi-maintainer/lint.txt`, `test-failure-message.json`, `run-message.json`, `notifications.json`, and `one-shot.txt`.

## Gotchas

- Exit codes are only observable outside RPC mode. RPC shuts down with status 0 by its own design, so the drive runs the one-shot checks in pi's default mode.
- In RPC mode the harness supplies a scratch agent directory with no credentials, so the repair turn that `/lint` sends never reaches a model. Assertions stop at the appended entries and notifications.
- The second copy of a test failure text is delivered through the session's own prompt path and only becomes a session entry once a model responds, so it needs a run with credentials.
- A Python file with no configured checker needs an interpreter that has the fatal-lint module installed. Without it the failure text is the interpreter's own missing-module message, which the pipeline reports as a lint failure.
- The extension answers every confirmation with yes when the session has no dialog UI, which is what the RPC drive relies on for auto-answers.
