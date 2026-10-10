# Linting and testing

Automatic lint and test follow edits when enabled. Flags match Aider's `args.py` names.

## Linting

`--lint` is a boolean one-shot flag. It does not take a language command argument.

Configure language-specific checkers with `--lint-cmd "language: command"` (repeatable). An unprefixed `--lint-cmd` value is a global command for every recognized language.

Disable automatic post-edit lint with `--no-auto-lint`.

## Testing

`--test` is a boolean one-shot flag. It requires `--test-cmd` (otherwise the process exits with status 1). A failing child test command does not become the process exit status.

Configure the test command with `--test-cmd` and enable automatic tests with `--auto-test`.
