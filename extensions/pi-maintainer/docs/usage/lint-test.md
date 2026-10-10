# Linting and testing

Automatic lint and test follow edits when enabled. Flags match Aider's `args.py` names.

## Linting

`--lint` is a boolean one-shot flag. It does not take a language command argument.

Configure language-specific checkers with `--lint-cmd "language: command"` (repeatable). An unprefixed `--lint-cmd` value is a global command for every recognized language.

Disable automatic post-edit lint with `--no-auto-lint`.

## Testing

Configure the test command with `--test-cmd` and enable automatic tests with `--auto-test`.
